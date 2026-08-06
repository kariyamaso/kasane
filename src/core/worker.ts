/// <reference lib="webworker" />
/**
 * 最適化ワーカー
 * UI をブロックせずに 1 ステップずつ図形を確定し、そのつどメインスレッドへ送る。
 * ワーカー自体は使い回され、init のたびに新しい実行(世代 gen)が始まる。
 */

import { Model } from './model'
import type { Config, FromWorker, ToWorker } from './types'

let model: Model | null = null
let cfg: Config | null = null
let gen = 0
let running = false
let elapsed = 0
let tick = 0
/** ループ連鎖の識別子。init/run で無効化し、古い setTimeout 連鎖の二重駆動を防ぐ */
let loopId = 0

function post(m: FromWorker) {
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(m)
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data
  try {
    switch (msg.type) {
      case 'init': {
        cfg = msg.config
        gen = msg.gen
        loopId++
        model = new Model(msg.width, msg.height, new Uint8ClampedArray(msg.pixels), msg.config)
        running = false
        elapsed = 0
        post({ type: 'ready', gen, bg: model.bg, score: model.score })
        break
      }
      case 'run':
        if (model && !running) {
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
        break
    }
  } catch (e) {
    running = false
    post({ type: 'error', gen, message: e instanceof Error ? e.message : String(e) })
  }
}

function loop(id: number) {
  if (id !== loopId || !running || !model || !cfg) return
  const budget = performance.now() + 50 // 50ms 単位で処理を分割
  try {
    while (running && performance.now() < budget) {
      if (model.records.length >= cfg.steps) return finish()
      const rec = model.step()
      if (!rec) return finish()
      post({
        type: 'step',
        gen,
        index: model.records.length - 1,
        record: rec,
        elapsedMs: elapsed + (performance.now() - tick),
      })
    }
  } catch (e) {
    running = false
    post({ type: 'error', gen, message: e instanceof Error ? e.message : String(e) })
    return
  }
  if (running) setTimeout(() => loop(id), 0)
}

function finish() {
  running = false
  elapsed += performance.now() - tick
  post({ type: 'done', gen, total: model ? model.records.length : 0, elapsedMs: elapsed })
}
