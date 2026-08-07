/**
 * 動画モデル本体 — 前フレームの解の近傍に解を拘束する warm start 型の逐次ソルバ
 *
 * 貪欲追加法は argmax の離散選択なので入力に対して不連続で、フレーム独立に
 * 解くと明滅する。ここでは毎フレーム
 *
 *   Layer 1: 輸送     — 疎LKフロー → アフィン → 図形自由度へ射影 (θ̂ を得る)
 *   Layer 2: 再フィット — 残差の大きい図形だけ山登り。滑らかさ λ_v‖θ−θ̂‖²_Λ を
 *                        スコアに直接足す。合成は z順の下から上への1掃引で、
 *                        各図形は「自分より下の合成結果」に対して厳密に評価される
 *                        (上の図形を無視するのは元の貪欲法と同じ近似)
 *   Layer 3: 生死     — 寄与が τ_death 未満なら退場、残差への貪欲追加は
 *                        1フレーム B 個まで(τ_birth > τ_death のヒステリシス)。
 *                        生死は瞬時にせず k フレームかけて α をランプさせる
 *
 * を行う。カット直後はフレーム0と同じ完全な貪欲解き直し。
 */

import { Rng, clamp } from '../core/rng'
import { ScanlineBuffer } from '../core/raster'
import { ColorConstraint, averageColor, hexToRgb } from '../core/color'
import { drawLines, fullSSE, lineStats, rmse, sseFromStats } from '../core/score'
import { constrainSize, mutateShape, randomShape, shapeScanlines, type SizeRange } from '../core/shapes'
import type { RGB, Shape, ShapeKind, ShapeRecord } from '../core/types'
import {
  MAX_SAMPLES,
  buildPyramid,
  fitAffine,
  advectShape,
  paramDist2,
  samplePoints,
  trackPoint,
  type Pyramid,
} from './flow'
import type { FrameStats, TrackSample, VideoConfig } from './types'

/** 再フィットの変異温度。局所追跡なので通常探索(1.0)より小さく */
const REFIT_TEMP = 0.35
/** 色の慣性: c_t = lerp(c_{t-1}, 最適色, GAIN)。色の明滅を抑える */
const COLOR_GAIN = 0.45
/** 退場には寄与不足が2フレーム連続で必要(時間方向のヒステリシス) */
const DEATH_STREAK = 2

interface Fit {
  shape: Shape
  alpha: number
  color: RGB
  sse: number
  n: number
}

export interface LiveTrack {
  k: ShapeKind
  shape: Shape
  color: RGB | null
  /** α_i はトラックごとに不変(実効αは振り付けで変わる) */
  alphaBase: number
  birth: number
  death: number
  /** 描画済みフレーム数 */
  age: number
  /** -1: 通常 / ≥0: 退場中(この値が残り描画回数) */
  dying: number
  lowStreak: number
  /** カット/フレーム0生まれはフェードインしない */
  instant: boolean
  refit: boolean
  samples: TrackSample[]
}

export interface FrameResult {
  stats: FrameStats
  shapes: ShapeRecord[]
}

export class VideoModel {
  readonly w: number
  readonly h: number
  readonly bg: RGB
  /** 生成された全トラック(z順 = 添字順。死んだものも残る) */
  readonly tracks: LiveTrack[] = []

  private cfg: VideoConfig
  private rng: Rng
  private constraint: ColorConstraint
  private size: SizeRange
  private buf = new ScanlineBuffer()
  private stats = new Float64Array(5)
  private ptsBuf = new Float64Array(MAX_SAMPLES * 2)
  private okPts = new Float64Array(MAX_SAMPLES * 2)
  private okFlow = new Float64Array(MAX_SAMPLES * 2)
  private current: Uint8ClampedArray
  private rankCanvas: Uint8ClampedArray
  private alive: LiveTrack[] = []
  private target: Uint8ClampedArray
  private sse = 0
  private pixels: number
  private frame = -1
  private prevPyr: Pyramid | null = null
  private frameShapes: ShapeRecord[] = []

