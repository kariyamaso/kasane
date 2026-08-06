/**
 * スキャンライン・ラスタライザ
 *
 * 図形を「行 y における塗り区間 [x1,x2]」の列に変換する。
 * 差分スコアの計算も描画も、この区間列だけを走査すれば済むので
 * 画像全体を毎回舐めるより桁違いに速い。これが primitive 系手法の心臓部。
 */

/** 区間は [y, x1, x2] の 3 要素ずつフラットに詰める(GC 削減のため) */
export type Scanlines = Int32Array & { count?: number }

export class ScanlineBuffer {
  data: Int32Array
  count = 0 // 区間の本数

  constructor(capacity = 4096) {
    this.data = new Int32Array(capacity * 3)
  }

  reset() {
    this.count = 0
  }

  push(y: number, x1: number, x2: number) {
    if ((this.count + 1) * 3 > this.data.length) {
      const bigger = new Int32Array(this.data.length * 2)
      bigger.set(this.data)
      this.data = bigger
    }
    const i = this.count * 3
    this.data[i] = y
    this.data[i + 1] = x1
    this.data[i + 2] = x2
    this.count++
  }

  /** 塗られるピクセル総数 */
  pixelCount(): number {
    let n = 0
    const d = this.data
    for (let i = 0; i < this.count; i++) n += d[i * 3 + 2] - d[i * 3 + 1] + 1
    return n
  }

  clone(): ScanlineBuffer {
    const b = new ScanlineBuffer(Math.max(1, this.count))
    b.data = this.data.slice(0, this.count * 3)
    b.count = this.count
    return b
  }
}

// 交点計算用のスクラッチ領域(毎行のアロケーションを避ける)
const xsBuf = new Float64Array(64)
const dirBuf = new Int8Array(64)
const orderBuf = new Int32Array(64)

/**
 * 任意多角形を nonzero winding 規則で塗る。
 * 自己交差するストローク輪郭でも穴が空きにくい。
 * pts は [x0,y0, x1,y1, ...] のフラット配列。
 */
export function polygonScanlines(
  pts: Float64Array, // 常に Float64Array で受ける(number[] と混在させると V8 がポリモーフィック化して遅くなる)
  w: number,
  h: number,
  out: ScanlineBuffer,
  nPts = pts.length >> 1, // スクラッチバッファ利用時は有効な点数を明示する
): void {
  const n = nPts
  if (n < 3) return

  let ymin = Infinity
  let ymax = -Infinity
  for (let i = 0; i < n; i++) {
    const y = pts[i * 2 + 1]
    if (y < ymin) ymin = y
    if (y > ymax) ymax = y
  }
  const y0 = Math.max(0, Math.floor(ymin))
  const y1 = Math.min(h - 1, Math.ceil(ymax))
  if (y1 < y0) return

  for (let y = y0; y <= y1; y++) {
    const sy = y + 0.5
    let m = 0
    for (let i = 0; i < n; i++) {
      const ax = pts[i * 2]
      const ay = pts[i * 2 + 1]
      const j = i + 1 === n ? 0 : i + 1
      const bx = pts[j * 2]
      const by = pts[j * 2 + 1]
      if (ay === by) continue
      // 半開区間 [min, max) で数えると頂点の二重カウントを避けられる
      if ((sy >= ay && sy < by) || (sy >= by && sy < ay)) {
        if (m >= xsBuf.length) break
        const t = (sy - ay) / (by - ay)
        xsBuf[m] = ax + t * (bx - ax)
        dirBuf[m] = by > ay ? 1 : -1
        m++
      }
    }
    if (m < 2) continue

    // 交点を x 昇順に(挿入ソート: m は通常 2〜8 程度)
    for (let i = 0; i < m; i++) orderBuf[i] = i
    for (let i = 1; i < m; i++) {
      const key = orderBuf[i]
      const kx = xsBuf[key]
      let j = i - 1
      while (j >= 0 && xsBuf[orderBuf[j]] > kx) {
        orderBuf[j + 1] = orderBuf[j]
        j--
      }
      orderBuf[j + 1] = key
    }

    let wind = 0
    let spanStart = 0
    for (let k = 0; k < m; k++) {
      const idx = orderBuf[k]
      const prev = wind
      wind += dirBuf[idx]
      if (prev === 0 && wind !== 0) {
        spanStart = xsBuf[idx]
      } else if (prev !== 0 && wind === 0) {
        let x1 = Math.round(spanStart)
        let x2 = Math.round(xsBuf[idx]) - 1
        if (x1 < 0) x1 = 0
        if (x2 > w - 1) x2 = w - 1
        if (x2 >= x1) out.push(y, x1, x2)
      }
    }
  }
}

