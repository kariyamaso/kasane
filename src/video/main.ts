import '../style.css'
import { DEFAULT_CONFIG, SHAPE_KINDS, type RGB, type ShapeKind, type ShapeRecord } from '../core/types'
import { recordsToSvg } from '../core/svg'
import { renderUpTo } from '../ui/render'
import { initI18n, onLangChange, t, type MsgKey } from '../ui/i18n'
import { tracksToAnimatedSvg } from './animsvg'
import {
  DEFAULT_VIDEO_EXTRA,
  type FrameStats,
  type FromVideoWorker,
  type KeyTrack,
  type ToVideoWorker,
  type VideoConfig,
} from './types'

/* ------------------------------------------------------------------ */
/* DOM                                                                 */
/* ------------------------------------------------------------------ */

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T

const el = {
  file: $<HTMLInputElement>('file'),
  drop: $<HTMLLabelElement>('drop'),
  dropLabel: $('dropLabel'),
  vidInfo: $('vidInfo'),
  fps: $<HTMLSelectElement>('fps'),
  maxFrames: $<HTMLInputElement>('maxFrames'),
  resolution: $<HTMLSelectElement>('resolution'),
  shapeChips: $('shapeChips'),
  sideChips: $('sideChips'),
  sizeMin: $<HTMLInputElement>('sizeMin'),
  sizeMax: $<HTMLInputElement>('sizeMax'),
  sizeMinOut: $<HTMLOutputElement>('sizeMinOut'),
  sizeMaxOut: $<HTMLOutputElement>('sizeMaxOut'),
  steps: $<HTMLInputElement>('steps'),
  alpha: $<HTMLInputElement>('alpha'),
  alphaOut: $<HTMLOutputElement>('alphaOut'),
  bg: $<HTMLSelectElement>('bg'),
  bgColor: $<HTMLInputElement>('bgColor'),
  colorMode: $<HTMLSelectElement>('colorMode'),
  colorMapping: $<HTMLSelectElement>('colorMapping'),
  mappingRow: $('mappingRow'),
  stopsWrap: $('stopsWrap'),
  stops: $('stops'),
  addStop: $<HTMLButtonElement>('addStop'),
  presets: $('presets'),
  blend: $<HTMLInputElement>('blend'),
  blendOut: $<HTMLOutputElement>('blendOut'),
  ramp: $('ramp'),
  lambdaV: $<HTMLInputElement>('lambdaV'),
  lambdaVOut: $<HTMLOutputElement>('lambdaVOut'),
  minLife: $<HTMLInputElement>('minLife'),
  fade: $<HTMLInputElement>('fade'),
  birthBudget: $<HTMLInputElement>('birthBudget'),
  tauDeath: $<HTMLInputElement>('tauDeath'),
  refitFrac: $<HTMLInputElement>('refitFrac'),
  refitFracOut: $<HTMLOutputElement>('refitFracOut'),
  cutThreshold: $<HTMLInputElement>('cutThreshold'),
  cutOut: $<HTMLOutputElement>('cutOut'),
  denoise: $<HTMLInputElement>('denoise'),
  rdpEps: $<HTMLInputElement>('rdpEps'),
  rdpEpsOut: $<HTMLOutputElement>('rdpEpsOut'),
  tries: $<HTMLInputElement>('tries'),
  age: $<HTMLInputElement>('age'),
  refitAge: $<HTMLInputElement>('refitAge'),
  seed: $<HTMLInputElement>('seed'),
  seedShuffle: $<HTMLInputElement>('seedShuffle'),
  run: $<HTMLButtonElement>('run'),
  reset: $<HTMLButtonElement>('reset'),
  outW: $<HTMLInputElement>('outW'),
  expAnimSvg: $<HTMLButtonElement>('expAnimSvg'),
  expJson: $<HTMLButtonElement>('expJson'),
  expPng: $<HTMLButtonElement>('expPng'),
  expSvg: $<HTMLButtonElement>('expSvg'),
  expHint: $('expHint'),
  statFrame: $('statFrame'),
  statTotal: $('statTotal'),
  statRmse: $('statRmse'),
  statAlive: $('statAlive'),
  statChurn: $('statChurn'),
  statTime: $('statTime'),
  viewTabs: $('viewTabs'),
  canvases: $('canvases'),
  figTarget: $('figTarget'),
  figResult: $('figResult'),
  outCaption: $('outCaption'),
  srcCanvas: $<HTMLCanvasElement>('srcCanvas'),
  outCanvas: $<HTMLCanvasElement>('outCanvas'),
  play: $<HTMLButtonElement>('play'),
  scrub: $<HTMLInputElement>('scrub'),
  scrubLabel: $('scrubLabel'),
}

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */

