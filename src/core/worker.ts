/// <reference lib="webworker" />
/**
 * 最適化ワーカー
 * UI をブロックせずに 1 ステップずつ図形を確定し、そのつどメインスレッドへ送る。
 */

import { Model } from './model'
import type { Config, FromWorker, ToWorker } from './types'

let model: Model | null = null
let cfg: Config | null = null
let running = false
let elapsed = 0
let tick = 0

function post(m: FromWorker) {
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(m)
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data
  try {
    switch (msg.type) {
      case 'init': {
        cfg = msg.config
        model = new Model(msg.width, msg.height, new Uint8ClampedArray(msg.pixels), msg.config)
        running = false
        elapsed = 0
        post({ type: 'ready', bg: model.bg, score: model.score })
        break
      }
      case 'run':
        if (model && !running) {
          running = true
          tick = performance.now()
          loop()
        }
        break
      case 'pause':
        if (running) {
          running = false
          elapsed += performance.now() - tick
          post({ type: 'paused' })
        }
        break
      case 'abort':
        running = false
        model = null
        break
    }
  } catch (e) {
    running = false
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

function loop() {
  if (!running || !model || !cfg) return
  const budget = performance.now() + 50 // 50ms 単位で処理を分割
  try {
    while (running && performance.now() < budget) {
      if (model.records.length >= cfg.steps) return finish()
      const rec = model.step()
      if (!rec) return finish()
      post({
        type: 'step',
        index: model.records.length - 1,
        record: rec,
        elapsedMs: elapsed + (performance.now() - tick),
      })
    }
  } catch (e) {
    running = false
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
    return
  }
  if (running) setTimeout(loop, 0)
}

function finish() {
  running = false
  elapsed += performance.now() - tick
  post({ type: 'done', total: model ? model.records.length : 0, elapsedMs: elapsed })
}
