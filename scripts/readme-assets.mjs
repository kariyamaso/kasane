/**
 * README 用の SVG アセットを「アプリ自身のパイプライン」で生成する。
 * 飾りのモックではなく、実際の Model / VideoModel の出力をそのまま使う。
 *
 *   docs/assets/title.svg     「KASANE 襲」の文字画像を三角形近似し、構成過程をループ再生
 *   docs/assets/hero.svg      横長シーンの三角形近似。構成過程を SMIL でループ再生
 *   docs/assets/palettes.svg  同一入力・同一探索で配色制約だけを差し替えた4連
 *   docs/assets/video-demo.svg 動画パイプラインのアニメSVG出力そのもの
 *
 * また public/favicon.png(アプリのタブアイコン)も docs/assets/logo.jpg から生成する。
 *
 * 使い方: CHROME_PATH=/path/to/chrome node scripts/readme-assets.mjs
 * (vite dev を内部で起動し、ページ内で /src のモジュールを直接 import する)
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const PORT = 5199
const ROOT = new URL('..', import.meta.url).pathname
const OUT = ROOT + 'docs/assets/'
mkdirSync(OUT, { recursive: true })

/* ---- vite dev を起動(ページ内から TS モジュールを import するため) ---- */
const server = spawn('npx', ['vite', 'dev', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
  stdio: 'ignore',
})
const base = `http://localhost:${PORT}`
for (let i = 0; ; i++) {
  try {
    await fetch(base)
    break
  } catch {
    if (i > 50) throw new Error('vite dev が起動しない')
    await new Promise((r) => setTimeout(r, 200))
  }
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.error('pageerror:', e))
await page.goto(base + '/index.html')

const f = (v) => (Math.round(v * 10) / 10).toString()
const f4 = (v) => (Math.round(v * 10000) / 10000).toString()

/**
 * 図形リスト {bg, items:[{fill,op,pts}]} を「構成過程がループ再生される SVG」にする。
 * 各図形の fill-opacity を keyTimes でずらして立ち上げ、build 割合まで積み上げたら
 * 完成形を保持して先頭へ戻る。
 */
function constructionSvg(data, outW, dur, build = 0.72) {
  const sc = outW / data.w
  const outH = Math.round(data.h * sc)
  const N = data.items.length
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 ${outW} ${outH}">`,
    `<rect width="100%" height="100%" fill="${data.bg}"/>`,
  ]
  data.items.forEach((it, i) => {
    const ti = 0.015 + build * (i / (N - 1))
    const t0 = Math.max(0.001, ti - 0.006)
    // dur = 0 は静止画(完成形のみ)
    const anim =
      dur > 0
        ? `<animate attributeName="fill-opacity" dur="${dur}s" repeatCount="indefinite" ` +
          `calcMode="linear" keyTimes="0;${f4(t0)};${f4(ti)};1" values="0;0;${f4(it.op)};${f4(it.op)}"/>`
        : ''
    const paint = `fill="${it.fill}" fill-opacity="${f4(it.op)}"`
    if (it.circle) {
      const [cx, cy, r] = it.circle
      parts.push(`<circle cx="${f(cx * sc)}" cy="${f(cy * sc)}" r="${f(r * sc)}" ${paint}>${anim}</circle>`)
    } else if (it.ellipse) {
      const [cx, cy, rx, ry] = it.ellipse
      parts.push(
        `<ellipse cx="${f(cx * sc)}" cy="${f(cy * sc)}" rx="${f(rx * sc)}" ry="${f(ry * sc)}" ${paint}>${anim}</ellipse>`,
      )
    } else {
      let d = ''
      for (let k = 0; k < it.pts.length; k += 2) d += `${f(it.pts[k] * sc)},${f(it.pts[k + 1] * sc)} `
      parts.push(`<polygon points="${d.trim()}" ${paint}>${anim}</polygon>`)
    }
  })
  parts.push('</svg>')
  return parts.join('\n')
}

/* ------------------------------------------------------------------ */
/* 1. ヒーローバナー: 横長シーン → 三角形近似 → 構成過程アニメ            */
/* ------------------------------------------------------------------ */