  constructor(w: number, h: number, firstFrame: Uint8ClampedArray, cfg: VideoConfig) {
    this.w = w
    this.h = h
    this.cfg = cfg
    this.pixels = w * h
    this.rng = new Rng(cfg.seed)
    this.constraint = new ColorConstraint(cfg.color)
    const unit = Math.max(w, h)
    const lo = Math.max(0.5, Math.min(cfg.sizeMin, cfg.sizeMax) * unit)
    this.size = { minR: lo, maxR: Math.max(lo + 0.5, Math.max(cfg.sizeMin, cfg.sizeMax) * unit) }
    this.bg =
      cfg.bg === 'average'
        ? averageColor(firstFrame)
        : cfg.bg === 'white'
          ? { r: 255, g: 255, b: 255 }
          : cfg.bg === 'black'
            ? { r: 0, g: 0, b: 0 }
            : hexToRgb(cfg.bgColor)
    this.current = new Uint8ClampedArray(w * h * 4)
    this.rankCanvas = new Uint8ClampedArray(w * h * 4)
    this.target = firstFrame
  }

  /** 1フレーム処理する。呼び出し側がカット判定を渡す。 */
  processFrame(target: Uint8ClampedArray, isCut: boolean): FrameResult {
    this.frame++
    this.target = target
    const pyr = buildPyramid(target, this.w, this.h)
    this.frameShapes = []
    let births = 0
    let deaths = 0

    if (this.frame === 0 || isCut) {
      // カットをまたいで輸送しない: 全図形を意味のない場所へ引きずらず、解き直す
      for (const t of this.alive) {
        t.death = this.frame
        deaths++
      }
      this.alive = []
      this.resetCanvas()
      births = this.greedyFill()
    } else {
      if (this.prevPyr) this.advectAll(this.prevPyr, pyr)
      this.rankRefitPriority()
      deaths = this.refitSweep()
      births = this.birthPass()
    }
    this.prevPyr = pyr
    // 8bit丸めの推定誤差蓄積をフレーム末で必ずリセットする
    this.sse = fullSSE(this.target, this.current)

    const score = rmse(this.sse, this.pixels)
    return {
      stats: {
        frame: this.frame,
        rmse: score,
        births,
        deaths,
        alive: this.alive.length,
        cut: isCut && this.frame > 0,
      },
      shapes: this.frameShapes,
    }
  }

  /** 全フレーム処理後に呼ぶ。生存中トラックの寿命を閉じて全トラックを返す。 */
  finish(totalFrames: number): LiveTrack[] {
    for (const t of this.alive) t.death = totalFrames
    this.alive = []
    return this.tracks
  }

  /* ---------------- Layer 1: 輸送 ---------------- */

  private advectAll(prev: Pyramid, next: Pyramid): void {
    for (const t of this.alive) {
      shapeScanlines(t.shape, this.w, this.h, this.buf)
      const n = samplePoints(this.buf, this.ptsBuf)
      if (n === 0) continue
      let ok = 0
      for (let i = 0; i < n; i++) {
        const x = this.ptsBuf[i * 2] + 0.5
        const y = this.ptsBuf[i * 2 + 1] + 0.5
        const f = trackPoint(prev, next, x, y)
        if (!f) continue
        this.okPts[ok * 2] = x
        this.okPts[ok * 2 + 1] = y
        this.okFlow[ok * 2] = f.u
        this.okFlow[ok * 2 + 1] = f.v
        ok++
      }
      if (ok === 0) continue // 追跡不能(平坦領域など)はその場に留める
      const A = fitAffine(this.okPts, this.okFlow, ok)
      t.shape = constrainSize(advectShape(t.shape, A), this.size.minR, this.size.maxR)
    }
  }

  /* ---------------- Layer 2: 再フィット優先度 ---------------- */

  /**
   * pass A: 輸送後の状態を仮合成し、図形ごとの支持領域の残差(1画素あたり)で
   * 山登りを割り当てる図形を選ぶ。動いていない背景の図形は触らない。
   */
  private rankRefitPriority(): void {
    const bg = this.bg
    const c = this.rankCanvas
    for (let i = 0; i < c.length; i += 4) {
      c[i] = bg.r
      c[i + 1] = bg.g
      c[i + 2] = bg.b
      c[i + 3] = 255
    }
    const pris: { t: LiveTrack; pri: number }[] = []
    for (const t of this.alive) {
      t.refit = false
      shapeScanlines(t.shape, this.w, this.h, this.buf)
      if (this.buf.count === 0 || !t.color) continue
      drawLines(c, this.buf, t.color, this.effAlpha(t), this.w)
      // 描画後の支持領域残差
      let sse = 0
      let n = 0
      const d = this.buf.data
      for (let k = 0; k < this.buf.count; k++) {
        const y = d[k * 3]
        const x1 = d[k * 3 + 1]
        const x2 = d[k * 3 + 2]
        let i = (y * this.w + x1) * 4
        for (let x = x1; x <= x2; x++, i += 4) {
          const dr = this.target[i] - c[i]
          const dg = this.target[i + 1] - c[i + 1]
          const db = this.target[i + 2] - c[i + 2]
          sse += dr * dr + dg * dg + db * db
        }
        n += x2 - x1 + 1
      }
      if (t.dying < 0) pris.push({ t, pri: sse / Math.max(1, n) })
    }
    pris.sort((a, b) => b.pri - a.pri)
    const k = Math.max(Math.min(8, pris.length), Math.round(this.cfg.refitFrac * pris.length))
    for (let i = 0; i < k; i++) pris[i].t.refit = true
  }