type View = 'split' | 'result' | 'target'

const state = {
  videoFile: null as File | null,
  frames: [] as Uint8ClampedArray[],
  frameImages: [] as (ImageData | null)[],
  extractKey: '',
  compW: 0,
  compH: 0,
  bg: { r: 255, g: 255, b: 255 } as RGB,
  results: [] as ShapeRecord[][],
  frameStats: [] as FrameStats[],
  tracks: null as KeyTrack[] | null,
  totalFrames: 0,
  fpsUsed: 12,
  running: false,
  extracting: false,
  follow: true,
  playing: false,
  view: 'split' as View,
  elapsed: 0,
  /* 言語切替時に動的文言を再構成するためのパラメータ */
  infoMsg: null as Record<string, string | number> | null,
  doneMsg: null as Record<string, string | number> | null,
}

const enabledShapes = new Set<ShapeKind>(['triangle'])
const enabledSides = new Set<number>([5, 6])
let stops: string[] = [...DEFAULT_CONFIG.color.stops]

let worker: Worker | null = null
let workerGen = 0
/** 実行中コンフィグの指紋。一時停止中に設定が変わったら再開ではなく新規実行にする */
let runCfgJson = ''

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (ev: MessageEvent<FromVideoWorker>) => onWorkerMessage(ev.data)
  }
  return worker
}

const srcCtx = el.srcCanvas.getContext('2d')!
const outCtx = el.outCanvas.getContext('2d')!
const scratch = document.createElement('canvas')
const scratchCtx = scratch.getContext('2d', { willReadFrequently: true })!

/** 結果は計算解像度の2倍で描く(ベクタなので滑らかになる) */
const OUT_SCALE = 2

/* ------------------------------------------------------------------ */
/* controls(静止画版と同じ操作系)                                       */
/* ------------------------------------------------------------------ */

const GRADIENT_PRESETS: Record<string, string[]> = {
  'Golden Hour': ['#12080a', '#7a1f3d', '#e2703a', '#ffd08a'],
  'Deep Sea': ['#050b1a', '#0f3b5c', '#2a9d8f', '#e9f5db'],
  Ukiyo: ['#1b1b2f', '#3d5a80', '#ee6c4d', '#f0ead2'],
  Risograph: ['#171717', '#ff3864', '#2de2e6', '#fdfd96'],
  'Mono Warm': ['#1a1410', '#f5efe6'],
  Cyanotype: ['#08172e', '#4a8fd4', '#e8f1fa'],
}

function buildChips() {
  el.shapeChips.innerHTML = ''
  SHAPE_KINDS.forEach((k: ShapeKind) => {
    const b = document.createElement('button')
    b.className = 'chip' + (enabledShapes.has(k) ? ' on' : '')
    b.textContent = t(`shape.${k}` as MsgKey)
    b.onclick = () => {
      if (enabledShapes.has(k)) enabledShapes.delete(k)
      else enabledShapes.add(k)
      if (enabledShapes.size === 0) enabledShapes.add(k)
      buildChips()
    }
    el.shapeChips.appendChild(b)
  })
  el.sideChips.innerHTML = ''
  for (const n of [3, 4, 5, 6, 7, 8, 10, 12]) {
    const b = document.createElement('button')
    b.className = 'chip' + (enabledSides.has(n) ? ' on' : '')
    b.textContent = `${n}`
    b.onclick = () => {
      if (enabledSides.has(n)) enabledSides.delete(n)
      else enabledSides.add(n)
      if (enabledSides.size === 0) enabledSides.add(n)
      buildChips()
    }
    el.sideChips.appendChild(b)
  }
}