const hero = await page.evaluate(async () => {
  const { Model } = await import('/src/core/model.ts')
  const { DEFAULT_CONFIG } = await import('/src/core/types.ts')
  const { outlinePoints } = await import('/src/core/shapes.ts')
  const { rgbToHex } = await import('/src/core/color.ts')

  // 襲の色目を意識した横長シーン(空のグラデ・日輪・重なる山影)
  const c = document.createElement('canvas')
  c.width = 1200
  c.height = 360
  const g = c.getContext('2d')
  const sky = g.createLinearGradient(0, 0, 0, 360)
  sky.addColorStop(0, '#141a33')
  sky.addColorStop(0.45, '#31538c')
  sky.addColorStop(0.72, '#c65f4a')
  sky.addColorStop(0.9, '#e8a87c')
  g.fillStyle = sky
  g.fillRect(0, 0, 1200, 360)
  g.fillStyle = '#f2b705'
  g.beginPath()
  g.arc(880, 128, 62, 0, Math.PI * 2)
  g.fill()
  const ridge = (baseY, amp, freq, phase, color) => {
    g.fillStyle = color
    g.beginPath()
    g.moveTo(0, 360)
    for (let x = 0; x <= 1200; x += 8) {
      const y =
        baseY -
        amp * Math.abs(Math.sin((x / 1200) * Math.PI * freq + phase)) -
        amp * 0.35 * Math.sin((x / 1200) * Math.PI * freq * 2.7 + phase * 2)
      g.lineTo(x, y)
    }
    g.lineTo(1200, 360)
    g.closePath()
    g.fill()
  }
  ridge(320, 150, 2.2, 0.8, '#2c3a60')
  ridge(340, 120, 3.1, 2.1, '#1a2340')
  ridge(356, 80, 4.3, 4.2, '#0d1020')

  // 計算解像度へ縮小して近似
  const w = 400
  const h = 120
  const s = document.createElement('canvas')
  s.width = w
  s.height = h
  const sg = s.getContext('2d', { willReadFrequently: true })
  sg.drawImage(c, 0, 0, w, h)
  const pixels = sg.getImageData(0, 0, w, h).data

  const cfg = {
    ...DEFAULT_CONFIG,
    steps: 240,
    alpha: 150,
    shapes: ['triangle'],
    sizeMin: 0.02,
    sizeMax: 0.26,
    randomTries: 64,
    hillClimbAge: 24,
    seed: 5,
  }
  const model = new Model(w, h, pixels, cfg)
  while (model.records.length < cfg.steps) {
    if (!model.step()) break
  }
  return {
    w,
    h,
    bg: rgbToHex(model.bg),
    rmse: model.score,
    items: model.records.map((r) => ({
      fill: rgbToHex(r.color),
      op: r.alpha / 255,
      pts: outlinePoints(r.shape),
    })),
  }
})

writeFileSync(OUT + 'hero.svg', constructionSvg(hero, 1200, 10))
console.log(`hero.svg          ${hero.items.length}図形 rmse=${hero.rmse.toFixed(4)}`)

/* ------------------------------------------------------------------ */
/* 1b. タイトル: 「KASANE 襲」の文字自体をプリミティブ近似して構成する    */
/* ------------------------------------------------------------------ */

const title = await page.evaluate(async () => {
  const { Model } = await import('/src/core/model.ts')
  const { DEFAULT_CONFIG } = await import('/src/core/types.ts')
  const { outlinePoints } = await import('/src/core/shapes.ts')
  const { rgbToHex } = await import('/src/core/color.ts')

  const c = document.createElement('canvas')
  c.width = 1200
  c.height = 300
  const g = c.getContext('2d')
  g.fillStyle = '#0e1013' // アプリ背景色
  g.fillRect(0, 0, 1200, 300)
  const grad = g.createLinearGradient(140, 0, 1060, 0)
  grad.addColorStop(0, '#f2b705')
  grad.addColorStop(0.55, '#ffd97a')
  grad.addColorStop(1, '#4d8df6')
  g.fillStyle = grad
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = '900 168px "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif'
  g.fillText('KASANE', 505, 162)
  // 襲は画数が多いので大きめに描いて筆画を解像させる
  g.font = '900 224px "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif'
  g.fillText('襲', 1032, 155)

  const w = 720
  const h = 180
  const s = document.createElement('canvas')
  s.width = w
  s.height = h
  const sg = s.getContext('2d', { willReadFrequently: true })
  sg.drawImage(c, 0, 0, w, h)
  const pixels = sg.getImageData(0, 0, w, h).data

  // 文字を判読可能にするため、小さめの三角形を多めに積む
  const cfg = {
    ...DEFAULT_CONFIG,
    steps: 900,
    alpha: 200,
    shapes: ['triangle'],
    sizeMin: 0.0035,
    sizeMax: 0.05,
    randomTries: 72,
    hillClimbAge: 28,
    seed: 9,
    bg: 'custom',
    bgColor: '#0e1013',
  }
  const model = new Model(w, h, pixels, cfg)
  while (model.records.length < cfg.steps) {
    if (!model.step()) break
  }
  return {
    w,
    h,
    bg: rgbToHex(model.bg),
    rmse: model.score,
    items: model.records.map((r) => ({
      fill: rgbToHex(r.color),
      op: r.alpha / 255,
      pts: outlinePoints(r.shape),
    })),
  }
})

