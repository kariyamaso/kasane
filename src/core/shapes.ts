/**
 * 図形プリミティブの生成 / 変異 / ラスタライズ
 *
 * P_i = (形状, 位置, 大きさ, 回転, 色, α) のうち
 * ここでは「形状・位置・大きさ・回転」を扱う。色と α は color.ts / model.ts の担当。
 *
 * ## サイズの扱い
 * サイズは一貫して **外接円半径 R**(図形の重心から最も遠い点までの距離)で表す。
 * 呼び出し側が [minR, maxR] を px で渡し、
 *   - 生成時: R を [minR, maxR] から引いて図形を作る
 *   - 変異時: 半径パラメータをクランプし、頂点自由な図形は重心中心にスケールして押し戻す
 * ことで、探索の全域にわたってサイズ範囲が保証される。
 */

import { Rng, clamp } from './rng'
import {
  ScanlineBuffer,
  ellipseScanlines,
  polygonScanlines,
  quadBezierPath,
  quadBezierPathInto,
  rectScanlines,
  strokeOutline,
  strokeOutlineInto,
} from './raster'
import type { Shape, ShapeKind } from './types'

export interface SizeRange {
  /** 外接円半径の下限 (px) */
  minR: number
  /** 外接円半径の上限 (px) */
  maxR: number
}

/** 画像サイズから決まる基準スケール(長辺) */
function unitOf(w: number, h: number): number {
  return Math.max(w, h)
}

/** 頂点が自由な図形について、先頭から何個の (x,y) が幾何を成すか */
function pointSpan(kind: ShapeKind): number {
  switch (kind) {
    case 'triangle':
      return 3
    case 'quad':
      return 4
    case 'rect':
      return 2
    case 'line':
      return 2
    case 'bezier':
      return 3
    default:
      return 0 // 半径パラメータを持つ図形
  }
}

/** 線の太さの範囲をサイズ範囲から導く */
function strokeRange(sz: SizeRange): [number, number] {
  return [Math.max(0.7, sz.minR * 0.3), Math.max(1.2, sz.maxR * 0.25)]
}

/* ------------------------------------------------------------------ */
/* ランダム初期化                                                       */
/* ------------------------------------------------------------------ */

export function randomShape(
  kind: ShapeKind,
  w: number,
  h: number,
  rng: Rng,
  sides: number[],
  sz: SizeRange,
): Shape {
  const cx = rng.range(0, w)
  const cy = rng.range(0, h)
  const R = rng.range(sz.minR, sz.maxR) // この図形の目標外接円半径
  const [wMin, wMax] = strokeRange(sz)
  // 三角形やベジェは頂点をガウス分布で散らすため、目標 R を超えることがある。
  // 最後に必ず範囲へ押し戻す(下の return を参照)。
  const fit = (s: Shape) => constrainSize(s, Math.max(0.5, sz.minR), sz.maxR)

  switch (kind) {
    case 'triangle': {
      const s = R * 0.85
      return fit({
        k: kind,
        p: [
          cx + rng.gauss() * s,
          cy + rng.gauss() * s,
          cx + rng.gauss() * s,
          cy + rng.gauss() * s,
          cx + rng.gauss() * s,
          cy + rng.gauss() * s,
        ],
      })
    }
    case 'quad': {
      // 破綻した蝶ネクタイ形を避けるため、回転矩形を歪ませて作る
      const [hw, hh] = halfExtents(R, rng)
      const a = rng.range(0, Math.PI * 2)
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      const p: number[] = []
      for (const [ox, oy] of [
        [-hw, -hh],
        [hw, -hh],
        [hw, hh],
        [-hw, hh],
      ]) {
        const jx = ox + rng.gauss() * hw * 0.15
        const jy = oy + rng.gauss() * hh * 0.15
        p.push(cx + jx * ca - jy * sa, cy + jx * sa + jy * ca)
      }
      return fit({ k: kind, p })
    }
    case 'rect': {
      const [hw, hh] = halfExtents(R, rng)
      return fit({ k: kind, p: [cx - hw, cy - hh, cx + hw, cy + hh] })
    }
    case 'rotrect': {
      const [hw, hh] = halfExtents(R, rng)
      return { k: kind, p: [cx, cy, hw * 2, hh * 2, rng.range(0, Math.PI * 2)] }
    }
    case 'ellipse':
    case 'rotellipse': {
      const minor = R * rng.range(0.2, 1)
      const flip = rng.next() < 0.5
      const rx = flip ? R : minor
      const ry = flip ? minor : R
      return kind === 'ellipse'
        ? { k: kind, p: [cx, cy, rx, ry] }
        : { k: kind, p: [cx, cy, rx, ry, rng.range(0, Math.PI * 2)] }
    }
    case 'circle':
      return { k: kind, p: [cx, cy, R] }
    case 'regular': {
      const n = sides.length ? rng.pick(sides) : 6
      return { k: kind, p: [cx, cy, R, rng.range(0, Math.PI * 2), n] }
    }
    case 'line': {
      const a = rng.range(0, Math.PI * 2)
      const dx = Math.cos(a) * R
      const dy = Math.sin(a) * R
      return fit({
        k: kind,
        p: [cx - dx, cy - dy, cx + dx, cy + dy, rng.range(wMin, wMax)],
      })
    }
    case 'bezier': {
      const a = rng.range(0, Math.PI * 2)
      const dx = Math.cos(a) * R
      const dy = Math.sin(a) * R
      return fit({
        k: kind,
        p: [
          cx - dx,
          cy - dy,
          cx + rng.gauss() * R * 0.5,
          cy + rng.gauss() * R * 0.5,
          cx + dx,
          cy + dy,
          rng.range(wMin, wMax),
        ],
      })
    }
  }
}

