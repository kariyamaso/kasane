import './style.css'
import {
  DEFAULT_CONFIG,
  SHAPE_LABELS,
  type Config,
  type FromWorker,
  type RGB,
  type ShapeKind,
  type ShapeRecord,
  type ToWorker,
} from './core/types'
import { hexToRgb } from './core/color'
import { recordsToSvg } from './core/svg'
import { drawRecord, renderUpTo } from './ui/render'

/* ------------------------------------------------------------------ */
/* DOM helpers                                                         */
/* ------------------------------------------------------------------ */

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T

const el = {
  file: $<HTMLInputElement>('file'),
  drop: $<HTMLLabelElement>('drop'),
  dropLabel: $('dropLabel'),
  sample: $<HTMLButtonElement>('sample'),
  imgInfo: $('imgInfo'),
  shapeChips: $('shapeChips'),
  sideChips: $('sideChips'),
  sizeMin: $<HTMLInputElement>('sizeMin'),
  sizeMax: $<HTMLInputElement>('sizeMax'),
  sizeMinOut: $<HTMLOutputElement>('sizeMinOut'),
  sizeMaxOut: $<HTMLOutputElement>('sizeMaxOut'),
  sizeBar: $('sizeBar'),
  sizeHint: $('sizeHint'),
  steps: $<HTMLInputElement>('steps'),
  alpha: $<HTMLInputElement>('alpha'),
  alphaOut: $<HTMLOutputElement>('alphaOut'),
  optAlpha: $<HTMLInputElement>('optAlpha'),
  resolution: $<HTMLSelectElement>('resolution'),
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
  colorHint: $('colorHint'),
  tries: $<HTMLInputElement>('tries'),
  age: $<HTMLInputElement>('age'),
  anneal: $<HTMLInputElement>('anneal'),
  temp: $<HTMLInputElement>('temp'),
  tempOut: $<HTMLOutputElement>('tempOut'),
  annealIters: $<HTMLInputElement>('annealIters'),
  seed: $<HTMLInputElement>('seed'),
  run: $<HTMLButtonElement>('run'),
  reset: $<HTMLButtonElement>('reset'),
  outW: $<HTMLInputElement>('outW'),
  expPng: $<HTMLButtonElement>('expPng'),
  expSvg: $<HTMLButtonElement>('expSvg'),
  expJson: $<HTMLButtonElement>('expJson'),
  statStep: $('statStep'),
  statTotal: $('statTotal'),
  statRmse: $('statRmse'),
  statSim: $('statSim'),
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

type View = 'split' | 'result' | 'target' | 'diff'

const state = {
  bitmap: null as ImageBitmap | null,
  compW: 0,
  compH: 0,
  targetPixels: null as Uint8ClampedArray | null,
  records: [] as ShapeRecord[],
  bg: { r: 255, g: 255, b: 255 } as RGB,
  running: false,
  follow: true,
  view: 'split' as View,
  playing: false,
  scale: 1,
  totalSteps: 0,
  elapsed: 0,
}

const enabledShapes = new Set<ShapeKind>(['triangle'])
const enabledSides = new Set<number>([5, 6])
let stops: string[] = [...DEFAULT_CONFIG.color.stops]

/**
 * Worker はページ読み込み時に 1 つ生成して使い回す。
 * クリック時に生成するとスクリプトの取得+コンパイル(遅い回線では 1 RTT 以上)が
 * 「実行→最初の図形」のラグとして毎回のしかかるため。
 * 実行の世代 gen が一致しないメッセージ(リセット・再実行前のもの)は無視する。
 */
let worker: Worker | null = null
let workerGen = 0

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./core/worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (ev: MessageEvent<FromWorker>) => onWorkerMessage(ev.data)
  }
  return worker
}

const outCtx = el.outCanvas.getContext('2d')!
const srcCtx = el.srcCanvas.getContext('2d')!
const scratch = document.createElement('canvas')
const scratchCtx = scratch.getContext('2d', { willReadFrequently: true })!