writeFileSync(OUT + 'title.svg', constructionSvg(title, 1200, 12, 0.76))
console.log(`title.svg         ${title.items.length}図形 rmse=${title.rmse.toFixed(4)}`)

/* ------------------------------------------------------------------ */
/* 1e. Example ギャラリー: 4作品を正方形タイルで構成していく様子          */
/* ------------------------------------------------------------------ */

// 2枚目(星月夜)はアプリのスクリーンショット設定に準拠:
// 三角形・矩形(回転)・楕円(回転)・正多角形(5/6)・ベジェ、サイズ1.5〜30%、
// α101、固定パレット4色。図形数のみ 40000 → 12000(SVG が GitHub の
// 画像プロキシ上限 ~5MB を超えて表示できなくなるため)。
const EXAMPLES = [
  {
    file: 'example-1.svg',
    src: '/docs/assets/example-src.avif',
    cfg: {
      steps: 4000,
      alpha: 128,
      shapes: ['triangle', 'ellipse', 'circle', 'bezier', 'regular'],
      polygonSides: [5, 6, 7],
      sizeMin: 0.008,
      sizeMax: 0.22,
      seed: 25,
    },
  },
  {
    file: 'example-2.svg',
    src: '/docs/assets/example-starry.jpg',
    cfg: {
      steps: 12000,
      alpha: 101,
      shapes: ['triangle', 'rotrect', 'rotellipse', 'regular', 'bezier'],
      polygonSides: [5, 6],
      sizeMin: 0.015,
      sizeMax: 0.3,
      seed: 31,
      color: { mode: 'palette', stops: ['#0b1026', '#c0392b', '#2648d1', '#fdf6e3'], mapping: 'nearest', blend: 0 },
    },
  },
  {
    file: 'example-3.svg',
    src: '/docs/assets/example-apple.jpg',
    cfg: {
      steps: 3500,
      alpha: 140,
      shapes: ['circle', 'ellipse', 'triangle'],
      sizeMin: 0.01,
      sizeMax: 0.25,
      seed: 32,
    },
  },
  {
    file: 'example-4.svg',
    src: '/docs/assets/example-lupins.jpg',
    cfg: {
      steps: 4500,
      alpha: 130,
      shapes: ['triangle', 'bezier', 'rotellipse'],
      sizeMin: 0.008,
      sizeMax: 0.2,
      seed: 33,
    },
  },
]

for (const spec of EXAMPLES) {
  const tile = await page.evaluate(async ({ src, cfg: over }) => {
    const { Model } = await import('/src/core/model.ts')
    const { DEFAULT_CONFIG } = await import('/src/core/types.ts')
    const { outlinePoints, rotEllipsePoints } = await import('/src/core/shapes.ts')
    const { rgbToHex } = await import('/src/core/color.ts')

    const blob = await (await fetch(src)).blob()
    const bmp = await createImageBitmap(blob)
    // 4枚を同じ高さで並べるため、中央の正方形を切り出す
    const sq = Math.min(bmp.width, bmp.height)
    const w = 400
    const s = document.createElement('canvas')
    s.width = w
    s.height = w
    const sg = s.getContext('2d', { willReadFrequently: true })
    sg.drawImage(bmp, (bmp.width - sq) / 2, (bmp.height - sq) / 2, sq, sq, 0, 0, w, w)
    const pixels = sg.getImageData(0, 0, w, w).data

    const cfg = { ...DEFAULT_CONFIG, randomTries: 44, hillClimbAge: 16, ...over }
    if (over.color) cfg.color = { ...DEFAULT_CONFIG.color, ...over.color }
    const model = new Model(w, w, pixels, cfg)
    while (model.records.length < cfg.steps) {
      if (!model.step()) break
    }
    const itemOf = (r) => {
      const k = r.shape.k
      const p = r.shape.p
      const base = { fill: rgbToHex(r.color), op: r.alpha / 255 }
      if (k === 'circle') return { ...base, circle: [p[0], p[1], p[2]] }
      if (k === 'ellipse') return { ...base, ellipse: [p[0], p[1], p[2], p[3]] }
      if (k === 'rotellipse') return { ...base, pts: rotEllipsePoints(p, 18) }
      return { ...base, pts: outlinePoints(r.shape) }
    }
    return { w, h: w, bg: rgbToHex(model.bg), rmse: model.score, items: model.records.map(itemOf) }
  }, spec)
  writeFileSync(OUT + spec.file, constructionSvg(tile, 600, 16, 0.85))
  console.log(`${spec.file}     ${tile.items.length}図形 rmse=${tile.rmse.toFixed(4)}`)
}