  /* ---------------- Layer 2/3: 掃引(再フィット+死亡判定+合成) ---------------- */

  private refitSweep(): number {
    this.resetCanvas()
    let deaths = 0
    const survivors: LiveTrack[] = []

    for (const t of this.alive) {
      const ref = t.shape // 輸送予測 θ̂。滑らかさペナルティの基準
      let eff = this.effAlpha(t)
      let fit = this.evaluate(t.shape, eff, t.color)
      if (!fit) {
        // 画面外・退化 → 即時退場
        t.death = this.frame
        deaths++
        continue
      }
      if (t.refit && t.dying < 0) fit = this.refitClimb(fit, ref, t.color)

      // 寄与 = 被覆1画素あたりのSSE改善量
      const contrib = (this.sse - fit.sse) / fit.n
      if (t.dying < 0) {
        if (contrib < this.cfg.tauDeath) t.lowStreak++
        else t.lowStreak = 0
        if (t.lowStreak >= DEATH_STREAK && t.age >= this.cfg.minLife) {
          if (this.cfg.fade === 0) {
            t.death = this.frame
            deaths++
            continue
          }
          t.dying = this.cfg.fade
          eff = this.effAlpha(t)
          const refit = this.evaluate(fit.shape, eff, t.color)
          if (refit) fit = refit
        }
      }

      this.commit(t, fit)
      if (t.dying > 0) {
        t.dying--
        if (t.dying === 0) {
          t.death = this.frame + 1
          deaths++
          continue
        }
      }
      survivors.push(t)
    }
    this.alive = survivors
    return deaths
  }

  private refitClimb(start: Fit, ref: Shape, prevColor: RGB | null): Fit {
    const lam = this.cfg.lambdaV
    const nRef = start.n
    let cur = start
    let curCost = cur.sse + lam * nRef * paramDist2(cur.shape, ref)
    let age = 0
    while (age < this.cfg.refitAge) {
      const shape = mutateShape(cur.shape, this.w, this.h, this.rng, this.size, REFIT_TEMP)
      const fit = this.evaluate(shape, cur.alpha, prevColor)
      if (fit) {
        const cost = fit.sse + lam * nRef * paramDist2(fit.shape, ref)
        if (cost < curCost) {
          cur = fit
          curCost = cost
          age = 0
          continue
        }
      }
      age++
    }
    return cur
  }

  /* ---------------- Layer 3: 誕生 ---------------- */

  private birthPass(): number {
    const tauBirth = this.cfg.tauDeath * this.cfg.birthFactor
    let births = 0
    for (let b = 0; b < this.cfg.birthBudget; b++) {
      if (this.alive.length >= this.cfg.steps) break
      const found = this.searchNew(false)
      if (!found) break
      const { fit, base } = found
      const contrib = (this.sse - fit.sse) / fit.n
      if (contrib < tauBirth) break // ヒステリシス: 誕生は退場より高い改善を要求
      this.spawn(fit, base, false)
      births++
    }
    return births
  }

  /** フレーム0・カット直後の完全な貪欲解き直し */
  private greedyFill(): number {
    let births = 0
    while (this.alive.length < this.cfg.steps) {
      const found = this.searchNew(true)
      if (!found || found.fit.sse >= this.sse) break
      this.spawn(found.fit, found.base, true)
      births++
    }
    return births
  }

  private spawn(fit: Fit, alphaBase: number, instant: boolean): void {
    const t: LiveTrack = {
      k: fit.shape.k,
      shape: fit.shape,
      color: fit.color,
      alphaBase,
      birth: this.frame,
      death: -1,
      age: 0,
      dying: -1,
      lowStreak: 0,
      instant,
      refit: false,
      samples: [],
    }
    this.tracks.push(t)
    this.alive.push(t)
    this.commit(t, fit)
  }

