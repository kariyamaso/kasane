/**
 * Geometric Primitive-Based Image Approximation — 共通型定義
 *
 * 図形は「種別 + 数値パラメータ配列」というプレーンなデータとして表現する。
 * こうしておくと Worker <-> メインスレッド間で構造化複製がそのまま効き、
 * 中間状態(step)の保存・再生・SVG 書き出しがすべて同じデータから行える。
 */

export type ShapeKind =
  | 'triangle' // 三角形       p = [x1,y1, x2,y2, x3,y3]
  | 'quad' // 任意四角形    p = [x1,y1, x2,y2, x3,y3, x4,y4]
  | 'rect' // 軸平行矩形    p = [x1,y1, x2,y2]
  | 'rotrect' // 回転矩形      p = [cx,cy, w,h, angle]
  | 'ellipse' // 楕円(軸平行)  p = [cx,cy, rx,ry]
  | 'rotellipse' // 回転楕円      p = [cx,cy, rx,ry, angle]
  | 'circle' // 円            p = [cx,cy, r]
  | 'regular' // 正多角形      p = [cx,cy, r, angle, sides]
  | 'line' // 線分(太さ付) p = [x1,y1, x2,y2, width]
  | 'bezier' // 2次ベジェ     p = [x0,y0, cx,cy, x1,y1, width]

export interface Shape {
  k: ShapeKind
  p: number[]
}

export interface RGB {
  r: number
  g: number
  b: number
}

/** 1 ステップ = 1 図形。alpha は図形ごとに持つ(α最適化 ON のとき変化する)。 */
export interface ShapeRecord {
  shape: Shape
  color: RGB
  alpha: number
  /** この図形を置いた「後」の RMSE (0..1) */
  score: number
}

export type ColorMode = 'auto' | 'gradient' | 'palette' | 'mono'

export interface ColorConfig {
  mode: ColorMode
  /** gradient: 2色以上のストップ / palette: 使用する色 / mono: 2色(暗→明) */
  stops: string[]
  /**
   * gradient・mono でのランプ上への写像方法
   *  nearest = 最適色に最も近いランプ上の色を選ぶ(色相を尊重)
   *  luma    = 最適色の輝度でランプ上の位置を決める(トーンマッピング的)
   */
  mapping: 'nearest' | 'luma'
  /** 元画像の色をどれだけ残すか 0=完全にパレット / 1=完全に元色 */
  blend: number
}

export type BgMode = 'average' | 'white' | 'black' | 'custom'

export interface Config {
  /** 生成する図形の総数 */
  steps: number
  /** 図形の不透明度 (1..255) */
  alpha: number
  /** α も探索対象にするか */
  optimizeAlpha: boolean
  /** 内部計算解像度(長辺 px)。小さいほど速い */
  resolution: number
  /** 使用する図形種別 */
  shapes: ShapeKind[]
  /** 'regular' で使う辺の数の候補 */
  polygonSides: number[]
  /**
   * 図形サイズの下限・上限。画像の長辺に対する比率で、
   * 「外接円半径」として解釈される(生成時の初期値と、変異時のクランプの両方に効く)。
   */
  sizeMin: number
  sizeMax: number
  /** 1 ステップあたりのランダム初期候補数 */
  randomTries: number
  /** 山登りの停滞許容回数 */
  hillClimbAge: number
  /** 焼きなましを併用するか */
  anneal: boolean
  /** 焼きなましの初期温度(相対値) */
  temperature: number
  /** 焼きなましの反復回数 */
  annealIters: number
  bg: BgMode
  bgColor: string
  color: ColorConfig
  seed: number
}

export const DEFAULT_CONFIG: Config = {
  steps: 200,
  alpha: 128,
  optimizeAlpha: false,
  resolution: 256,
  shapes: ['triangle'],
  polygonSides: [5, 6],
  sizeMin: 0.015,
  sizeMax: 0.3,
  randomTries: 48,
  hillClimbAge: 24,
  anneal: false,
  temperature: 0.35,
  annealIters: 120,
  bg: 'average',
  bgColor: '#ffffff',
  color: {
    mode: 'auto',
    stops: ['#0b1026', '#2a4d9b', '#f2b705', '#fdf6e3'],
    mapping: 'nearest',
    blend: 0,
  },
  seed: 1,
}

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  triangle: '三角形',
  quad: '四角形(任意)',
  rect: '矩形(軸平行)',
  rotrect: '矩形(回転)',
  ellipse: '楕円',
  rotellipse: '楕円(回転)',
  circle: '円',
  regular: '正多角形',
  line: '線分',
  bezier: 'ベジェ曲線',
}

/* ---- Worker メッセージ ---- */

/**
 * Worker はページ読み込み時に 1 つだけ生成し、実行のたびに init で使い回す
 * (クリック時に new Worker するとスクリプト取得+コンパイルがラグになるため)。
 * gen は実行の世代番号。再実行・リセット後に届く前世代のメッセージを
 * メインスレッド側で無視するために全メッセージへ載せる。
 */
export type ToWorker =
  | { type: 'init'; gen: number; width: number; height: number; pixels: ArrayBuffer; config: Config }
  | { type: 'run' }
  | { type: 'pause' }
  | { type: 'abort' }
  /** 図形数だけを引き上げて続きから追加する(モデルは保持したまま) */
  | { type: 'steps'; steps: number }

export type FromWorker =
  | { type: 'ready'; gen: number; bg: RGB; score: number }
  | { type: 'step'; gen: number; index: number; record: ShapeRecord; elapsedMs: number }
  | { type: 'done'; gen: number; total: number; elapsedMs: number }
  | { type: 'paused'; gen: number }
  | { type: 'error'; gen: number; message: string }