/** 外接円半径 R をもつ矩形の半幅・半高(角の距離がちょうど R になる) */
function halfExtents(R: number, rng: Rng): [number, number] {
  const theta = rng.range(0.24, Math.PI / 2 - 0.24) // 極端なアスペクト比を避ける
  return [R * Math.cos(theta), R * Math.sin(theta)]
}

/* ------------------------------------------------------------------ */
/* 変異(局所探索の 1 手)                                                */
/* ------------------------------------------------------------------ */

export function mutateShape(
  shape: Shape,
  w: number,
  h: number,
  rng: Rng,
  sz: SizeRange,
  temp = 1,
): Shape {
  const u = unitOf(w, h)
  // 探索したいサイズより大きく揺らしても無駄なので、上限側にも合わせる
  const sigma = Math.max(0.75, Math.min(u * 0.06, sz.maxR * 0.6)) * temp
  const p = shape.p.slice()
  const lox = -0.15 * w
  const hix = 1.15 * w
  const loy = -0.15 * h
  const hiy = 1.15 * h
  const minR = Math.max(0.5, sz.minR)
  const maxR = Math.max(minR + 0.5, sz.maxR)
  const [, wMax] = strokeRange(sz)

  const jitterPoint = (i: number) => {
    p[i] = clamp(p[i] + rng.gauss() * sigma, lox, hix)
    p[i + 1] = clamp(p[i + 1] + rng.gauss() * sigma, loy, hiy)
  }
  // 個々の半径・辺長は緩めにクランプし、外接円半径としての厳密な範囲は
  // 最後の constrainSize で保証する(回転矩形は対角が maxR なので辺は maxR を超えうる)
  const rLo = Math.max(0.35, minR * 0.3)
  const jitterR = (i: number, hi = maxR) => {
    p[i] = clamp(p[i] + rng.gauss() * sigma, rLo, hi)
  }

  switch (shape.k) {
    case 'triangle':
      jitterPoint(rng.int(3) * 2)
      break
    case 'quad':
      jitterPoint(rng.int(4) * 2)
      break
    case 'rect':
      jitterPoint(rng.int(2) * 2)
      break
    case 'rotrect':
      switch (rng.int(3)) {
        case 0:
          jitterPoint(0)
          break
        case 1:
          jitterR(2, maxR * 2)
          jitterR(3, maxR * 2)
          break
        default:
          p[4] += rng.gauss() * 0.5 * temp
      }
      break
    case 'ellipse':
      if (rng.next() < 0.5) jitterPoint(0)
      else {
        jitterR(2)
        jitterR(3)
      }
      break
    case 'rotellipse':
      switch (rng.int(3)) {
        case 0:
          jitterPoint(0)
          break
        case 1:
          jitterR(2)
          jitterR(3)
          break
        default:
          p[4] += rng.gauss() * 0.5 * temp
      }
      break
    case 'circle':
      if (rng.next() < 0.5) jitterPoint(0)
      else jitterR(2)
      break
    case 'regular':
      switch (rng.int(3)) {
        case 0:
          jitterPoint(0)
          break
        case 1:
          jitterR(2)
          break
        default:
          p[3] += rng.gauss() * 0.5 * temp
      }
      break
    case 'line':
      if (rng.next() < 0.75) jitterPoint(rng.int(2) * 2)
      else p[4] = clamp(p[4] + rng.gauss() * sigma * 0.35, 0.7, wMax)
      break
    case 'bezier':
      if (rng.next() < 0.8) jitterPoint(rng.int(3) * 2)
      else p[6] = clamp(p[6] + rng.gauss() * sigma * 0.35, 0.7, wMax)
      break
  }
  return constrainSize({ k: shape.k, p }, minR, maxR)
}