function buildStops() {
  el.stops.innerHTML = ''
  stops.forEach((hex, i) => {
    const wrap = document.createElement('span')
    wrap.className = 'stop'
    const input = document.createElement('input')
    input.type = 'color'
    input.value = hex
    input.oninput = () => {
      stops[i] = input.value
      updateRamp()
    }
    const del = document.createElement('button')
    del.textContent = '×'
    del.onclick = (e) => {
      e.preventDefault()
      if (stops.length <= 2) return
      stops.splice(i, 1)
      buildStops()
    }
    wrap.append(input, del)
    el.stops.appendChild(wrap)
  })
  updateRamp()
}

function buildPresets() {
  el.presets.innerHTML = ''
  for (const [name, colors] of Object.entries(GRADIENT_PRESETS)) {
    const b = document.createElement('button')
    b.className = 'preset'
    b.title = name
    b.style.background = `linear-gradient(90deg, ${colors.join(',')})`
    b.onclick = () => {
      stops = [...colors]
      buildStops()
    }
    el.presets.appendChild(b)
  }
}

function updateRamp() {
  const mode = el.colorMode.value
  if (mode === 'palette') {
    const n = stops.length
    const segs = stops
      .map((c, i) => `${c} ${(i / n) * 100}%, ${c} ${((i + 1) / n) * 100}%`)
      .join(',')
    el.ramp.style.background = `linear-gradient(90deg, ${segs})`
  } else if (mode === 'auto') {
    el.ramp.style.background = 'linear-gradient(90deg, #444, #888, #ccc)'
  } else {
    const list = mode === 'mono' ? stops.slice(0, 2) : stops
    el.ramp.style.background = `linear-gradient(90deg, ${list.join(',')})`
  }
}

function syncColorUi() {
  const mode = el.colorMode.value
  el.stopsWrap.style.display = mode === 'auto' ? 'none' : ''
  el.mappingRow.style.display = mode === 'gradient' ? '' : 'none'
  el.presets.style.display = mode === 'palette' ? 'none' : ''
  updateRamp()
}

function syncOutputs() {
  el.alphaOut.value = el.alpha.value
  el.blendOut.value = `${el.blend.value}%`
  el.lambdaVOut.value = el.lambdaV.value
  el.refitFracOut.value = `${el.refitFrac.value}%`
  el.cutOut.value = (Number(el.cutThreshold.value) / 100).toFixed(2)
  el.rdpEpsOut.value = (Number(el.rdpEps.value) / 100).toFixed(2)
  let lo = Number(el.sizeMin.value)
  let hi = Number(el.sizeMax.value)
  if (lo > hi) {
    hi = lo
    el.sizeMax.value = String(hi)
  }
  const fmt = (v: number) => `${(v / 10).toFixed(v < 100 ? 1 : 0)}%`
  el.sizeMinOut.value = fmt(lo)
  el.sizeMaxOut.value = fmt(hi)
}

function setRunLabel(key: 'run' | 'pause' | 'resume') {
  el.run.dataset.k = key
  el.run.textContent = t(key)
}

function clampNum(input: HTMLInputElement, lo: number, hi: number): number {
  const v = Math.round(Number(input.value))
  const c = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo
  if (c !== v) input.value = String(c)
  return c
}