/* ------------------------------------------------------------------ */
/* 1c. デモボタン: ボタン画像もプリミティブ近似で作り、<a> で包んで使う   */
/* ------------------------------------------------------------------ */

// 静止画デモのボタンは静止SVG、動画デモのボタンだけ構成アニメ(dur>0)にする
const BUTTONS = [
  { file: 'btn-demo.svg', label: '▶ 静止画デモ', color: '#f2b705', seed: 21, dur: 0 },
  { file: 'btn-video.svg', label: '▶ 動画デモ', color: '#7fb3ff', seed: 22, dur: 8 },
]

for (const spec of BUTTONS) {
  const btn = await page.evaluate(async ({ label, color, seed }) => {
    const { Model } = await import('/src/core/model.ts')
    const { DEFAULT_CONFIG } = await import('/src/core/types.ts')
    const { outlinePoints } = await import('/src/core/shapes.ts')
    const { rgbToHex } = await import('/src/core/color.ts')

    const c = document.createElement('canvas')
    c.width = 840
    c.height = 180
    const g = c.getContext('2d')
    g.fillStyle = '#0e1013'
    g.fillRect(0, 0, 840, 180)
    // パネル風の角丸ボタン + アクセント色の枠と文字
    g.fillStyle = '#1d2127'
    g.beginPath()
    g.roundRect(14, 14, 812, 152, 26)
    g.fill()
    g.strokeStyle = color
    g.lineWidth = 7
    g.stroke()
    g.fillStyle = color
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = '800 76px "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif'
    g.fillText(label, 420, 94)

    const w = 700
    const h = 150
    const s = document.createElement('canvas')
    s.width = w
    s.height = h
    const sg = s.getContext('2d', { willReadFrequently: true })
    sg.drawImage(c, 0, 0, w, h)
    const pixels = sg.getImageData(0, 0, w, h).data

    const cfg = {
      ...DEFAULT_CONFIG,
      steps: 560,
      alpha: 210,
      shapes: ['triangle'],
      sizeMin: 0.0035,
      sizeMax: 0.045,
      randomTries: 72,
      hillClimbAge: 28,
      seed,
      bg: 'custom',
      bgColor: '#0e1013',
    }
    const model = new Model(w, h, pixels, cfg)
    while (model.records.length < cfg.steps) {
      if (!model.step()) break
    }
    return {
      w,
      h,
      bg: rgbToHex(model.bg),
      rmse: model.score,
      items: model.records.map((r) => ({
        fill: rgbToHex(r.color),
        op: r.alpha / 255,
        pts: outlinePoints(r.shape),
      })),
    }
  }, spec)
  // 動画デモ側だけ素早く組み上がるアニメ、静止画デモ側は完成形の静止SVG
  writeFileSync(OUT + spec.file, constructionSvg(btn, 840, spec.dur, 0.22))
  console.log(`${spec.file}      ${btn.items.length}図形 rmse=${btn.rmse.toFixed(4)}`)
}

/* ------------------------------------------------------------------ */
/* 2. 配色統制ストリップ: 同一入力・同一探索・配色制約だけ差し替え        */
/* ------------------------------------------------------------------ */

