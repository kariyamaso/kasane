/**
 * 誤差評価と合成
 *
 * 全画素の二乗誤差和(SSE)を状態として持ち回り、図形を置いたときは
 * 「その図形が覆う画素だけ」を差し引き・足し直すことで O(被覆画素) で更新する。
 */

import type { RGB } from './types'
import { ScanlineBuffer } from './raster'

export function fullSSE(target: Uint8ClampedArray, current: Uint8ClampedArray): number {
  let s = 0
  for (let i = 0; i < target.length; i += 4) {
    const dr = target[i] - current[i]
    const dg = target[i + 1] - current[i + 1]
    const db = target[i + 2] - current[i + 2]
    s += dr * dr + dg * dg + db * db
  }
  return s
}

/** SSE を 0..1 の RMSE に正規化(人間が読める指標) */
export function rmse(sse: number, pixels: number): number {
  return Math.sqrt(sse / (pixels * 3)) / 255
}

/**
 * 被覆画素の誤差統計を 1 パスで収集する。
 *
 * e = t - c·(1-α) と置くと、塗り色 s での合成後誤差は
 *   Σ (e - s·α)² = Σe² - 2α·s·Σe + n·α²·s²   (チャンネルごと)
 * となり、Σe・Σe²・旧誤差 Σ(t-c)² さえあれば
 *   - 最適色      s* = Σe / (n·α)
 *   - 任意の色での SSE
 * の両方が走査なしの閉形式で得られる。従来は最適色と SSE で
 * 2 パス(+画素あたり 3 除算)必要だった処理がこの 1 パスに融合される。
 *
 * out = [Σe_r, Σe_g, Σe_b, Σe²(全ch), Σ旧誤差]。戻り値は被覆画素数。
 */
export function lineStats(
  target: Uint8ClampedArray,
  current: Uint8ClampedArray,
  lines: ScanlineBuffer,
  alpha: number,
  w: number,
  out: Float64Array,
): number {
  const ia = 1 - alpha / 255
  let er = 0
  let eg = 0
  let eb = 0
  let e2 = 0
  let old = 0
  let n = 0
  const d = lines.data
  const cnt = lines.count
  for (let k = 0; k < cnt; k++) {
    const p = k * 3
    const y = d[p]
    const x1 = d[p + 1]
    const x2 = d[p + 2]
    let i = (y * w + x1) * 4
    for (let x = x1; x <= x2; x++, i += 4) {
      const tr = target[i]
      const tg = target[i + 1]
      const tb = target[i + 2]
      const cr = current[i]
      const cg = current[i + 1]
      const cb = current[i + 2]
      const dr = tr - cr
      const dg = tg - cg
      const db = tb - cb
      old += dr * dr + dg * dg + db * db
      const xr = tr - cr * ia
      const xg = tg - cg * ia
      const xb = tb - cb * ia
      er += xr
      eg += xg
      eb += xb
      e2 += xr * xr + xg * xg + xb * xb
    }
    n += x2 - x1 + 1
  }
  out[0] = er
  out[1] = eg
  out[2] = eb
  out[3] = e2
  out[4] = old
  return n
}

/** lineStats の統計量から、色 color を塗ったときの合成後 SSE を閉形式で求める。 */
export function sseFromStats(
  stats: Float64Array,
  n: number,
  color: RGB,
  alpha: number,
  baseSSE: number,
): number {
  const a = alpha / 255
  const { r, g, b } = color
  return (
    baseSSE -
    stats[4] +
    stats[3] -
    2 * a * (r * stats[0] + g * stats[1] + b * stats[2]) +
    n * a * a * (r * r + g * g + b * b)
  )
}

/** 実際に current バッファへアルファ合成する。 */
export function drawLines(
  current: Uint8ClampedArray,
  lines: ScanlineBuffer,
  color: RGB,
  alpha: number,
  w: number,
): void {
  const a = alpha / 255
  const ia = 1 - a
  const sr = color.r * a
  const sg = color.g * a
  const sb = color.b * a
  const d = lines.data
  for (let k = 0; k < lines.count; k++) {
    const y = d[k * 3]
    const x1 = d[k * 3 + 1]
    const x2 = d[k * 3 + 2]
    let i = (y * w + x1) * 4
    for (let x = x1; x <= x2; x++, i += 4) {
      current[i] = current[i] * ia + sr
      current[i + 1] = current[i + 1] * ia + sg
      current[i + 2] = current[i + 2] * ia + sb
    }
  }
}
