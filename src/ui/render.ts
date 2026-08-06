/** Canvas 2D への高解像度描画(内部計算解像度から任意倍率へスケール) */

import { outlinePoints } from '../core/shapes'
import type { RGB, ShapeRecord } from '../core/types'

export function drawRecord(ctx: CanvasRenderingContext2D, rec: ShapeRecord, s: number): void {
  const p = rec.shape.p
  ctx.fillStyle = `rgba(${rec.color.r},${rec.color.g},${rec.color.b},${rec.alpha / 255})`
  ctx.beginPath()
  switch (rec.shape.k) {
    case 'rect':
      ctx.rect(
        Math.min(p[0], p[2]) * s,
        Math.min(p[1], p[3]) * s,
        Math.abs(p[2] - p[0]) * s,
        Math.abs(p[3] - p[1]) * s,
      )
      break
    case 'ellipse':
      ctx.ellipse(p[0] * s, p[1] * s, Math.max(0.1, p[2] * s), Math.max(0.1, p[3] * s), 0, 0, Math.PI * 2)
      break
    case 'circle':
      ctx.arc(p[0] * s, p[1] * s, Math.max(0.1, p[2] * s), 0, Math.PI * 2)
      break
    case 'rotellipse':
      ctx.ellipse(
        p[0] * s,
        p[1] * s,
        Math.max(0.1, p[2] * s),
        Math.max(0.1, p[3] * s),
        p[4],
        0,
        Math.PI * 2,
      )
      break
    default: {
      const pts = outlinePoints(rec.shape)
      if (!pts || pts.length < 6) return
      ctx.moveTo(pts[0] * s, pts[1] * s)
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] * s, pts[i + 1] * s)
      ctx.closePath()
    }
  }
  ctx.fill()
}

export function renderUpTo(
  ctx: CanvasRenderingContext2D,
  records: ShapeRecord[],
  count: number,
  bg: RGB,
  width: number,
  height: number,
  scale: number,
): void {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`
  ctx.fillRect(0, 0, width, height)
  const n = Math.min(count, records.length)
  for (let i = 0; i < n; i++) drawRecord(ctx, records[i], scale)
  ctx.restore()
}