const palettes = await page.evaluate(async () => {
  const { Model } = await import('/src/core/model.ts')
  const { DEFAULT_CONFIG } = await import('/src/core/types.ts')
  const { recordsToSvg } = await import('/src/core/svg.ts')

  // 内蔵サンプルと同系の正方形シーン
  const c = document.createElement('canvas')
  c.width = 640
  c.height = 640
  const g = c.getContext('2d')
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

  const w = 256
  const s = document.createElement('canvas')
  s.width = w
  s.height = w
  const sg = s.getContext('2d', { willReadFrequently: true })
  sg.drawImage(c, 0, 0, w, w)
  const pixels = sg.getImageData(0, 0, w, w).data

  const colorModes = [
    { label: '自動抽出', color: { mode: 'auto', stops: [], mapping: 'nearest', blend: 0 } },
    {
      label: 'グラデーション',
      color: {
        mode: 'gradient',
        stops: ['#1b1b2f', '#3d5a80', '#ee6c4d', '#f0ead2'],
        mapping: 'nearest',
        blend: 0,
      },
    },
    {
      label: '固定パレット',
      color: {
        mode: 'palette',
        stops: ['#171717', '#ff3864', '#2de2e6', '#fdfd96'],
        mapping: 'nearest',
        blend: 0,
      },
    },
    {
      label: 'モノクロ',
      color: { mode: 'mono', stops: ['#1a1410', '#f5efe6'], mapping: 'luma', blend: 0 },
    },
  ]
  return colorModes.map(({ label, color }) => {
    const cfg = {
      ...DEFAULT_CONFIG,
      steps: 170,
      alpha: 150,
      shapes: ['triangle'],
      randomTries: 48,
      hillClimbAge: 20,
      seed: 11, // 同一シード = 同一入力・同一探索過程で配色だけが変わる
      color,
    }
    const model = new Model(w, w, pixels.slice(), cfg)
    while (model.records.length < cfg.steps) {
      if (!model.step()) break
    }
    const svg = recordsToSvg(model.records, cfg.steps, model.bg, w, w, 290)
    return { label, svg, rmse: model.score }
  })
})

{
  const tile = 290
  const gap = 13
  const outW = tile * 4 + gap * 3
  const outH = tile + 26
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 ${outW} ${outH}">`,
  ]
  palettes.forEach((p, i) => {
    const x = i * (tile + gap)
    // 内側の svg をそのままネスト(recordsToSvg の出力は自己完結)
    parts.push(`<svg x="${x}" y="0">${p.svg.replace(/^<svg[^>]*>/, (m) => m)}</svg>`)
    parts.push(
      `<text x="${x + tile / 2}" y="${tile + 18}" text-anchor="middle" ` +
        `font-family="system-ui, sans-serif" font-size="13" fill="#8d96a3">${p.label}</text>`,
    )
  })
  parts.push('</svg>')
  writeFileSync(OUT + 'palettes.svg', parts.join('\n'))
  console.log(`palettes.svg      ${palettes.map((p) => `${p.label}=${p.rmse.toFixed(3)}`).join(' ')}`)
}

/* ------------------------------------------------------------------ */
/* 3. 動画デモ: 動くシーン → 動画パイプライン → アニメSVG出力そのもの     */
/* ------------------------------------------------------------------ */

const videoSvg = await page.evaluate(async () => {
  const { VideoModel } = await import('/src/video/model.ts')
  const { keyframeTracks } = await import('/src/video/keyframes.ts')
  const { tracksToAnimatedSvg } = await import('/src/video/animsvg.ts')
  const { DEFAULT_CONFIG } = await import('/src/core/types.ts')
  const { DEFAULT_VIDEO_EXTRA } = await import('/src/video/types.ts')

  const w = 360
  const h = 108
  const F = 36
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d', { willReadFrequently: true })

  const makeFrame = (t) => {
    const u = t / (F - 1)
    const sky = g.createLinearGradient(0, 0, 0, h)
    sky.addColorStop(0, '#141a33')
    sky.addColorStop(0.55, '#31538c')
    sky.addColorStop(0.85, '#c65f4a')
    g.fillStyle = sky
    g.fillRect(0, 0, w, h)
    // 日輪が弧を描いて渡る
    const sx = 40 + u * (w - 80)
    const sy = 66 - Math.sin(u * Math.PI) * 38
    g.fillStyle = '#f2b705'
    g.beginPath()
    g.arc(sx, sy, 15, 0, Math.PI * 2)
    g.fill()
    const ridge = (baseY, amp, freq, phase, color) => {
      g.fillStyle = color
      g.beginPath()
      g.moveTo(0, h)
      for (let x = 0; x <= w; x += 4) {
        const y = baseY - amp * Math.abs(Math.sin((x / w) * Math.PI * freq + phase))
        g.lineTo(x, y)
      }
      g.lineTo(w, h)
      g.closePath()
      g.fill()
    }
    ridge(h * 0.92, 34, 2.6, 0.8, '#1a2340')
    ridge(h * 1.0, 22, 3.8, 3.4, '#0d1020')
    return g.getImageData(0, 0, w, h).data
  }

  const frames = []
  for (let t = 0; t < F; t++) frames.push(makeFrame(t))

  const cfg = {
    ...DEFAULT_CONFIG,
    ...DEFAULT_VIDEO_EXTRA,
    steps: 90,
    alpha: 160,
    shapes: ['triangle', 'circle'],
    sizeMin: 0.02,
    sizeMax: 0.3,
    randomTries: 48,
    hillClimbAge: 20,
    seed: 3,
  }
  const model = new VideoModel(w, h, frames[0], cfg)
  let churn = 0
  for (let t = 0; t < F; t++) {
    const res = model.processFrame(frames[t], false)
    if (t > 0) churn += res.stats.births + res.stats.deaths
  }
  const tracks = keyframeTracks(model.finish(F), cfg.rdpEpsilon)
  return {
    svg: tracksToAnimatedSvg(tracks, F, 12, model.bg, w, h, 1200),
    tracks: tracks.length,
    churn: churn / (F - 1),
  }
})

