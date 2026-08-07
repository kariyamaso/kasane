/// <reference lib="webworker" />
/**
 * 動画最適化ワーカー
 *
 * Layer 0(前処理)をここで行ってから、1フレームずつ VideoModel を進める。
 *   - カット検出: フレーム間RMSEの閾値。カットをまたいで輸送しない
 *   - 時間バイラテラル(3フレーム): 時間方向のノイズは churn の直接の原因。
 *     画素値の近い近傍フレームだけを混ぜるので、動きのある画素は自然に除外される
 */

import { fullSSE, rmse } from '../core/score'
import { VideoModel } from './model'
import { keyframeTracks } from './keyframes'
import type { FromVideoWorker, ToVideoWorker, VideoConfig } from './types'

let gen = 0
let cfg: VideoConfig | null = null
let model: VideoModel | null = null
let frames: Uint8ClampedArray[] = []
let cuts: boolean[] = []
let width = 0
let height = 0
let frameIdx = 0
let running = false
let elapsed = 0
let tick = 0
let loopId = 0

function post(m: FromVideoWorker) {
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(m)
}

/* ---------------- Layer 0: 前処理 ---------------- */

function detectCuts(fs: Uint8ClampedArray[], w: number, h: number, threshold: number): boolean[] {
  const out = new Array<boolean>(fs.length).fill(false)
  for (let i = 1; i < fs.length; i++) {
    out[i] = rmse(fullSSE(fs[i - 1], fs[i]), w * h) > threshold
  }
  return out
}

const BILATERAL_SIGMA = 10

/** 3フレームの時間バイラテラル。カット境界をまたぐ近傍は使わない。 */
function temporalBilateral(fs: Uint8ClampedArray[], cutList: boolean[]): Uint8ClampedArray[] {
  // 重み LUT: idx = 3ch二乗距離 >> 8
  const lut = new Float64Array(768)
  const s2 = 2 * BILATERAL_SIGMA * BILATERAL_SIGMA * 3
  for (let i = 0; i < lut.length; i++) lut[i] = Math.exp(-((i << 8) + 128) / s2)

  return fs.map((cur, t) => {
    const prev = t > 0 && !cutList[t] ? fs[t - 1] : null
    const next = t + 1 < fs.length && !cutList[t + 1] ? fs[t + 1] : null
    if (!prev && !next) return cur
    const out = new Uint8ClampedArray(cur.length)
    for (let i = 0; i < cur.length; i += 4) {
      const r = cur[i]
      const g = cur[i + 1]
      const b = cur[i + 2]
      let wr = r
      let wg = g
      let wb = b
      let wsum = 1
      for (const nb of [prev, next]) {
        if (!nb) continue
        const dr = nb[i] - r
        const dg = nb[i + 1] - g
        const db = nb[i + 2] - b
        const d2 = dr * dr + dg * dg + db * db
        const w = lut[Math.min(767, d2 >> 8)]
        wr += nb[i] * w
        wg += nb[i + 1] * w
        wb += nb[i + 2] * w
        wsum += w
      }
      out[i] = wr / wsum
      out[i + 1] = wg / wsum
      out[i + 2] = wb / wsum
      out[i + 3] = 255
    }
    return out
  })
}

/* ---------------- メッセージループ ---------------- */

self.onmessage = (ev: MessageEvent<ToVideoWorker>) => {
  const msg = ev.data
  try {
    switch (msg.type) {
      case 'init': {
        cfg = msg.config
        gen = msg.gen
        loopId++
        width = msg.width
        height = msg.height
        const raw = msg.frames.map((b) => new Uint8ClampedArray(b))
        // カット検出は生フレームで(平滑化でエッジが鈍る前に)
        cuts = detectCuts(raw, width, height, cfg.cutThreshold)
        frames = cfg.denoise ? temporalBilateral(raw, cuts) : raw
        model = new VideoModel(width, height, frames[0], cfg)
        frameIdx = 0
        running = false
        elapsed = 0
        post({ type: 'ready', gen, bg: model.bg, frames: frames.length })
        break
      }
      case 'run':
        if (model && !running && frameIdx < frames.length) {
          running = true
          tick = performance.now()
          loop(++loopId)
        }
        break
      case 'pause':
        if (running) {
          running = false
          elapsed += performance.now() - tick
          post({ type: 'paused', gen })
        }
        break
      case 'abort':
        running = false
        loopId++
        model = null
        frames = []
        break
    }
  } catch (e) {
    running = false
    post({ type: 'error', gen, message: e instanceof Error ? e.message : String(e) })
  }
}

function loop(id: number) {
  if (id !== loopId || !running || !model || !cfg) return
  try {
    // 1フレーム = 1チャンク。フレーム内は同期処理でよい(数十ms)
    const res = model.processFrame(frames[frameIdx], cuts[frameIdx])
    post({
      type: 'frame',
      gen,
      stats: res.stats,
      shapes: res.shapes,
      elapsedMs: elapsed + (performance.now() - tick),
    })
    frameIdx++
    if (frameIdx >= frames.length) return finish()
  } catch (e) {
    running = false
    post({ type: 'error', gen, message: e instanceof Error ? e.message : String(e) })
    return
  }
  setTimeout(() => loop(id), 0)
}

function finish() {
  if (!model || !cfg) return
  running = false
  elapsed += performance.now() - tick
  const finished = model.finish(frames.length)
  const tracks = keyframeTracks(finished, cfg.rdpEpsilon)
  let totalKeys = 0
  let totalSamples = 0
  for (const t of tracks) totalKeys += t.keys.length
  for (const t of finished) totalSamples += t.samples.length
  post({ type: 'done', gen, tracks, totalKeys, totalSamples, elapsedMs: elapsed })
}
