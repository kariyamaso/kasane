/**
 * キーフレーム列 → SMIL アニメーション SVG
 *
 * 各トラックを 1 要素にし、幾何・色・不透明度をキーフレームの keyTimes で
 * 線形補間アニメーションさせる。寿命 [birth, death) の外は fill-opacity 0。
 * 頂点数は種別ごとに一定(辺数・離散化数は不変)なので points 補間が成立する。
 */

import { rgbToHex } from '../core/color'
import { outlinePoints, rotEllipsePoints } from '../core/shapes'
import type { RGB, Shape } from '../core/types'
import type { KeyTrack, Keyframe } from './types'

const ELLIPSE_SEGMENTS = 40

function f(v: number): string {
  return (Math.round(v * 100) / 100).toString()
}

function f4(v: number): string {
  return (Math.round(v * 10000) / 10000).toString()
}

interface Entry {
  time: number // 0..1
  key: Keyframe
  opacity: number
}

/** polygon 用の点列(スケール済み文字列) */
function pointsOf(k: KeyTrack['k'], p: number[], s: number): string {
  const pts =
    k === 'rotellipse' ? rotEllipsePoints(p, ELLIPSE_SEGMENTS) : outlinePoints({ k, p } as Shape)
  if (!pts) return ''
  let out = ''
  for (let i = 0; i < pts.length; i += 2) out += `${f(pts[i] * s)},${f(pts[i + 1] * s)} `
  return out.trim()
}

function animate(attr: string, values: string[], keyTimes: string[], dur: number): string {
  return (
    `<animate attributeName="${attr}" dur="${f(dur)}s" repeatCount="indefinite" ` +
    `calcMode="linear" keyTimes="${keyTimes.join(';')}" values="${values.join(';')}"/>`
  )
}

/** 全値が同一なら null(静的属性で足りる) */
function animateIfVaries(
  attr: string,
  values: string[],
  keyTimes: string[],
  dur: number,
): string | null {
  return values.every((v) => v === values[0]) ? null : animate(attr, values, keyTimes, dur)
}

function trackToSvg(track: KeyTrack, totalFrames: number, dur: number, s: number): string {
  const F = totalFrames
  const entries: Entry[] = []
  const first = track.keys[0]
  const last = track.keys[track.keys.length - 1]

  // 寿命の外側を不透明度 0 で埋める。keyTimes は 0 で始まり 1 で終わる必要がある
  if (track.birth > 0) {
    entries.push({ time: 0, key: first, opacity: 0 })
    entries.push({ time: (track.birth - 0.4) / F, key: first, opacity: 0 })
  }
  for (const key of track.keys) entries.push({ time: key.t / F, key, opacity: key.alpha / 255 })
  if (track.death < F) {
    entries.push({ time: (track.death - 0.6) / F, key: last, opacity: 0 })
    entries.push({ time: 1, key: last, opacity: 0 })
  } else {
    entries.push({ time: 1, key: last, opacity: last.alpha / 255 })
  }
  // 単調増加を保証(隙間が詰まったときの同時刻キーを整理)
  const seq: Entry[] = []
  for (const e of entries) {
    const t = Math.min(1, Math.max(0, e.time))
    if (seq.length && t <= seq[seq.length - 1].time + 1e-6) {
      if (t >= 1 - 1e-6) continue
      seq.push({ ...e, time: seq[seq.length - 1].time + 1e-5 })
    } else {
      seq.push({ ...e, time: t })
    }
  }

  const keyTimes = seq.map((e) => f4(e.time))
  const fills = seq.map((e) => rgbToHex(e.key.color))
  const ops = seq.map((e) => f4(e.opacity))
  const k = track.k
  const parts: string[] = []

  const push = (tag: string, base: string, anims: (string | null)[]) => {
    const inner = anims.filter(Boolean).join('')
    parts.push(`<${tag} ${base}>${inner}</${tag}>`)
  }
  const fillAnim = animateIfVaries('fill', fills, keyTimes, dur)
  const opAnim = animateIfVaries('fill-opacity', ops, keyTimes, dur)
  const baseStyle = `fill="${fills[0]}" fill-opacity="${ops[0]}"`

  if (k === 'circle') {
    push('circle', `cx="${f(first.p[0] * s)}" cy="${f(first.p[1] * s)}" r="${f(first.p[2] * s)}" ${baseStyle}`, [
      animateIfVaries('cx', seq.map((e) => f(e.key.p[0] * s)), keyTimes, dur),
      animateIfVaries('cy', seq.map((e) => f(e.key.p[1] * s)), keyTimes, dur),
      animateIfVaries('r', seq.map((e) => f(e.key.p[2] * s)), keyTimes, dur),
      fillAnim,
      opAnim,
    ])
  } else if (k === 'ellipse') {
    push(
      'ellipse',
      `cx="${f(first.p[0] * s)}" cy="${f(first.p[1] * s)}" rx="${f(first.p[2] * s)}" ry="${f(first.p[3] * s)}" ${baseStyle}`,
      [
        animateIfVaries('cx', seq.map((e) => f(e.key.p[0] * s)), keyTimes, dur),
        animateIfVaries('cy', seq.map((e) => f(e.key.p[1] * s)), keyTimes, dur),
        animateIfVaries('rx', seq.map((e) => f(e.key.p[2] * s)), keyTimes, dur),
        animateIfVaries('ry', seq.map((e) => f(e.key.p[3] * s)), keyTimes, dur),
        fillAnim,
        opAnim,
      ],
    )
  } else if (k === 'rect') {
    const xs = seq.map((e) => f(Math.min(e.key.p[0], e.key.p[2]) * s))
    const ys = seq.map((e) => f(Math.min(e.key.p[1], e.key.p[3]) * s))
    const ws = seq.map((e) => f(Math.abs(e.key.p[2] - e.key.p[0]) * s))
    const hs = seq.map((e) => f(Math.abs(e.key.p[3] - e.key.p[1]) * s))
    push('rect', `x="${xs[0]}" y="${ys[0]}" width="${ws[0]}" height="${hs[0]}" ${baseStyle}`, [
      animateIfVaries('x', xs, keyTimes, dur),
      animateIfVaries('y', ys, keyTimes, dur),
      animateIfVaries('width', ws, keyTimes, dur),
      animateIfVaries('height', hs, keyTimes, dur),
      fillAnim,
      opAnim,
    ])
  } else {
    const pts = seq.map((e) => pointsOf(k, e.key.p, s))
    push('polygon', `points="${pts[0]}" ${baseStyle}`, [
      animateIfVaries('points', pts, keyTimes, dur),
      fillAnim,
      opAnim,
    ])
  }
  return parts.join('\n')
}

export function tracksToAnimatedSvg(
  tracks: KeyTrack[],
  totalFrames: number,
  fps: number,
  bg: RGB,
  compW: number,
  compH: number,
  outW: number,
): string {
  const s = outW / compW
  const outH = Math.round(compH * s)
  const dur = totalFrames / fps
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 ${outW} ${outH}">`,
    `<rect width="100%" height="100%" fill="${rgbToHex(bg)}"/>`,
  ]
  for (const t of tracks) {
    if (t.keys.length === 0) continue
    parts.push(trackToSvg(t, totalFrames, dur, s))
  }
  parts.push('</svg>')
  return parts.join('\n')
}