writeFileSync(OUT + 'video-demo.svg', videoSvg.svg)
console.log(`video-demo.svg    軌跡${videoSvg.tracks}本 churn=${videoSvg.churn.toFixed(2)}/frame`)

/* ------------------------------------------------------------------ */
/* 3a. セクション区切りバー: 襲の色目(重ねた色帯)を三角形で近似した帯     */
/* ------------------------------------------------------------------ */

const divider = await page.evaluate(async () => {
  const { Model } = await import('/src/core/model.ts')
  const { DEFAULT_CONFIG } = await import('/src/core/types.ts')
  const { outlinePoints } = await import('/src/core/shapes.ts')
  const { rgbToHex } = await import('/src/core/color.ts')

  const c = document.createElement('canvas')
  c.width = 1200
  c.height = 24
  const g = c.getContext('2d')
  const grad = g.createLinearGradient(0, 0, 1200, 0)
  grad.addColorStop(0, '#f2b705')
  grad.addColorStop(0.3, '#e2703a')
  grad.addColorStop(0.55, '#c2455f')
  grad.addColorStop(0.8, '#4d8df6')
  grad.addColorStop(1, '#2a9d8f')
  g.fillStyle = grad
  g.fillRect(0, 0, 1200, 24)

  const w = 480
  const h = 10
  const s = document.createElement('canvas')
  s.width = w
  s.height = h
  const sg = s.getContext('2d', { willReadFrequently: true })
  sg.drawImage(c, 0, 0, w, h)
  const pixels = sg.getImageData(0, 0, w, h).data

  // 細い帯に大きめの三角形を少なめに置き、切り絵のテクスチャを見せる
  const cfg = {
    ...DEFAULT_CONFIG,
    steps: 40,
    alpha: 150,
    shapes: ['triangle'],
    sizeMin: 0.02,
    sizeMax: 0.08,
    randomTries: 48,
    hillClimbAge: 18,
    seed: 13,
    bg: 'custom',
    bgColor: '#0e1013',
  }
  const model = new Model(w, h, pixels, cfg)
  while (model.records.length < cfg.steps) {
    if (!model.step()) break
  }
  return {
    w,
    h,
    bg: rgbToHex(model.bg),
    rmse: model.score,
    items: model.records.map((r) => ({
      fill: rgbToHex(r.color),
      op: r.alpha / 255,
      pts: outlinePoints(r.shape),
    })),
  }
})
writeFileSync(OUT + 'divider.svg', constructionSvg(divider, 1200, 0))
console.log(`divider.svg       ${divider.items.length}図形 rmse=${divider.rmse.toFixed(4)}`)

/* ------------------------------------------------------------------ */
/* 3b. OGP カード: リンクプレビュー用 1200×630 JPEG(og:image は SVG 不可) */
/* ------------------------------------------------------------------ */

