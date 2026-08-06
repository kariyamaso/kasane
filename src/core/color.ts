/**
 * 配色モジュール
 *
 * 「その図形をどの色で塗るのが最も誤差を減らすか」は解析的に解ける
 * (score.ts の lineStats が集める誤差統計量から閉形式で得る)。
 * そのうえで、ユーザーが指定した色空間(グラデーション / 固定パレット / モノクロ階調)へ
 * 射影することで、忠実度を保ちながら作風をコントロールできる。
 */

import type { ColorConfig, RGB } from './types'

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
