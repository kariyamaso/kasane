/**
 * Layer 1 — 輸送 (advection)
 *
 * 密なオプティカルフローは使わない。必要なのは各図形の支持領域におけるフローだけなので、
 *   1. 図形のスキャンライン内から数十点をサンプル
 *   2. その点群でピラミッド型 Lucas–Kanade を疎に解く   … O(M × 数十点)
 *   3. フローベクトル群に 2×3 アフィンを最小二乗フィット
 *   4. アフィンを図形の自由度へ射影(円なら平行移動と半径、三角形なら3頂点)
 * という構成にする。密フローの数十分の一のコストで済む。
 */

import { clamp } from '../core/rng'
import type { ScanlineBuffer } from '../core/raster'
import type { Shape } from '../core/types'

/* ------------------------------------------------------------------ */
/* グレースケール・ピラミッド                                            */
/* ------------------------------------------------------------------ */

export interface PyramidLevel {
  w: number
  h: number
  data: Float32Array
}

export type Pyramid = PyramidLevel[]

const PYR_LEVELS = 3

export function buildPyramid(rgba: Uint8ClampedArray, w: number, h: number): Pyramid {
  const base = new Float32Array(w * h)
  for (let i = 0, j = 0; i < base.length; i++, j += 4) {
    base[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]
  }
  const pyr: Pyramid = [{ w, h, data: base }]
  for (let l = 1; l < PYR_LEVELS; l++) {
    const prev = pyr[l - 1]
    const nw = Math.max(1, prev.w >> 1)
    const nh = Math.max(1, prev.h >> 1)
    if (nw < 12 || nh < 12) break
    const data = new Float32Array(nw * nh)
    for (let y = 0; y < nh; y++) {
      const y0 = Math.min(prev.h - 1, y * 2)
      const y1 = Math.min(prev.h - 1, y * 2 + 1)
      for (let x = 0; x < nw; x++) {
        const x0 = Math.min(prev.w - 1, x * 2)
        const x1 = Math.min(prev.w - 1, x * 2 + 1)
        data[y * nw + x] =
          0.25 *
          (prev.data[y0 * prev.w + x0] +
            prev.data[y0 * prev.w + x1] +
            prev.data[y1 * prev.w + x0] +
            prev.data[y1 * prev.w + x1])
      }
    }
    pyr.push({ w: nw, h: nh, data })
  }
  return pyr
}

/* ------------------------------------------------------------------ */
/* ピラミッド型 Lucas–Kanade (1点)                                      */
/* ------------------------------------------------------------------ */

const WIN = 3 // 窓半径 → 7×7
const LK_ITERS = 8
const MIN_EIG = 0.8 // 構造テンソルの最小固有値/画素。低コントラスト領域を弾く

function sample(l: PyramidLevel, x: number, y: number): number {
  const cx = clamp(x, 0, l.w - 1.001)
  const cy = clamp(y, 0, l.h - 1.001)
  const ix = Math.floor(cx)
  const iy = Math.floor(cy)
  const fx = cx - ix
  const fy = cy - iy
  const i = iy * l.w + ix
  const x1 = ix + 1 < l.w ? 1 : 0
  const y1 = iy + 1 < l.h ? l.w : 0
  return (
    l.data[i] * (1 - fx) * (1 - fy) +
    l.data[i + x1] * fx * (1 - fy) +
    l.data[i + y1] * (1 - fx) * fy +
    l.data[i + y1 + x1] * fx * fy
  )
}

// 窓内の輝度・勾配のスクラッチ(1点あたりのアロケーションを避ける)
const N_WIN = (2 * WIN + 1) * (2 * WIN + 1)
const patchI = new Float32Array(N_WIN)
const patchIx = new Float32Array(N_WIN)
const patchIy = new Float32Array(N_WIN)

/**
 * prev の点 (x,y) が next のどこへ動いたか。
 * 収束しない・低コントラスト・発散のときは null。
 */