/**
 * 図形の外接円半径を [minR, maxR] に収める。
 * 頂点が自由な図形は重心を中心にスケールし、
 * 半径パラメータを持つ図形はアスペクト比を保ったまま半径をスケールする。
 */
export function constrainSize(shape: Shape, minR: number, maxR: number): Shape {
  const n = pointSpan(shape.k)
  if (n === 0) return constrainRadial(shape, minR, maxR)
  const p = shape.p
  let cx = 0
  let cy = 0
  for (let i = 0; i < n; i++) {
    cx += p[i * 2]
    cy += p[i * 2 + 1]
  }
  cx /= n
  cy /= n

  let d = 0
  for (let i = 0; i < n; i++) {
    const dd = Math.hypot(p[i * 2] - cx, p[i * 2 + 1] - cy)
    if (dd > d) d = dd
  }
  // rect は 2 点(対角)なので、重心からの距離がそのまま外接円半径
  if (d < 1e-6) return shape

  const s = d > maxR ? maxR / d : d < minR ? minR / d : 1
  if (s === 1) return shape

  const q = p.slice()
  for (let i = 0; i < n; i++) {
    q[i * 2] = cx + (q[i * 2] - cx) * s
    q[i * 2 + 1] = cy + (q[i * 2 + 1] - cy) * s
  }
  return { k: shape.k, p: q }
}

/** 半径パラメータを持つ図形のサイズ制約 */
function constrainRadial(shape: Shape, minR: number, maxR: number): Shape {
  const p = shape.p.slice()
  let R: number
  switch (shape.k) {
    case 'circle':
    case 'regular':
      p[2] = clamp(p[2], minR, maxR)
      return { k: shape.k, p }
    case 'ellipse':
    case 'rotellipse':
      R = Math.max(p[2], p[3])
      break
    case 'rotrect':
      R = Math.hypot(p[2] / 2, p[3] / 2) // 対角の半分 = 外接円半径
      break
    default:
      return shape
  }
  if (R < 1e-6) return shape
  const s = R > maxR ? maxR / R : R < minR ? minR / R : 1
  if (s === 1) return shape
  p[2] *= s
  p[3] *= s
  return { k: shape.k, p }
}

/* ------------------------------------------------------------------ */
/* ラスタライズ                                                         */
/* ------------------------------------------------------------------ */

const ELLIPSE_SEGMENTS = 40

// 最適化ループでは 1 候補ごとにラスタライズするので、点列生成の配列アロケーションを
// 避けるためのスクラッチ領域(Worker 内で単一スレッド利用なので共有してよい)
const pathBuf = new Float64Array(64) // 折れ線(ベジェ離散化で最大 17 点)
const polyBuf = new Float64Array(256) // 輪郭ポリゴン(最大: ベジェのストローク 34 点)