const ogpB64 = await page.evaluate(async () => {
  const { Model } = await import('/src/core/model.ts')
  const { DEFAULT_CONFIG } = await import('/src/core/types.ts')
  const { renderUpTo } = await import('/src/ui/render.ts')

  // ワードマーク + 下段に山と日輪のシーン
  const c = document.createElement('canvas')
  c.width = 1200
  c.height = 630
  const g = c.getContext('2d')
  g.fillStyle = '#0e1013'
  g.fillRect(0, 0, 1200, 630)
  const sky = g.createLinearGradient(0, 300, 0, 630)
  sky.addColorStop(0, '#0e1013')
  sky.addColorStop(0.45, '#31538c')
  sky.addColorStop(0.8, '#c65f4a')
  sky.addColorStop(1, '#e8a87c')
  g.fillStyle = sky
  g.fillRect(0, 300, 1200, 330)
  g.fillStyle = '#f2b705'
  g.beginPath()
  g.arc(920, 430, 52, 0, Math.PI * 2)
  g.fill()
  const ridge = (baseY, amp, freq, phase, color) => {
    g.fillStyle = color
    g.beginPath()
    g.moveTo(0, 630)
    for (let x = 0; x <= 1200; x += 8) {
      const y = baseY - amp * Math.abs(Math.sin((x / 1200) * Math.PI * freq + phase))
      g.lineTo(x, y)
    }
    g.lineTo(1200, 630)
    g.closePath()
    g.fill()
  }
  ridge(600, 120, 2.4, 0.8, '#2c3a60')
  ridge(625, 90, 3.4, 2.6, '#1a2340')
  ridge(636, 55, 4.6, 4.4, '#0d1020')

  const grad = g.createLinearGradient(180, 0, 1020, 0)
  grad.addColorStop(0, '#f2b705')
  grad.addColorStop(0.55, '#ffd97a')
  grad.addColorStop(1, '#4d8df6')
  g.fillStyle = grad
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = '900 172px "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif'
  g.fillText('KASANE', 505, 170)
  g.font = '900 228px "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif'
  g.fillText('襲', 1030, 162)

  const w = 720
  const h = 378
  const s = document.createElement('canvas')
  s.width = w
  s.height = h
  const sg = s.getContext('2d', { willReadFrequently: true })
  sg.drawImage(c, 0, 0, w, h)
  const pixels = sg.getImageData(0, 0, w, h).data

  const cfg = {
    ...DEFAULT_CONFIG,
    steps: 1400,
    alpha: 200,
    shapes: ['triangle'],
    sizeMin: 0.0035,
    sizeMax: 0.09,
    randomTries: 72,
    hillClimbAge: 28,
    seed: 17,
    bg: 'custom',
    bgColor: '#0e1013',
  }
  const model = new Model(w, h, pixels, cfg)
  while (model.records.length < cfg.steps) {
    if (!model.step()) break
  }
  const out = document.createElement('canvas')
  out.width = 1200
  out.height = 630
  renderUpTo(out.getContext('2d'), model.records, model.records.length, model.bg, 1200, 630, 1200 / w)
  return out.toDataURL('image/jpeg', 0.88).split(',')[1]
})
writeFileSync(ROOT + 'public/ogp.jpg', Buffer.from(ogpB64, 'base64'))
console.log('ogp.jpg           1200×630 リンクプレビュー用カード')

/* ------------------------------------------------------------------ */
/* 4. favicon: ロゴ原本を 128px へ縮小(アプリのタブアイコン)             */
/* ------------------------------------------------------------------ */

const faviconB64 = await page.evaluate(async () => {
  const img = new Image()
  img.src = '/docs/assets/logo.jpg'
  await img.decode()
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  // 中央の正方形を切り出してから縮小(アスペクト比を保つ)
  const s = Math.min(img.width, img.height)
  c.getContext('2d').drawImage(
    img,
    (img.width - s) / 2,
    (img.height - s) / 2,
    s,
    s,
    0,
    0,
    128,
    128,
  )
  return c.toDataURL('image/png').split(',')[1]
})
writeFileSync(ROOT + 'public/favicon.png', Buffer.from(faviconB64, 'base64'))
console.log('favicon.png       docs/assets/logo.jpg → 128px')

/* ---- サイズと妥当性の確認 ---- */
const { statSync } = await import('node:fs')
for (const name of ['title.svg', 'hero.svg', 'palettes.svg', 'video-demo.svg']) {
  const kb = (statSync(OUT + name).size / 1024).toFixed(0)
  console.log(`  ${name}: ${kb} KB`)
}

await browser.close()
server.kill()
console.log('done → docs/assets/')