function readConfig(): VideoConfig {
  return {
    ...DEFAULT_CONFIG,
    steps: clampNum(el.steps, 8, 1000000),
    alpha: Number(el.alpha.value),
    optimizeAlpha: false,
    resolution: Number(el.resolution.value),
    shapes: [...enabledShapes],
    polygonSides: [...enabledSides],
    sizeMin: Number(el.sizeMin.value) / 1000,
    sizeMax: Number(el.sizeMax.value) / 1000,
    randomTries: clampNum(el.tries, 4, 1000),
    hillClimbAge: clampNum(el.age, 1, 500),
    anneal: false,
    bg: el.bg.value as VideoConfig['bg'],
    bgColor: el.bgColor.value,
    color: {
      mode: el.colorMode.value as VideoConfig['color']['mode'],
      stops: [...stops],
      mapping: el.colorMapping.value as 'nearest' | 'luma',
      blend: Number(el.blend.value) / 100,
    },
    seed: clampNum(el.seed, 1, 1e9),
    fps: Number(el.fps.value),
    maxFrames: clampNum(el.maxFrames, 8, 900),
    lambdaV: Number(el.lambdaV.value),
    minLife: clampNum(el.minLife, 1, 60),
    fade: clampNum(el.fade, 0, 20),
    birthBudget: clampNum(el.birthBudget, 0, 30),
    tauDeath: Math.max(0, Number(el.tauDeath.value)),
    birthFactor: DEFAULT_VIDEO_EXTRA.birthFactor,
    refitFrac: Number(el.refitFrac.value) / 100,
    refitAge: clampNum(el.refitAge, 1, 100),
    cutThreshold: Number(el.cutThreshold.value) / 100,
    denoise: el.denoise.checked,
    rdpEpsilon: Number(el.rdpEps.value) / 100,
  }
}

/* ------------------------------------------------------------------ */
/* フレーム抽出                                                          */
/* ------------------------------------------------------------------ */

function waitEvent(target: EventTarget, name: string, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      target.removeEventListener(name, on)
      target.removeEventListener('error', onErr)
      reject(new Error(`${name} timeout`))
    }, timeoutMs)
    const on = () => {
      clearTimeout(timer)
      target.removeEventListener('error', onErr)
      resolve()
    }
    const onErr = () => {
      clearTimeout(timer)
      target.removeEventListener(name, on)
      reject(new Error(t('vid.loadFail')))
    }
    target.addEventListener(name, on, { once: true })
    target.addEventListener('error', onErr, { once: true })
  })
}

/**
 * <video> のシークで固定 fps サンプリングする。
 * (ファイル, fps, 解像度, 最大フレーム) が同じなら再抽出しない。
 */
async function extractFrames(cfg: VideoConfig): Promise<void> {
  const file = state.videoFile!
  const key = `${file.name}:${file.size}:${cfg.fps}:${cfg.resolution}:${cfg.maxFrames}`
  if (state.extractKey === key && state.frames.length > 0) return

  state.extracting = true
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url
  try {
    await waitEvent(video, 'loadedmetadata', 8000)
    if (!Number.isFinite(video.duration)) {
      // MediaRecorder 製 webm などは duration が Infinity になる。
      // 末尾へシークすると確定するという標準的な回避策。
      video.currentTime = 1e9
      for (let i = 0; i < 40 && !Number.isFinite(video.duration); i++) {
        await new Promise((r) => setTimeout(r, 100))
      }
      video.currentTime = 0
    }
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh || !Number.isFinite(video.duration)) {
      throw new Error(t('vid.decodeFail'))
    }
    const s = cfg.resolution / Math.max(vw, vh)
    const w = Math.max(8, Math.round(vw * s))
    const h = Math.max(8, Math.round(vh * s))
    scratch.width = w
    scratch.height = h
    const count = Math.max(1, Math.min(cfg.maxFrames, Math.floor(video.duration * cfg.fps)))
    const frames: Uint8ClampedArray[] = []
    for (let i = 0; i < count; i++) {
      const seeked = waitEvent(video, 'seeked', 4000)
      video.currentTime = Math.min(video.duration - 0.001, i / cfg.fps + 0.0005)
      await seeked
      scratchCtx.drawImage(video, 0, 0, w, h)
      frames.push(scratchCtx.getImageData(0, 0, w, h).data)
      if (i % 5 === 0 || i === count - 1) {
        el.run.textContent = t('vid.extracting', { i: i + 1, n: count })
        await new Promise((r) => requestAnimationFrame(r))
      }
    }
    state.frames = frames
    state.frameImages = new Array(frames.length).fill(null)
    state.compW = w
    state.compH = h
    state.extractKey = key
    state.infoMsg = { vw, vh, dur: video.duration.toFixed(1), n: count, fps: cfg.fps, w, h }
    el.vidInfo.textContent = t('vid.info', state.infoMsg)
  } finally {
    state.extracting = false
    URL.revokeObjectURL(url)
  }
}