export function shapeScanlines(shape: Shape, w: number, h: number, out: ScanlineBuffer): void {
  out.reset()
  const p = shape.p
  switch (shape.k) {
    case 'triangle':
    case 'quad': {
      for (let i = 0; i < p.length; i++) polyBuf[i] = p[i]
      polygonScanlines(polyBuf, w, h, out, p.length >> 1)
      break
    }
    case 'rect':
      rectScanlines(p[0], p[1], p[2], p[3], w, h, out)
      break
    case 'rotrect':
      polygonScanlines(polyBuf, w, h, out, rotRectPointsInto(p, polyBuf))
      break
    case 'ellipse':
      ellipseScanlines(p[0], p[1], p[2], p[3], w, h, out)
      break
    case 'circle':
      ellipseScanlines(p[0], p[1], p[2], p[2], w, h, out)
      break
    case 'rotellipse':
      polygonScanlines(polyBuf, w, h, out, rotEllipsePointsInto(p, ELLIPSE_SEGMENTS, polyBuf))
      break
    case 'regular':
      polygonScanlines(polyBuf, w, h, out, regularPointsInto(p, polyBuf))
      break
    case 'line':
      pathBuf[0] = p[0]
      pathBuf[1] = p[1]
      pathBuf[2] = p[2]
      pathBuf[3] = p[3]
      polygonScanlines(polyBuf, w, h, out, strokeOutlineInto(pathBuf, 2, p[4], polyBuf))
      break
    case 'bezier': {
      const n = quadBezierPathInto(p[0], p[1], p[2], p[3], p[4], p[5], 16, pathBuf)
      polygonScanlines(polyBuf, w, h, out, strokeOutlineInto(pathBuf, n, p[6], polyBuf))
      break
    }
  }
}

function rotRectPointsInto(p: number[], out: Float64Array): number {
  const [cx, cy, rw, rh, a] = p
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const hw = rw / 2
  const hh = rh / 2
  let m = 0
  for (const [ox, oy] of [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ]) {
    out[m * 2] = cx + ox * ca - oy * sa
    out[m * 2 + 1] = cy + ox * sa + oy * ca
    m++
  }
  return m
}

function rotEllipsePointsInto(p: number[], segments: number, out: Float64Array): number {
  const [cx, cy, rx, ry, a] = p
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2
    const ox = Math.cos(t) * rx
    const oy = Math.sin(t) * ry
    out[i * 2] = cx + ox * ca - oy * sa
    out[i * 2 + 1] = cy + ox * sa + oy * ca
  }
  return segments
}

function regularPointsInto(p: number[], out: Float64Array): number {
  const [cx, cy, r, a, nRaw] = p
  const n = Math.max(3, Math.round(nRaw))
  for (let i = 0; i < n; i++) {
    const t = a + (i / n) * Math.PI * 2
    out[i * 2] = cx + Math.cos(t) * r
    out[i * 2 + 1] = cy + Math.sin(t) * r
  }
  return n
}

export function rotRectPoints(p: number[]): number[] {
  const buf = new Float64Array(8)
  return Array.from(buf.subarray(0, rotRectPointsInto(p, buf) * 2))
}

export function rotEllipsePoints(p: number[], segments: number): number[] {
  const buf = new Float64Array(segments * 2)
  return Array.from(buf.subarray(0, rotEllipsePointsInto(p, segments, buf) * 2))
}

export function regularPoints(p: number[]): number[] {
  const buf = new Float64Array(Math.max(3, Math.round(p[4])) * 2)
  return Array.from(buf.subarray(0, regularPointsInto(p, buf) * 2))
}

/** 図形の輪郭点列(描画・SVG 用)。楕円系は null を返し、呼び出し側で専用処理する。 */
export function outlinePoints(shape: Shape): number[] | null {
  switch (shape.k) {
    case 'triangle':
    case 'quad':
      return shape.p.slice()
    case 'rotrect':
      return rotRectPoints(shape.p)
    case 'regular':
      return regularPoints(shape.p)
    case 'line':
      return strokeOutline([shape.p[0], shape.p[1], shape.p[2], shape.p[3]], shape.p[4])
    case 'bezier':
      return strokeOutline(
        quadBezierPath(shape.p[0], shape.p[1], shape.p[2], shape.p[3], shape.p[4], shape.p[5]),
        shape.p[6],
      )
    default:
      return null
  }
}