export function trackPoint(
  prev: Pyramid,
  next: Pyramid,
  x: number,
  y: number,
): { u: number; v: number } | null {
  const top = Math.min(prev.length, next.length) - 1
  let gu = 0
  let gv = 0

  for (let l = top; l >= 0; l--) {
    const pl = prev[l]
    const nl = next[l]
    const s = 1 / (1 << l)
    const px = x * s
    const py = y * s

    // prev 側の窓の輝度と勾配(中心差分)を一度だけ集める
    let gxx = 0
    let gxy = 0
    let gyy = 0
    let m = 0
    for (let dy = -WIN; dy <= WIN; dy++) {
      for (let dx = -WIN; dx <= WIN; dx++, m++) {
        const sx = px + dx
        const sy = py + dy
        patchI[m] = sample(pl, sx, sy)
        const ix = (sample(pl, sx + 1, sy) - sample(pl, sx - 1, sy)) * 0.5
        const iy = (sample(pl, sx, sy + 1) - sample(pl, sx, sy - 1)) * 0.5
        patchIx[m] = ix
        patchIy[m] = iy
        gxx += ix * ix
        gxy += ix * iy
        gyy += iy * iy
      }
    }
    // 最小固有値チェック(開口問題・平坦領域)
    const tr = gxx + gyy
    const det = gxx * gyy - gxy * gxy
    const minEig = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det))
    if (minEig / N_WIN < MIN_EIG) {
      if (l === 0) return null
      gu *= 2
      gv *= 2
      continue
    }
    const inv = 1 / Math.max(1e-6, det)

    let du = 0
    let dv = 0
    for (let it = 0; it < LK_ITERS; it++) {
      let bx = 0
      let by = 0
      m = 0
      for (let dy = -WIN; dy <= WIN; dy++) {
        for (let dx = -WIN; dx <= WIN; dx++, m++) {
          const diff = patchI[m] - sample(nl, px + dx + gu + du, py + dy + gv + dv)
          bx += diff * patchIx[m]
          by += diff * patchIy[m]
        }
      }
      const su = (gyy * bx - gxy * by) * inv
      const sv = (gxx * by - gxy * bx) * inv
      du += su
      dv += sv
      if (su * su + sv * sv < 0.0009) break
    }
    // このレベルの窓を大きく超える推定は信頼しない
    if (!Number.isFinite(du) || !Number.isFinite(dv) || Math.hypot(du, dv) > WIN * 2.5) {
      return null
    }
    gu = (gu + du) * (l > 0 ? 2 : 1)
    gv = (gv + dv) * (l > 0 ? 2 : 1)
  }
  return { u: gu, v: gv }
}

/* ------------------------------------------------------------------ */
/* サンプル点の抽出                                                     */
/* ------------------------------------------------------------------ */

export const MAX_SAMPLES = 28

/**
 * 図形の支持領域(スキャンライン)から等間隔に最大 MAX_SAMPLES 点を取る。
 * out へ [x0,y0, x1,y1, ...] を書き込み、点数を返す。
 */
export function samplePoints(lines: ScanlineBuffer, out: Float64Array): number {
  let total = 0
  const d = lines.data
  for (let k = 0; k < lines.count; k++) total += d[k * 3 + 2] - d[k * 3 + 1] + 1
  if (total === 0) return 0
  const stride = Math.max(1, Math.floor(total / MAX_SAMPLES))
  let acc = stride >> 1 // 端に寄らないよう半ストライドずらす
  let n = 0
  for (let k = 0; k < lines.count && n < MAX_SAMPLES; k++) {
    const y = d[k * 3]
    const x1 = d[k * 3 + 1]
    const x2 = d[k * 3 + 2]
    const len = x2 - x1 + 1
    while (acc < len && n < MAX_SAMPLES) {
      out[n * 2] = x1 + acc
      out[n * 2 + 1] = y
      n++
      acc += stride
    }
    acc -= len
  }
  return n
}

/* ------------------------------------------------------------------ */
/* アフィンフィットと図形への射影                                        */
/* ------------------------------------------------------------------ */