/** 軸平行楕円(円を含む)は解析的に塗ったほうが速く滑らか。 */
export function ellipseScanlines(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  w: number,
  h: number,
  out: ScanlineBuffer,
): void {
  if (rx < 0.5 || ry < 0.5) return
  const y0 = Math.max(0, Math.floor(cy - ry))
  const y1 = Math.min(h - 1, Math.ceil(cy + ry))
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - cy) / ry
    if (dy <= -1 || dy >= 1) continue
    const dx = rx * Math.sqrt(1 - dy * dy)
    let x1 = Math.round(cx - dx)
    let x2 = Math.round(cx + dx) - 1
    if (x1 < 0) x1 = 0
    if (x2 > w - 1) x2 = w - 1
    if (x2 >= x1) out.push(y, x1, x2)
  }
}

/** 軸平行矩形 */
export function rectScanlines(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  w: number,
  h: number,
  out: ScanlineBuffer,
): void {
  const x1 = Math.max(0, Math.round(Math.min(ax, bx)))
  const x2 = Math.min(w - 1, Math.round(Math.max(ax, bx)) - 1)
  const y1 = Math.max(0, Math.round(Math.min(ay, by)))
  const y2 = Math.min(h - 1, Math.round(Math.max(ay, by)) - 1)
  if (x2 < x1 || y2 < y1) return
  for (let y = y1; y <= y2; y++) out.push(y, x1, x2)
}

/**
 * 折れ線(n 点)を太さ width のストローク輪郭に変換して out へ書き込む。
 * 左側の点を前から、右側の点を後ろから詰めるので out には 2n 点の閉ポリゴンができる。
 * 戻り値は点数(= 2n)。ホットパスでの配列アロケーションを避けるための書き込み版。
 */
export function strokeOutlineInto(
  path: ArrayLike<number>,
  n: number,
  width: number,
  out: Float64Array,
): number {
  const half = Math.max(0.35, width / 2)
  const last = 2 * n - 1
  for (let i = 0; i < n; i++) {
    // 進行方向(端点は隣接点から、中間点は前後の平均)
    let dx: number
    let dy: number
    if (i === 0) {
      dx = path[2] - path[0]
      dy = path[3] - path[1]
    } else if (i === n - 1) {
      dx = path[i * 2] - path[(i - 1) * 2]
      dy = path[i * 2 + 1] - path[(i - 1) * 2 + 1]
    } else {
      dx = path[(i + 1) * 2] - path[(i - 1) * 2]
      dy = path[(i + 1) * 2 + 1] - path[(i - 1) * 2 + 1]
    }
    const len = Math.hypot(dx, dy) || 1
    const nx = (-dy / len) * half
    const ny = (dx / len) * half
    const x = path[i * 2]
    const y = path[i * 2 + 1]
    out[i * 2] = x + nx
    out[i * 2 + 1] = y + ny
    out[(last - i) * 2] = x - nx
    out[(last - i) * 2 + 1] = y - ny
  }
  return 2 * n
}

/** 折れ線を太さ width のストローク輪郭ポリゴンに変換する(描画・SVG 用の配列版)。 */
export function strokeOutline(path: number[], width: number): number[] {
  const n = path.length >> 1
  const buf = new Float64Array(4 * n)
  strokeOutlineInto(path, n, width, buf)
  return Array.from(buf)
}

/** 2 次ベジェを折れ線に離散化して out へ書き込む。戻り値は点数(= segments+1)。 */
export function quadBezierPathInto(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  segments: number,
  out: Float64Array,
): number {
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const u = 1 - t
    out[i * 2] = u * u * x0 + 2 * u * t * cx + t * t * x1
    out[i * 2 + 1] = u * u * y0 + 2 * u * t * cy + t * t * y1
  }
  return segments + 1
}

/** 2 次ベジェを折れ線に離散化(描画・SVG 用の配列版) */
export function quadBezierPath(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  segments = 16,
): number[] {
  const buf = new Float64Array((segments + 1) * 2)
  quadBezierPathInto(x0, y0, cx, cy, x1, y1, segments, buf)
  return Array.from(buf)
}