  /**
   * ランダム候補 + 山登りで新規図形を1つ探す。
   * instant でなければ誕生ランプ後の実効αで評価する。
   */
  private searchNew(instant: boolean): { fit: Fit; base: number } | null {
    const kinds = this.cfg.shapes.length ? this.cfg.shapes : (['triangle'] as const)
    const factor = instant || this.cfg.fade === 0 ? 1 : 1 / (this.cfg.fade + 1)
    let best: Fit | null = null
    let bestBase = this.cfg.alpha
    for (let i = 0; i < this.cfg.randomTries; i++) {
      const base = this.cfg.optimizeAlpha ? this.rng.int(224) + 24 : this.cfg.alpha
      const shape = randomShape(
        this.rng.pick(kinds),
        this.w,
        this.h,
        this.rng,
        this.cfg.polygonSides,
        this.size,
      )
      const fit = this.evaluate(shape, Math.max(4, Math.round(base * factor)), null)
      if (fit && (!best || fit.sse < best.sse)) {
        best = fit
        bestBase = base
      }
    }
    if (!best) return null
    // 山登り(ペナルティなし: 新規図形に予測は存在しない)
    let age = 0
    while (age < this.cfg.hillClimbAge) {
      const shape = mutateShape(best.shape, this.w, this.h, this.rng, this.size, 1)
      const fit = this.evaluate(shape, best.alpha, null)
      if (fit && fit.sse < best.sse) {
        best = fit
        age = 0
      } else {
        age++
      }
    }
    return { fit: best, base: bestBase }
  }

  /* ---------------- 共通 ---------------- */

  private effAlpha(t: LiveTrack): number {
    let f = 1
    if (t.dying >= 0) f = t.dying / (this.cfg.fade + 1)
    else if (!t.instant && t.age < this.cfg.fade) f = (t.age + 1) / (this.cfg.fade + 1)
    return clamp(Math.round(t.alphaBase * f), 4, 255)
  }

  /** 確定した状態を合成し、軌跡サンプルとフレーム出力を記録する */
  private commit(t: LiveTrack, fit: Fit): void {
    shapeScanlines(fit.shape, this.w, this.h, this.buf)
    drawLines(this.current, this.buf, fit.color, fit.alpha, this.w)
    this.sse = fit.sse
    t.shape = fit.shape
    t.color = fit.color
    t.age++
    const color = {
      r: Math.round(fit.color.r),
      g: Math.round(fit.color.g),
      b: Math.round(fit.color.b),
    }
    t.samples.push({ p: fit.shape.p.slice(), color, alpha: fit.alpha })
    this.frameShapes.push({
      shape: { k: fit.shape.k, p: fit.shape.p.slice() },
      color,
      alpha: fit.alpha,
      score: 0,
    })
  }

  /** キャンバスを背景色に戻し、走査しながら SSE も同時に求める */
  private resetCanvas(): void {
    const { r, g, b } = this.bg
    let sse = 0
    const c = this.current
    const t = this.target
    for (let i = 0; i < c.length; i += 4) {
      c[i] = r
      c[i + 1] = g
      c[i + 2] = b
      c[i + 3] = 255
      const dr = t[i] - c[i]
      const dg = t[i + 1] - c[i + 1]
      const db = t[i + 2] - c[i + 2]
      sse += dr * dr + dg * dg + db * db
    }
    this.sse = sse
  }

  /** model.ts(静止画)の evaluate + 色の慣性。最適色は毎フレーム閉形式で解き直す */
  private evaluate(shape: Shape, alpha: number, prevColor: RGB | null): Fit | null {
    shapeScanlines(shape, this.w, this.h, this.buf)
    if (this.buf.count === 0) return null
    const n = lineStats(this.target, this.current, this.buf, alpha, this.w, this.stats)
    if (n === 0) return null
    const inv = 255 / (alpha * n)
    let raw: RGB = {
      r: clamp(this.stats[0] * inv, 0, 255),
      g: clamp(this.stats[1] * inv, 0, 255),
      b: clamp(this.stats[2] * inv, 0, 255),
    }
    if (prevColor) {
      raw = {
        r: prevColor.r + (raw.r - prevColor.r) * COLOR_GAIN,
        g: prevColor.g + (raw.g - prevColor.g) * COLOR_GAIN,
        b: prevColor.b + (raw.b - prevColor.b) * COLOR_GAIN,
      }
    }
    const color = this.constraint.apply(raw)
    const sse = sseFromStats(this.stats, n, color, alpha, this.sse)
    return { shape, alpha, color, sse, n }
  }
}