/** x' = a·x + b·y + c,  y' = d·x + e·y + f */
export interface Affine {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 }

function median(v: number[]): number {
  if (v.length === 0) return 0
  const s = [...v].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * フローベクトル群 (x,y)→(x+u, y+v) にアフィンを最小二乗フィット。
 * 点が少ない・退化している・推定が暴れているときは平行移動(中央値)へ落とす。
 */
export function fitAffine(pts: Float64Array, flows: Float64Array, n: number): Affine {
  const us: number[] = []
  const vs: number[] = []
  for (let i = 0; i < n; i++) {
    us.push(flows[i * 2])
    vs.push(flows[i * 2 + 1])
  }
  const translation = (): Affine => ({ a: 1, b: 0, c: median(us), d: 0, e: 1, f: median(vs) })
  if (n < 6) return n >= 1 ? translation() : IDENTITY

  // 座標を重心中心化して正規方程式を解く(条件数のため)
  let mx = 0
  let my = 0
  for (let i = 0; i < n; i++) {
    mx += pts[i * 2]
    my += pts[i * 2 + 1]
  }
  mx /= n
  my /= n

  let sxx = 0
  let sxy = 0
  let syy = 0
  let sxu = 0
  let syu = 0
  let su = 0
  let sxv = 0
  let syv = 0
  let sv = 0
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2] - mx
    const y = pts[i * 2 + 1] - my
    const u = flows[i * 2]
    const v = flows[i * 2 + 1]
    sxx += x * x
    sxy += x * y
    syy += y * y
    sxu += x * u
    syu += y * u
    su += u
    sxv += x * v
    syv += y * v
    sv += v
  }
  const det = sxx * syy - sxy * sxy
  // 点が一直線に近い(退化)なら平行移動のみ
  if (det < 1e-3 * Math.max(1, sxx + syy)) return translation()
  const inv = 1 / det
  // du(x,y) = p·x + q·y + r を各成分で解く
  const p1 = (syy * sxu - sxy * syu) * inv
  const q1 = (sxx * syu - sxy * sxu) * inv
  const r1 = su / n
  const p2 = (syy * sxv - sxy * syv) * inv
  const q2 = (sxx * syv - sxy * sxv) * inv
  const r2 = sv / n

  // 変位場 → 変換行列 (中心化を戻す)
  const A: Affine = {
    a: 1 + p1,
    b: q1,
    c: r1 + mx - (1 + p1) * mx - q1 * my,
    d: p2,
    e: 1 + q2,
    f: r2 + my - p2 * mx - (1 + q2) * my,
  }
  // 1フレームでの極端なスケール/シアーは追跡失敗の兆候 → 平行移動へ退避
  const detL = A.a * A.e - A.b * A.d
  const s1 = Math.hypot(A.a, A.d)
  const s2 = Math.hypot(A.b, A.e)
  if (detL < 0.45 || detL > 2.2 || s1 < 0.65 || s1 > 1.55 || s2 < 0.65 || s2 > 1.55) {
    return translation()
  }
  return A
}

/** アフィンから等方スケールと回転角を取り出す(半径・角度パラメータ用) */
export function affineScaleRot(A: Affine): { s: number; phi: number } {
  const det = A.a * A.e - A.b * A.d
  const s = clamp(Math.sqrt(Math.max(1e-6, Math.abs(det))), 0.8, 1.25)
  const phi = Math.atan2(A.d - A.b, A.a + A.e)
  return { s, phi }
}

function tx(A: Affine, x: number, y: number): [number, number] {
  return [A.a * x + A.b * y + A.c, A.d * x + A.e * y + A.f]
}

/**
 * アフィンを図形の自由度へ射影する。
 * 頂点自由な図形は各点をそのまま変換、半径・角度を持つ図形は
 * (平行移動, 等方スケール, 回転) に分解して適用する。
 */
