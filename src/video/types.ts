/**
 * 動画拡張 — 共通型定義
 *
 * 出力表現は「フレームごとの図形集合」ではなく「寿命と軌跡を持つ図形の集合」:
 *
 *   𝒫 = { (θ_i(·), c_i(·), α_i, b_i, d_i) }_{i=1..M}
 *   R_t(𝒫) = Composite_{i: b_i ≤ t < d_i} (θ_i(t), c_i(t), α_i)   z順 = 添字(不変)
 *
 * 目的関数:
 *   L(𝒫) = Σ_t ‖I_t − R_t‖² + λ_v Σ_i Σ_t ‖θ_i(t+1) − θ_i(t)‖²_Λ + λ_M M
 *   s.t. d_i − b_i ≥ L_min
 *
 * λ_v = 0, L_min = 1 が「フレーム独立処理」に退化した特殊解。
 */

import type { Config, RGB, ShapeKind, ShapeRecord } from '../core/types'

export interface VideoConfig extends Config {
  /** 動画からのサンプリングfps */
  fps: number
  /** 処理する最大フレーム数(メモリと時間の上限) */
  maxFrames: number
  /** λ_v: 軌跡の滑らかさの重み。輸送予測 θ̂ からの逸脱ペナルティに使う */
  lambdaV: number
  /** L_min: 最小寿命(フレーム)。これ未満の図形は退場させない */
  minLife: number
  /** k: 生死の振り付け。誕生/退場を k フレームかけて α をランプさせる */
  fade: number
  /** B: 1フレームあたりの誕生上限 */
  birthBudget: number
  /**
   * τ_death: 図形の寄与(被覆1画素あたりのSSE改善量、3ch合計)がこれ未満なら退場候補。
   * τ_birth = τ_death × birthFactor。τ_birth > τ_death のヒステリシスが
   * 閾値付近での生成⇄消滅の明滅を防ぐ。
   */
  tauDeath: number
  birthFactor: number
  /** 毎フレーム山登り再フィットする図形の割合(残差の大きい順)。残りは輸送のみ */
  refitFrac: number
  /** 再フィット時の山登り停滞許容(通常探索より小さくして局所に留める) */
  refitAge: number
  /** カット検出のフレーム間RMSE閾値(0..1) */
  cutThreshold: number
  /** 時間バイラテラルによる前処理(3フレーム、動きのある画素は混ぜない) */
  denoise: boolean
  /** Layer 4: パラメータ空間RDPの誤差許容(px)。キーフレーム化の粗さ */
  rdpEpsilon: number
}

export const DEFAULT_VIDEO_EXTRA = {
  fps: 12,
  maxFrames: 240,
  lambdaV: 8,
  minLife: 4,
  fade: 3,
  birthBudget: 3,
  tauDeath: 10,
  birthFactor: 4,
  refitFrac: 0.4,
  refitAge: 10,
  cutThreshold: 0.14,
  denoise: true,
  rdpEpsilon: 0.75,
} as const

/* ---- 軌跡とキーフレーム ---- */

/** 1トラック1フレーム分の状態(birth からの相対位置に格納) */
export interface TrackSample {
  p: number[]
  color: RGB
  /** 振り付け(fade)適用後の実効α */
  alpha: number
}

/** RDP後のキーフレーム。t は絶対フレーム番号 */
export interface Keyframe {
  t: number
  p: number[]
  color: RGB
  alpha: number
}

export interface KeyTrack {
  k: ShapeKind
  /** 寿命 [birth, death)。death は排他的 */
  birth: number
  death: number
  keys: Keyframe[]
}

/* ---- Worker メッセージ ---- */

export type ToVideoWorker =
  | {
      type: 'init'
      gen: number
      width: number
      height: number
      /** RGBA フレーム列(転送で渡す) */
      frames: ArrayBuffer[]
      config: VideoConfig
    }
  | { type: 'run' }
  | { type: 'pause' }
  | { type: 'abort' }

export interface FrameStats {
  frame: number
  rmse: number
  births: number
  deaths: number
  alive: number
  cut: boolean
}

export type FromVideoWorker =
  | { type: 'ready'; gen: number; bg: RGB; frames: number }
  | {
      type: 'frame'
      gen: number
      stats: FrameStats
      /** このフレームの合成列(z順)。メインスレッドはこれをそのまま描画する */
      shapes: ShapeRecord[]
      elapsedMs: number
    }
  | {
      type: 'done'
      gen: number
      tracks: KeyTrack[]
      totalKeys: number
      totalSamples: number
      elapsedMs: number
    }
  | { type: 'paused'; gen: number }
  | { type: 'error'; gen: number; message: string }
