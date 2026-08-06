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

/** 図形を置いた「後」の SSE を、実際には描かずに見積もる。 */
export function partialSSE(
  target: Uint8ClampedArray,
  current: Uint8ClampedArray,
  lines: ScanlineBuffer,
  color: RGB,
  alpha: number,
  w: number,
  baseSSE: number,
): number {
  const a = alpha / 255
  const ia = 1 - a
  const sr = color.r * a
  const sg = color.g * a
  const sb = color.b * a
  let s = baseSSE
  const d = lines.data
  for (let k = 0; k < lines.count; k++) {
    const y = d[k * 3]
    const x1 = d[k * 3 + 1]
    const x2 = d[k * 3 + 2]
    let i = (y * w + x1) * 4
    for (let x = x1; x <= x2; x++, i += 4) {
      const tr = target[i]
      const tg = target[i + 1]
      const tb = target[i + 2]
      const cr = current[i]
      const cg = current[i + 1]
      const cb = current[i + 2]
      // 旧誤差を除去
      let dr = tr - cr
      let dg = tg - cg
      let db = tb - cb
      s -= dr * dr + dg * dg + db * db
      // 新誤差を加算
      dr = tr - (cr * ia + sr)
      dg = tg - (cg * ia + sg)
      db = tb - (cb * ia + sb)
      s += dr * dr + dg * dg + db * db
    }
  }
  return s
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