/* ------------------------------------------------------------------ */
/* controls                                                            */
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
  ;(Object.keys(SHAPE_LABELS) as ShapeKind[]).forEach((k) => {
    const b = document.createElement('button')
    b.className = 'chip' + (enabledShapes.has(k) ? ' on' : '')
    b.textContent = SHAPE_LABELS[k]
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

const COLOR_HINTS: Record<string, string> = {
  auto: '各図形が覆う領域について、誤差が最小になる色を閉形式で解いて使います。最も忠実な復元。',
  gradient: '最適色をグラデーション上の色へ射影します。ストップは何色でも追加できます。',
  palette: '指定した色だけを使います。ポスター / シルクスクリーン風。',
  mono: '最初の 2 色を暗→明のランプとして使い、最適色の輝度で位置を決めます。',
}

function syncColorUi() {
  const mode = el.colorMode.value
  el.stopsWrap.style.display = mode === 'auto' ? 'none' : ''
  el.mappingRow.style.display = mode === 'gradient' ? '' : 'none'
  el.presets.style.display = mode === 'palette' ? 'none' : ''
  el.colorHint.textContent = COLOR_HINTS[mode] ?? ''
  updateRamp()
}

function applyDefaults() {
  const c = DEFAULT_CONFIG
  el.steps.value = String(c.steps)
  el.alpha.value = String(c.alpha)
  el.optAlpha.checked = c.optimizeAlpha
  el.resolution.value = String(c.resolution)
  el.bg.value = c.bg
  el.bgColor.value = c.bgColor
  el.colorMode.value = c.color.mode
  el.colorMapping.value = c.color.mapping
  el.blend.value = String(Math.round(c.color.blend * 100))
  el.sizeMin.value = String(Math.round(c.sizeMin * 1000))
  el.sizeMax.value = String(Math.round(c.sizeMax * 1000))
  el.tries.value = String(c.randomTries)
  el.age.value = String(c.hillClimbAge)
  el.anneal.checked = c.anneal
  el.temp.value = String(Math.round(c.temperature * 100))
  el.annealIters.value = String(c.annealIters)
  el.seed.value = String(c.seed)
  el.outW.value = '1024'
  syncOutputs()
}

function syncOutputs() {
  el.alphaOut.value = el.alpha.value
  el.blendOut.value = `${el.blend.value}%`
  el.tempOut.value = (Number(el.temp.value) / 100).toFixed(2)
  syncSizeUi()
}

/** サイズスライダー(1 目盛 = 長辺の 0.1%)の整合と表示 */
function syncSizeUi(driver?: 'min' | 'max') {
  let lo = Number(el.sizeMin.value)
  let hi = Number(el.sizeMax.value)
  if (lo > hi) {
    if (driver === 'min') hi = lo
    else lo = hi
    el.sizeMin.value = String(lo)
    el.sizeMax.value = String(hi)
  }
  const fmt = (v: number) => `${(v / 10).toFixed(v < 100 ? 1 : 0)}%`
  el.sizeMinOut.value = fmt(lo)
  el.sizeMaxOut.value = fmt(hi)
  const max = Number(el.sizeMax.max)
  el.sizeBar.style.left = `${(lo / max) * 100}%`
  el.sizeBar.style.width = `${Math.max(1, ((hi - lo) / max) * 100)}%`

  const res = Number(el.resolution.value)
  const px = (v: number) => ((v / 1000) * res).toFixed(1)
  el.sizeHint.textContent =
    `外接円半径 ${px(lo)} 〜 ${px(hi)} px（計算解像度 ${res}px 換算）。` +
    `生成時の初期値と変異時の上下限の両方に効きます。`
}

function readConfig(): Config {
  return {
    steps: clampNum(el.steps, 1, 5000),
    alpha: Number(el.alpha.value),
    optimizeAlpha: el.optAlpha.checked,
    resolution: Number(el.resolution.value),
    shapes: [...enabledShapes],
    polygonSides: [...enabledSides],
    sizeMin: Number(el.sizeMin.value) / 1000,
    sizeMax: Number(el.sizeMax.value) / 1000,
    randomTries: clampNum(el.tries, 4, 1000),
    hillClimbAge: clampNum(el.age, 1, 500),
    anneal: el.anneal.checked,
    temperature: Number(el.temp.value) / 100,
    annealIters: clampNum(el.annealIters, 10, 2000),
    bg: el.bg.value as Config['bg'],
    bgColor: el.bgColor.value,
    color: {
      mode: el.colorMode.value as Config['color']['mode'],
      stops: [...stops],
      mapping: el.colorMapping.value as 'nearest' | 'luma',
      blend: Number(el.blend.value) / 100,
    },
    seed: clampNum(el.seed, 1, 1e9),
  }
}

function clampNum(input: HTMLInputElement, lo: number, hi: number): number {
  const v = Math.round(Number(input.value))
  const c = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo
  if (c !== v) input.value = String(c)
  return c
}

/* ------------------------------------------------------------------ */
/* image                                                               */
/* ------------------------------------------------------------------ */

async function loadFromBlob(blob: Blob, name: string) {
  const bmp = await createImageBitmap(blob)
  state.bitmap = bmp
  el.dropLabel.textContent = name
  el.imgInfo.textContent = `${bmp.width} × ${bmp.height} px`
  el.outW.value = String(Math.min(1600, Math.max(256, bmp.width)))
  drawTarget()
  computePixels(Number(el.resolution.value)) // 実行時のラグを避けるため先回りで縮小
  resetRun()
  el.run.disabled = false
  el.reset.disabled = false
}

function drawTarget() {
  const bmp = state.bitmap
  if (!bmp) return
  const maxDisp = 900
  const s = Math.min(1, maxDisp / Math.max(bmp.width, bmp.height))
  el.srcCanvas.width = Math.round(bmp.width * s)
  el.srcCanvas.height = Math.round(bmp.height * s)
  srcCtx.drawImage(bmp, 0, 0, el.srcCanvas.width, el.srcCanvas.height)
}

/**
 * 内部計算用に縮小した RGBA を取り出す。
 * 大きな写真では drawImage が重いので、画像読み込み時・解像度変更時に先回りして
 * 計算し、(bitmap, resolution) が変わらない限り実行ボタンの経路では再計算しない。
 */
let pixelsBitmap: ImageBitmap | null = null
let pixelsRes = 0

function computePixels(resolution: number) {
  const bmp = state.bitmap!
  if (state.targetPixels && pixelsBitmap === bmp && pixelsRes === resolution) return
  const s = resolution / Math.max(bmp.width, bmp.height)
  const w = Math.max(8, Math.round(bmp.width * s))
  const h = Math.max(8, Math.round(bmp.height * s))
  scratch.width = w
  scratch.height = h
  scratchCtx.clearRect(0, 0, w, h)
  scratchCtx.drawImage(bmp, 0, 0, w, h)
  const data = scratchCtx.getImageData(0, 0, w, h).data
  state.compW = w
  state.compH = h
  state.targetPixels = data
  pixelsBitmap = bmp
  pixelsRes = resolution
}

function makeSample(): Blob | Promise<Blob> {
  const c = document.createElement('canvas')
  c.width = 640
  c.height = 640
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 640, 640)
  grad.addColorStop(0, '#1b2a4a')
  grad.addColorStop(0.5, '#e0603f')
  grad.addColorStop(1, '#f6e7c1')
  g.fillStyle = grad
  g.fillRect(0, 0, 640, 640)
  g.fillStyle = '#fff3cf'
  g.beginPath()
  g.arc(430, 200, 96, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = 'rgba(20,26,44,0.92)'
  g.beginPath()
  g.moveTo(0, 640)
  g.lineTo(230, 300)
  g.lineTo(430, 640)
  g.closePath()
  g.fill()
  g.fillStyle = 'rgba(48,60,92,0.9)'
  g.beginPath()
  g.moveTo(260, 640)
  g.lineTo(470, 360)
  g.lineTo(640, 640)
  g.closePath()
  g.fill()
  return new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'))
}

/* ------------------------------------------------------------------ */
/* run                                                                 */
/* ------------------------------------------------------------------ */

function resetRun() {
  workerGen++ // 以後、前の実行のメッセージはすべて無視される
  worker?.postMessage({ type: 'abort' } satisfies ToWorker)
  state.records = []
  state.running = false
  state.follow = true
  state.playing = false
  state.elapsed = 0
  el.play.textContent = '▶'
  el.run.textContent = '実行'
  el.scrub.max = '0'
  el.scrub.value = '0'
  el.scrub.disabled = true
  el.play.disabled = true
  el.expPng.disabled = true
  el.expSvg.disabled = true
  el.expJson.disabled = true
  el.statStep.textContent = '0'
  el.statRmse.textContent = '—'
  el.statSim.textContent = '—'
  el.statTime.textContent = '—'
  if (state.bitmap) {
    prepareOutputCanvas()
    renderUpTo(outCtx, [], 0, state.bg, el.outCanvas.width, el.outCanvas.height, state.scale)
  }
}

function prepareOutputCanvas() {
  const bmp = state.bitmap!
  const maxDisp = 900
  const s = Math.min(1, maxDisp / Math.max(bmp.width, bmp.height))
  el.outCanvas.width = Math.round(bmp.width * s)
  el.outCanvas.height = Math.round(bmp.height * s)
  state.scale = el.outCanvas.width / (state.compW || Math.round(bmp.width * s))
}

function start() {
  if (!state.bitmap) return
  const cfg = readConfig()
  computePixels(cfg.resolution)
  state.totalSteps = cfg.steps
  state.bg =
    cfg.bg === 'white'
      ? { r: 255, g: 255, b: 255 }
      : cfg.bg === 'black'
        ? { r: 0, g: 0, b: 0 }
        : cfg.bg === 'custom'
          ? hexToRgb(cfg.bgColor)
          : state.bg
  prepareOutputCanvas()

  state.records = []
  state.follow = true
  el.statTotal.textContent = String(cfg.steps)
  el.scrub.max = '0'
  el.scrub.value = '0'

  const w = ensureWorker()
  workerGen++
  const copy = state.targetPixels!.slice()
  w.postMessage(
    {
      type: 'init',
      gen: workerGen,
      width: state.compW,
      height: state.compH,
      pixels: copy.buffer,
      config: cfg,
    } satisfies ToWorker,
    [copy.buffer],
  )
  w.postMessage({ type: 'run' } satisfies ToWorker)
  state.running = true
  el.run.textContent = '一時停止'
  el.reset.disabled = false
}

/** step は高頻度で届くので、DOM の統計表示はフレームごとにまとめて更新する */
let statsScheduled = false
function scheduleStats() {
  if (statsScheduled) return
  statsScheduled = true
  requestAnimationFrame(() => {
    statsScheduled = false
    const n = state.records.length
    if (n === 0) return
    el.scrub.max = String(n)
    el.scrub.disabled = false
    el.play.disabled = false
    el.expPng.disabled = false
    el.expSvg.disabled = false
    el.expJson.disabled = false
    if (state.follow) {
      const rec = state.records[n - 1]
      el.scrub.value = String(n)
      el.scrubLabel.textContent = String(n)
      el.statStep.textContent = String(n)
      el.statRmse.textContent = rec.score.toFixed(4)
      el.statSim.textContent = `${((1 - rec.score) * 100).toFixed(2)}%`
      el.statTime.textContent = fmtTime(state.elapsed)
      if (state.view === 'diff') renderView()
    }
  })
}

function onWorkerMessage(msg: FromWorker) {
  if (msg.gen !== workerGen) return // リセット・再実行前の実行から届いた遅延メッセージ
  switch (msg.type) {
    case 'ready':
      state.bg = msg.bg
      renderUpTo(outCtx, [], 0, state.bg, el.outCanvas.width, el.outCanvas.height, state.scale)
      el.statRmse.textContent = msg.score.toFixed(4)
      break
    case 'step': {
      state.records.push(msg.record)
      state.elapsed = msg.elapsedMs
      // キャンバスへは即時に追記(インクリメンタル描画)、DOM 統計は rAF でまとめる
      if (state.follow && state.view !== 'diff' && state.view !== 'target') {
        drawRecord(outCtx, msg.record, state.scale)
      }
      scheduleStats()
      break
    }
    case 'done':
      state.running = false
      el.run.textContent = '実行'
      el.statTime.textContent = fmtTime(msg.elapsedMs)
      renderView()
      break
    case 'paused':
      state.running = false
      el.run.textContent = '再開'
      break
    case 'error':
      state.running = false
      el.run.textContent = '実行'
      alert(`エラー: ${msg.message}`)
      break
  }
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

function renderView() {
  const n = Number(el.scrub.value)
  el.scrubLabel.textContent = String(n)
  el.statStep.textContent = String(n)
  const rec = state.records[n - 1]
  el.statRmse.textContent = rec ? rec.score.toFixed(4) : '—'
  el.statSim.textContent = rec ? `${((1 - rec.score) * 100).toFixed(2)}%` : '—'

  el.figTarget.classList.toggle('hidden', state.view === 'result' || state.view === 'diff')
  el.figResult.classList.toggle('hidden', state.view === 'target')
  el.canvases.classList.toggle('single', state.view !== 'split')
  el.outCaption.textContent = state.view === 'diff' ? '差分(明るいほど誤差が大きい)' : '近似結果'

  if (state.view === 'diff') {
    renderDiff(n)
  } else if (state.view !== 'target') {
    renderUpTo(
      outCtx,
      state.records,
      n,
      state.bg,
      el.outCanvas.width,
      el.outCanvas.height,
      state.scale,
    )
  }
}

function renderDiff(n: number) {
  if (!state.targetPixels) return
  const w = state.compW
  const h = state.compH
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  renderUpTo(ctx, state.records, n, state.bg, w, h, 1)
  const img = ctx.getImageData(0, 0, w, h)
  const t = state.targetPixels
  for (let i = 0; i < img.data.length; i += 4) {
    const d =
      (Math.abs(t[i] - img.data[i]) +
        Math.abs(t[i + 1] - img.data[i + 1]) +
        Math.abs(t[i + 2] - img.data[i + 2])) /
      3
    const v = Math.min(255, d * 3)
    img.data[i] = v
    img.data[i + 1] = v * 0.85
    img.data[i + 2] = v * 0.6
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  el.outCanvas.width = w * 2
  el.outCanvas.height = h * 2
  outCtx.imageSmoothingEnabled = false
  outCtx.drawImage(c, 0, 0, w * 2, h * 2)
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

function exportPng() {
  const n = Number(el.scrub.value)
  const outW = clampNum(el.outW, 64, 4096)
  const scale = outW / state.compW
  const c = document.createElement('canvas')
  c.width = outW
  c.height = Math.round(state.compH * scale)
  const ctx = c.getContext('2d')!
  renderUpTo(ctx, state.records, n, state.bg, c.width, c.height, scale)
  c.toBlob((b) => b && download(b, `primitive_${n}.png`), 'image/png')
}

function exportSvg() {
  const n = Number(el.scrub.value)
  const outW = clampNum(el.outW, 64, 4096)
  const svg = recordsToSvg(state.records, n, state.bg, state.compW, state.compH, outW)
  download(new Blob([svg], { type: 'image/svg+xml' }), `primitive_${n}.svg`)
}

function exportJson() {
  const n = Number(el.scrub.value)
  const payload = {
    generator: 'primitive-images',
    config: readConfig(),
    canvas: { width: state.compW, height: state.compH },
    background: state.bg,
    records: state.records.slice(0, n),
  }
  download(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    `primitive_${n}.json`,
  )
}

/* ------------------------------------------------------------------ */
/* wiring                                                              */
/* ------------------------------------------------------------------ */

el.file.onchange = () => {
  const f = el.file.files?.[0]
  if (f) void loadFromBlob(f, f.name)
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
  if (f) void loadFromBlob(f, f.name)
})

el.sample.onclick = async () => {
  const blob = await makeSample()
  void loadFromBlob(blob, 'サンプル画像')
}

el.run.onclick = () => {
  if (!state.bitmap) return
  if (state.running) {
    worker?.postMessage({ type: 'pause' } satisfies ToWorker)
  } else if (worker && state.records.length > 0 && state.records.length < state.totalSteps) {
    worker.postMessage({ type: 'run' } satisfies ToWorker)
    state.running = true
    state.follow = true
    el.run.textContent = '一時停止'
  } else {
    start()
  }
}

el.reset.onclick = () => resetRun()

el.scrub.oninput = () => {
  state.follow = Number(el.scrub.value) >= state.records.length
  renderView()
}

el.play.onclick = () => {
  if (state.playing) {
    state.playing = false
    el.play.textContent = '▶'
    return
  }
  state.playing = true
  state.follow = false
  el.play.textContent = '■'
  let n = Number(el.scrub.value)
  if (n >= state.records.length) n = 0
  const total = state.records.length
  const perFrame = Math.max(1, Math.round(total / 180))
  const tickFn = () => {
    if (!state.playing) return
    n = Math.min(total, n + perFrame)
    el.scrub.value = String(n)
    renderView()
    if (n >= total) {
      state.playing = false
      el.play.textContent = '▶'
      state.follow = true
      return
    }
    requestAnimationFrame(tickFn)
  }
  requestAnimationFrame(tickFn)
}

el.viewTabs.addEventListener('click', (e) => {
  const t = e.target as HTMLElement
  const v = t.dataset.view as View | undefined
  if (!v) return
  state.view = v
  for (const b of Array.from(el.viewTabs.children)) b.classList.toggle('on', b === t)
  if (v !== 'diff' && state.bitmap) prepareOutputCanvas()
  renderView()
})

el.colorMode.onchange = syncColorUi
el.addStop.onclick = (e) => {
  e.preventDefault()
  stops.push('#ffffff')
  buildStops()
}
for (const input of [el.alpha, el.blend, el.temp]) input.oninput = syncOutputs
el.sizeMin.oninput = () => syncSizeUi('min')
el.sizeMax.oninput = () => syncSizeUi('max')
el.resolution.addEventListener('change', () => {
  syncSizeUi()
  if (state.bitmap) computePixels(Number(el.resolution.value)) // 実行前に先回りで縮小
})
el.expPng.onclick = exportPng
el.expSvg.onclick = exportSvg
el.expJson.onclick = exportJson

applyDefaults()
buildChips()
buildStops()
buildPresets()
syncColorUi()
ensureWorker() // ページ読み込み時にワーカーを起動しておき、実行ボタンのラグをなくす