/* ------------------------------------------------------------------ */
/* run                                                                 */
/* ------------------------------------------------------------------ */

function resetRun() {
  workerGen++
  worker?.postMessage({ type: 'abort' } satisfies ToVideoWorker)
  state.results = []
  state.frameStats = []
  state.tracks = null
  state.running = false
  state.follow = true
  state.playing = false
  state.elapsed = 0
  el.play.textContent = '▶'
  setRunLabel('run')
  el.scrub.max = '0'
  el.scrub.value = '0'
  el.scrub.disabled = true
  el.play.disabled = true
  for (const b of [el.expAnimSvg, el.expJson, el.expPng, el.expSvg]) b.disabled = true
  el.statFrame.textContent = '0'
  el.statRmse.textContent = '—'
  el.statAlive.textContent = '—'
  el.statChurn.textContent = '—'
  el.statTime.textContent = '—'
}

async function start() {
  if (!state.videoFile || state.extracting) return
  if (el.seedShuffle.checked) el.seed.value = String(1 + Math.floor(Math.random() * 1e9))
  const cfg = readConfig()
  runCfgJson = JSON.stringify(cfg)
  el.run.disabled = true
  try {
    await extractFrames(cfg)
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e))
    el.run.disabled = false
    setRunLabel('run')
    return
  }
  el.run.disabled = false

  resetRun()
  state.totalFrames = state.frames.length
  state.fpsUsed = cfg.fps
  state.results = new Array(state.totalFrames)
  el.statTotal.textContent = String(state.totalFrames)
  prepareCanvases()

  const w = ensureWorker()
  workerGen++
  const buffers = state.frames.map((f) => f.slice().buffer)
  w.postMessage(
    {
      type: 'init',
      gen: workerGen,
      width: state.compW,
      height: state.compH,
      frames: buffers,
      config: cfg,
    } satisfies ToVideoWorker,
    buffers,
  )
  w.postMessage({ type: 'run' } satisfies ToVideoWorker)
  state.running = true
  setRunLabel('pause')
  el.reset.disabled = false
}

function prepareCanvases() {
  el.srcCanvas.width = state.compW
  el.srcCanvas.height = state.compH
  el.outCanvas.width = state.compW * OUT_SCALE
  el.outCanvas.height = state.compH * OUT_SCALE
}

function onWorkerMessage(msg: FromVideoWorker) {
  if (msg.gen !== workerGen) return
  switch (msg.type) {
    case 'ready':
      state.bg = msg.bg
      break
    case 'frame': {
      state.results[msg.stats.frame] = msg.shapes
      state.frameStats.push(msg.stats)
      state.elapsed = msg.elapsedMs
      el.scrub.max = String(msg.stats.frame)
      el.scrub.disabled = false
      el.play.disabled = false
      el.expPng.disabled = false
      el.expSvg.disabled = false
      if (state.follow) {
        el.scrub.value = String(msg.stats.frame)
        renderFrame(msg.stats.frame)
        updateStats(msg.stats)
      }
      break
    }
    case 'done': {
      state.running = false
      state.tracks = msg.tracks
      state.elapsed = msg.elapsedMs
      setRunLabel('run')
      el.statTime.textContent = fmtTime(msg.elapsedMs)
      el.expAnimSvg.disabled = false
      el.expJson.disabled = false
      state.doneMsg = {
        tracks: msg.tracks.length,
        samples: msg.totalSamples,
        keys: msg.totalKeys,
        pct: ((msg.totalKeys / Math.max(1, msg.totalSamples)) * 100).toFixed(1),
      }
      el.expHint.textContent = t('vid.doneHint', state.doneMsg)
      break
    }
    case 'paused':
      state.running = false
      setRunLabel('resume')
      break
    case 'error':
      state.running = false
      setRunLabel('run')
      alert(t('error', { msg: msg.message }))
      break
  }
}

