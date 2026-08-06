/**
 * モデル本体 = 現在のキャンバス状態 + 1 ステップ分の最適化
 *
 *   Î_N(x,y) = Composite(P_1, P_2, ..., P_N)
 *
 * 各ステップで
 *   1. ランダムな図形候補を randomTries 個生成し、それぞれ最適色で評価
 *   2. いちばん良かったものを初期解として局所探索(山登り / 焼きなまし)
 *   3. 確定した図形を current バッファへ合成
 * を行う。N が小さい段階では概形だけが、増えるほど細部が現れる。
 */

import { Rng, clamp } from './rng'
import { ScanlineBuffer } from './raster'
import { ColorConstraint, averageColor, computeOptimalColor, hexToRgb } from './color'
import { drawLines, fullSSE, partialSSE, rmse } from './score'
import { mutateShape, randomShape, shapeScanlines, type SizeRange } from './shapes'
import type { Config, RGB, Shape, ShapeRecord } from './types'

interface State {
  shape: Shape
  alpha: number
  color: RGB
  sse: number
}

/** 焼きなましの温度スケール(RMSE 単位) */
const ANNEAL_SCALE = 0.002
/** 誤差ドリフト補正の間隔 */
const RESYNC_EVERY = 32

export class Model {
  readonly w: number
  readonly h: number
  readonly target: Uint8ClampedArray
  readonly current: Uint8ClampedArray
  readonly bg: RGB
  readonly records: ShapeRecord[] = []

  private cfg: Config
  private rng: Rng
  private constraint: ColorConstraint
  private buf = new ScanlineBuffer()
  private sse: number
  private pixels: number
  /** サイズ範囲は「長辺に対する比率」で受け取り、px に直して保持する */
  private size: SizeRange

  constructor(w: number, h: number, pixels: Uint8ClampedArray, cfg: Config) {
    this.w = w
    this.h = h
    this.cfg = cfg
    const unit = Math.max(w, h)
    const lo = Math.max(0.5, Math.min(cfg.sizeMin, cfg.sizeMax) * unit)
    this.size = { minR: lo, maxR: Math.max(lo + 0.5, Math.max(cfg.sizeMin, cfg.sizeMax) * unit) }
    this.target = pixels
    this.pixels = w * h
    this.rng = new Rng(cfg.seed)
    this.constraint = new ColorConstraint(cfg.color)

    this.bg =
      cfg.bg === 'average'
        ? averageColor(pixels)
        : cfg.bg === 'white'
          ? { r: 255, g: 255, b: 255 }
          : cfg.bg === 'black'
            ? { r: 0, g: 0, b: 0 }
            : hexToRgb(cfg.bgColor)

    this.current = new Uint8ClampedArray(pixels.length)
    for (let i = 0; i < this.current.length; i += 4) {
      this.current[i] = this.bg.r
      this.current[i + 1] = this.bg.g
      this.current[i + 2] = this.bg.b
      this.current[i + 3] = 255
    }
    this.sse = fullSSE(this.target, this.current)
  }

  get score(): number {
    return rmse(this.sse, this.pixels)
  }

  /** 1 図形を追加する。追加できなければ null。 */
  step(): ShapeRecord | null {
    const best = this.search()
    if (!best) return null

    shapeScanlines(best.shape, this.w, this.h, this.buf)
    drawLines(this.current, this.buf, best.color, best.alpha, this.w)
    this.sse = best.sse

    if ((this.records.length + 1) % RESYNC_EVERY === 0) {
      // 8bit 丸めによる推定誤差の蓄積をここでリセットする
      this.sse = fullSSE(this.target, this.current)
    }

    const record: ShapeRecord = {
      shape: best.shape,
      color: { r: Math.round(best.color.r), g: Math.round(best.color.g), b: Math.round(best.color.b) },
      alpha: Math.round(best.alpha),
      score: this.score,
    }
    this.records.push(record)
    return record
  }

  /* ---------------- 内部 ---------------- */

  private evaluate(shape: Shape, alpha: number): State | null {
    shapeScanlines(shape, this.w, this.h, this.buf)
    if (this.buf.count === 0) return null
    const raw = computeOptimalColor(this.target, this.current, this.buf, alpha, this.w)
    const color = this.constraint.apply(raw)
    const sse = partialSSE(this.target, this.current, this.buf, color, alpha, this.w, this.sse)
    return { shape, alpha, color, sse }
  }

  private randomAlpha(): number {
    return this.cfg.optimizeAlpha ? this.rng.int(224) + 24 : this.cfg.alpha
  }

  private search(): State | null {
    const kinds = this.cfg.shapes.length ? this.cfg.shapes : (['triangle'] as const)
    let best: State | null = null

    for (let t = 0; t < this.cfg.randomTries; t++) {
      const kind = this.rng.pick(kinds)
      const shape = randomShape(
        kind,
        this.w,
        this.h,
        this.rng,
        this.cfg.polygonSides,
        this.size,
      )
      const st = this.evaluate(shape, this.randomAlpha())
      if (st && (!best || st.sse < best.sse)) best = st
    }
    if (!best) return null

    if (this.cfg.anneal) best = this.anneal(best)
    return this.hillClimb(best)
  }

  private mutateState(s: State, temp: number): State | null {
    const shape = mutateShape(s.shape, this.w, this.h, this.rng, this.size, temp)
    const alpha = this.cfg.optimizeAlpha
      ? clamp(s.alpha + this.rng.gauss() * 16 * temp, 12, 255)
      : s.alpha
    return this.evaluate(shape, alpha)
  }

  private hillClimb(start: State): State {
    let cur = start
    let age = 0
    while (age < this.cfg.hillClimbAge) {
      const next = this.mutateState(cur, 1)
      if (next && next.sse < cur.sse) {
        cur = next
        age = 0
      } else {
        age++
      }
    }
    return cur
  }

  private anneal(start: State): State {
    const iters = this.cfg.annealIters
    const t0 = Math.max(1e-4, this.cfg.temperature)
    let cur = start
    let best = start
    for (let i = 0; i < iters; i++) {
      const frac = 1 - i / iters
      const temp = t0 * frac
      const next = this.mutateState(cur, Math.max(0.15, frac))
      if (!next) continue
      const dE = (rmse(next.sse, this.pixels) - rmse(cur.sse, this.pixels)) / ANNEAL_SCALE
      if (dE <= 0 || this.rng.next() < Math.exp(-dE / Math.max(1e-6, temp))) {
        cur = next
        if (cur.sse < best.sse) best = cur
      }
    }
    return best
  }
}
