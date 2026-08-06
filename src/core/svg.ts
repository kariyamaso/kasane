/** 中間状態を含む任意ステップの SVG 書き出し(ベクタなので無限に拡大できる) */

import { outlinePoints } from './shapes'
import { rgbToHex } from './color'
import type { RGB, ShapeRecord } from './types'

function f(v: number): string {
  return (Math.round(v * 100) / 100).toString()
}

function shapeToSvg(rec: ShapeRecord, s: number): string {
  const p = rec.shape.p
  const fill = rgbToHex(rec.color)
  const op = f(rec.alpha / 255)
  const attrs = `fill="${fill}" fill-opacity="${op}"`

  switch (rec.shape.k) {
    case 'rect':
      return `<rect x="${f(Math.min(p[0], p[2]) * s)}" y="${f(Math.min(p[1], p[3]) * s)}" width="${f(Math.abs(p[2] - p[0]) * s)}" height="${f(Math.abs(p[3] - p[1]) * s)}" ${attrs}/>`
    case 'ellipse':
      return `<ellipse cx="${f(p[0] * s)}" cy="${f(p[1] * s)}" rx="${f(p[2] * s)}" ry="${f(p[3] * s)}" ${attrs}/>`
    case 'circle':
      return `<circle cx="${f(p[0] * s)}" cy="${f(p[1] * s)}" r="${f(p[2] * s)}" ${attrs}/>`
    case 'rotellipse': {
      const deg = f((p[4] * 180) / Math.PI)
      return `<ellipse cx="${f(p[0] * s)}" cy="${f(p[1] * s)}" rx="${f(p[2] * s)}" ry="${f(p[3] * s)}" transform="rotate(${deg} ${f(p[0] * s)} ${f(p[1] * s)})" ${attrs}/>`
    }
    default: {
      const pts = outlinePoints(rec.shape)
      if (!pts) return ''
      let d = ''
      for (let i = 0; i < pts.length; i += 2) d += `${f(pts[i] * s)},${f(pts[i + 1] * s)} `
      return `<polygon points="${d.trim()}" ${attrs}/>`
    }
  }
}

export function recordsToSvg(
  records: ShapeRecord[],
  count: number,
  bg: RGB,
  compW: number,
  compH: number,
  outW: number,
): string {
  const s = outW / compW
  const outH = Math.round(compH * s)
  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 ${outW} ${outH}">`,
  )
  parts.push(`<rect width="100%" height="100%" fill="${rgbToHex(bg)}"/>`)
  const n = Math.min(count, records.length)
  for (let i = 0; i < n; i++) parts.push(shapeToSvg(records[i], s))
  parts.push('</svg>')
  return parts.join('\n')
}