function updateStats(stats: FrameStats) {
  el.statFrame.textContent = String(stats.frame + 1)
  el.statRmse.textContent = stats.rmse.toFixed(4)
  el.statAlive.textContent = String(stats.alive)
  // 入替 = カット以外のフレームでの (誕生+退場) の平均
  let churn = 0
  let n = 0
  for (const s of state.frameStats) {
    if (s.frame === 0 || s.cut) continue
    churn += s.births + s.deaths
    n++
  }
  el.statChurn.textContent = n > 0 ? (churn / n).toFixed(2) : '—'
  el.statTime.textContent = fmtTime(state.elapsed)
  el.scrubLabel.textContent = `${stats.frame + 1}`
}

function fmtTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`
}

/* ------------------------------------------------------------------ */
/* view                                                                */
/* ------------------------------------------------------------------ */

function frameImage(i: number): ImageData | null {
  if (!state.frames[i]) return null
  if (!state.frameImages[i]) {
    state.frameImages[i] = new ImageData(
      state.frames[i] as Uint8ClampedArray<ArrayBuffer>,
      state.compW,
      state.compH,
    )
  }
  return state.frameImages[i]
}

function renderFrame(i: number) {
  if (state.view !== 'result') {
    const img = frameImage(i)
    if (img) srcCtx.putImageData(img, 0, 0)
  }
  if (state.view !== 'target') {
    const shapes = state.results[i]
    if (shapes) {
      renderUpTo(
        outCtx,
        shapes,
        shapes.length,
        state.bg,
        el.outCanvas.width,
        el.outCanvas.height,
        OUT_SCALE,
      )
    }
  }
}

function renderView() {
  el.figTarget.classList.toggle('hidden', state.view === 'result')
  el.figResult.classList.toggle('hidden', state.view === 'target')
  el.canvases.classList.toggle('single', state.view !== 'split')
  const i = Number(el.scrub.value)
  renderFrame(i)
  const stats = state.frameStats[i]
  if (stats) updateStats(stats)
}

/* ------------------------------------------------------------------ */
/* export                                                              */
/* ------------------------------------------------------------------ */

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function exportAnimSvg() {
  if (!state.tracks) return
  const outW = clampNum(el.outW, 64, 4096)
  const svg = tracksToAnimatedSvg(
    state.tracks,
    state.totalFrames,
    state.fpsUsed,
    state.bg,
    state.compW,
    state.compH,
    outW,
  )
  download(new Blob([svg], { type: 'image/svg+xml' }), 'kasane_video.svg')
}

function exportJson() {
  if (!state.tracks) return
  const payload = {
    generator: 'kasane-video',
    fps: state.fpsUsed,
    frames: state.totalFrames,
    canvas: { width: state.compW, height: state.compH },
    background: state.bg,
    config: readConfig(),
    tracks: state.tracks,
  }
  download(
    new Blob([JSON.stringify(payload)], { type: 'application/json' }),
    'kasane_video.json',
  )
}

function exportFramePng() {
  const i = Number(el.scrub.value)
  const shapes = state.results[i]
  if (!shapes) return
  const outW = clampNum(el.outW, 64, 4096)
  const scale = outW / state.compW
  const c = document.createElement('canvas')
  c.width = outW
  c.height = Math.round(state.compH * scale)
  const ctx = c.getContext('2d')!
  renderUpTo(ctx, shapes, shapes.length, state.bg, c.width, c.height, scale)
  c.toBlob((b) => b && download(b, `kasane_f${i}.png`), 'image/png')
}

function exportFrameSvg() {
  const i = Number(el.scrub.value)
  const shapes = state.results[i]
  if (!shapes) return
  const outW = clampNum(el.outW, 64, 4096)
  const svg = recordsToSvg(shapes, shapes.length, state.bg, state.compW, state.compH, outW)
  download(new Blob([svg], { type: 'image/svg+xml' }), `kasane_f${i}.svg`)
}

/* ------------------------------------------------------------------ */
/* wiring                                                              */
/* ------------------------------------------------------------------ */

function loadFile(f: File) {
  state.videoFile = f
  state.extractKey = ''
  state.frames = []
  state.infoMsg = null
  // 以後は動的な内容なので、言語切替の一括適用対象から外す
  el.dropLabel.removeAttribute('data-i18n')
  el.vidInfo.removeAttribute('data-i18n')
  el.dropLabel.textContent = f.name
  el.vidInfo.textContent = t('vid.extractOnRun')
  el.run.disabled = false
  el.reset.disabled = false
  resetRun()
}

el.file.onchange = () => {
  const f = el.file.files?.[0]
  if (f) loadFile(f)
}
el.drop.addEventListener('dragover', (e) => {
  e.preventDefault()
  el.drop.classList.add('over')
})
el.drop.addEventListener('dragleave', () => el.drop.classList.remove('over'))
el.drop.addEventListener('drop', (e) => {
  e.preventDefault()
  el.drop.classList.remove('over')
  const f = e.dataTransfer?.files?.[0]
  if (f) loadFile(f)
})

el.run.onclick = () => {
  if (!state.videoFile) return
  if (state.running) {
    worker?.postMessage({ type: 'pause' } satisfies ToVideoWorker)
  } else if (
    worker &&
    state.frameStats.length > 0 &&
    state.frameStats.length < state.totalFrames &&
    !state.tracks &&
    JSON.stringify(readConfig()) === runCfgJson
  ) {
    worker.postMessage({ type: 'run' } satisfies ToVideoWorker)
    state.running = true
    state.follow = true
    setRunLabel('pause')
  } else {
    void start()
  }
}

el.reset.onclick = () => resetRun()

el.scrub.oninput = () => {
  state.follow = Number(el.scrub.value) >= state.frameStats.length - 1
  renderView()
}

el.play.onclick = () => {
  if (state.playing) {
    state.playing = false
    el.play.textContent = '▶'
    return
  }
  const avail = state.frameStats.length
  if (avail === 0) return
  state.playing = true
  state.follow = false
  el.play.textContent = '■'
  let i = Number(el.scrub.value)
  if (i >= avail - 1) i = 0
  let last = performance.now()
  const frameDur = 1000 / state.fpsUsed
  const tickFn = (now: number) => {
    if (!state.playing) return
    if (now - last >= frameDur) {
      i += Math.max(1, Math.floor((now - last) / frameDur))
      last = now
      if (i >= state.frameStats.length - 1) {
        i = state.frameStats.length - 1
        state.playing = false
        el.play.textContent = '▶'
      }
      el.scrub.value = String(i)
      renderView()
    }
    if (state.playing) requestAnimationFrame(tickFn)
  }
  requestAnimationFrame(tickFn)
}

el.viewTabs.addEventListener('click', (e) => {
  const t = e.target as HTMLElement
  const v = t.dataset.view as View | undefined
  if (!v) return
  state.view = v
  for (const b of Array.from(el.viewTabs.children)) b.classList.toggle('on', b === t)
  renderView()
})

el.colorMode.onchange = syncColorUi
el.addStop.onclick = (e) => {
  e.preventDefault()
  stops.push('#ffffff')
  buildStops()
}
for (const input of [
  el.alpha,
  el.blend,
  el.lambdaV,
  el.refitFrac,
  el.cutThreshold,
  el.rdpEps,
  el.sizeMin,
  el.sizeMax,
]) {
  input.oninput = syncOutputs
}
el.expAnimSvg.onclick = exportAnimSvg
el.expJson.onclick = exportJson
el.expPng.onclick = exportFramePng
el.expSvg.onclick = exportFrameSvg

initI18n('title.video')
syncOutputs()
buildChips()
buildStops()
buildPresets()
syncColorUi()
ensureWorker()

// 言語切替時: 動的に生成・状態依存で表示しているものを再描画する
onLangChange(() => {
  buildChips()
  syncColorUi()
  setRunLabel((el.run.dataset.k as 'run' | 'pause' | 'resume') ?? 'run')
  if (state.infoMsg) el.vidInfo.textContent = t('vid.info', state.infoMsg)
  else if (state.videoFile) el.vidInfo.textContent = t('vid.extractOnRun')
  if (state.doneMsg) el.expHint.textContent = t('vid.doneHint', state.doneMsg)
})
