/**
 * 配色モジュール
 *
 * 「その図形をどの色で塗るのが最も誤差を減らすか」は解析的に解ける(computeOptimalColor)。
 * そのうえで、ユーザーが指定した色空間(グラデーション / 固定パレット / モノクロ階調)へ
 * 射影することで、忠実度を保ちながら作風をコントロールできる。
 */

import type { ColorConfig, RGB } from './types'
import { ScanlineBuffer } from './raster'

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { r: 0, g: 0, b: 0 }
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function rgbToHex({ r, g, b }: RGB): string {
  const f = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')
  return `#${f(r)}${f(g)}${f(b)}`
}

export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * 図形が覆う領域について、合成後に元画像へ最も近づく塗り色を閉形式で求める。
 *   result = current*(1-a) + s*a  を  result ≈ target  にしたいので
 *   s = current + (target - current) / a
 * これを被覆画素で平均する。
 */
export function computeOptimalColor(
  target: Uint8ClampedArray,
  current: Uint8ClampedArray,
  lines: ScanlineBuffer,
  alpha: number,
  w: number,
): RGB {
  const a = alpha / 255
  let rs = 0
  let gs = 0
  let bs = 0
  let count = 0
  const d = lines.data
  for (let s = 0; s < lines.count; s++) {
    const y = d[s * 3]
    const x1 = d[s * 3 + 1]
    const x2 = d[s * 3 + 2]
    let i = (y * w + x1) * 4
    for (let x = x1; x <= x2; x++, i += 4) {
      const cr = current[i]
      const cg = current[i + 1]
      const cb = current[i + 2]
      rs += cr + (target[i] - cr) / a
      gs += cg + (target[i + 1] - cg) / a
      bs += cb + (target[i + 2] - cb) / a
      count++
    }
  }
  if (count === 0) return { r: 0, g: 0, b: 0 }
  const cl = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)
  return { r: cl(rs / count), g: cl(gs / count), b: cl(bs / count) }
}

/** 平均色(背景の初期値に使う) */
export function averageColor(px: Uint8ClampedArray): RGB {
  let r = 0
  let g = 0
  let b = 0
  const n = px.length / 4
  for (let i = 0; i < px.length; i += 4) {
    r += px[i]
    g += px[i + 1]
    b += px[i + 2]
  }
  return { r: r / n, g: g / n, b: b / n }
}

const LUT_SIZE = 256

/** 色モードに応じて最適色を制約色空間へ射影する。 */
export class ColorConstraint {
  private mode: ColorConfig['mode']
  private mapping: ColorConfig['mapping']
  private blend: number
  private lut: Float64Array | null = null // グラデーション/モノクロのランプ
  private palette: RGB[] = [] // 離散パレット

  constructor(cfg: ColorConfig) {
    this.mode = cfg.mode
    this.mapping = cfg.mapping
    this.blend = Math.max(0, Math.min(1, cfg.blend))
    const stops = (cfg.stops.length ? cfg.stops : ['#000000', '#ffffff']).map(hexToRgb)

    if (cfg.mode === 'palette') {
      this.palette = stops
    } else if (cfg.mode === 'gradient' || cfg.mode === 'mono') {
      const ramp = cfg.mode === 'mono' ? stops.slice(0, 2) : stops
      const list = ramp.length >= 2 ? ramp : [ramp[0] ?? { r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }]
      this.lut = buildRamp(list)
    }
  }

  apply(c: RGB): RGB {
    let out: RGB
    switch (this.mode) {
      case 'auto':
        return c
      case 'palette':
        out = nearestOf(this.palette, c)
        break
      case 'mono':
      case 'gradient': {
        const lut = this.lut!
        const idx =
          this.mode === 'mono' || this.mapping === 'luma'
            ? Math.round((luma(c.r, c.g, c.b) / 255) * (LUT_SIZE - 1))
            : nearestLutIndex(lut, c)
        out = { r: lut[idx * 3], g: lut[idx * 3 + 1], b: lut[idx * 3 + 2] }
        break
      }
    }
    if (this.blend > 0) {
      const t = this.blend
      out = {
        r: out.r * (1 - t) + c.r * t,
        g: out.g * (1 - t) + c.g * t,
        b: out.b * (1 - t) + c.b * t,
      }
    }
    return out
  }
}

function buildRamp(stops: RGB[]): Float64Array {
  const lut = new Float64Array(LUT_SIZE * 3)
  const segs = stops.length - 1
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = (i / (LUT_SIZE - 1)) * segs
    const s = Math.min(segs - 1, Math.floor(t))
    const f = t - s
    const a = stops[s]
    const b = stops[s + 1]
    lut[i * 3] = a.r + (b.r - a.r) * f
    lut[i * 3 + 1] = a.g + (b.g - a.g) * f
    lut[i * 3 + 2] = a.b + (b.b - a.b) * f
  }
  return lut
}

function nearestLutIndex(lut: Float64Array, c: RGB): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < LUT_SIZE; i++) {
    const dr = lut[i * 3] - c.r
    const dg = lut[i * 3 + 1] - c.g
    const db = lut[i * 3 + 2] - c.b
    const d = dr * dr + dg * dg + db * db
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

function nearestOf(palette: RGB[], c: RGB): RGB {
  let best = palette[0] ?? { r: 0, g: 0, b: 0 }
  let bestD = Infinity
  for (const p of palette) {
    const dr = p.r - c.r
    const dg = p.g - c.g
    const db = p.b - c.b
    const d = dr * dr + dg * dg + db * db
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  return best
}