export function advectShape(shape: Shape, A: Affine): Shape {
  const p = shape.p.slice()
  const { s, phi } = affineScaleRot(A)
  switch (shape.k) {
    case 'triangle':
    case 'quad':
    case 'line':
    case 'bezier': {
      const nPts = shape.k === 'triangle' || shape.k === 'bezier' ? 3 : shape.k === 'quad' ? 4 : 2
      for (let i = 0; i < nPts; i++) {
        const [x, y] = tx(A, p[i * 2], p[i * 2 + 1])
        p[i * 2] = x
        p[i * 2 + 1] = y
      }
      if (shape.k === 'line') p[4] *= s
      if (shape.k === 'bezier') p[6] *= s
      break
    }
    case 'rect': {
      // 軸平行を保つため、2隅を変換して min/max で再構成する
      const [x0, y0] = tx(A, p[0], p[1])
      const [x1, y1] = tx(A, p[2], p[3])
      p[0] = Math.min(x0, x1)
      p[1] = Math.min(y0, y1)
      p[2] = Math.max(x0, x1)
      p[3] = Math.max(y0, y1)
      break
    }
    case 'circle': {
      const [x, y] = tx(A, p[0], p[1])
      p[0] = x
      p[1] = y
      p[2] *= s
      break
    }
    case 'ellipse': {
      const [x, y] = tx(A, p[0], p[1])
      p[0] = x
      p[1] = y
      p[2] *= s
      p[3] *= s
      break
    }
    case 'rotellipse':
    case 'rotrect': {
      const [x, y] = tx(A, p[0], p[1])
      p[0] = x
      p[1] = y
      p[2] *= s
      p[3] *= s
      p[4] += phi
      break
    }
    case 'regular': {
      const [x, y] = tx(A, p[0], p[1])
      p[0] = x
      p[1] = y
      p[2] *= s
      p[3] += phi
      break
    }
  }
  return { k: shape.k, p }
}

/* ------------------------------------------------------------------ */
/* パラメータ空間の距離 ‖θ − θ′‖²_Λ                                     */
/* ------------------------------------------------------------------ */

/** 図形の外接円半径の概算(角度の重み付けに使う) */
export function circumRadius(shape: Shape): number {
  const p = shape.p
  switch (shape.k) {
    case 'circle':
    case 'regular':
      return p[2]
    case 'ellipse':
    case 'rotellipse':
      return Math.max(p[2], p[3])
    case 'rotrect':
      return Math.hypot(p[2], p[3]) / 2
    default: {
      const n = shape.k === 'quad' ? 4 : shape.k === 'triangle' || shape.k === 'bezier' ? 3 : 2
      let cx = 0
      let cy = 0
      for (let i = 0; i < n; i++) {
        cx += p[i * 2]
        cy += p[i * 2 + 1]
      }
      cx /= n
      cy /= n
      let r = 0
      for (let i = 0; i < n; i++) r = Math.max(r, Math.hypot(p[i * 2] - cx, p[i * 2 + 1] - cy))
      return r
    }
  }
}

/** 角度パラメータの位置(px と単位を揃えるため R を掛ける)。-1 = なし */
function angleIndex(k: Shape['k']): number {
  return k === 'rotrect' || k === 'rotellipse' ? 4 : k === 'regular' ? 3 : -1
}

/**
 * Λ 重み付きパラメータ距離の二乗。位置・半径・太さは px、
 * 角度は弧長換算(Δφ·R)で px に揃える。regular の辺数は不変なので除外。
 */
export function paramDist2(shape: Shape, ref: Shape): number {
  const a = shape.p
  const b = ref.p
  const ai = angleIndex(shape.k)
  const R = Math.max(1, circumRadius(ref))
  let d2 = 0
  const len = shape.k === 'regular' ? 3 : Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    if (i === ai) continue
    const d = a[i] - b[i]
    d2 += d * d
  }
  if (ai >= 0) {
    let da = a[ai] - b[ai]
    da = Math.atan2(Math.sin(da), Math.cos(da)) // 角度差を [-π,π] へ
    d2 += da * R * (da * R)
  }
  return d2
}
