/**
 * Example ギャラリー(example-1..4.svg)の構成アニメを GIF に焼く。
 * SMIL の keyTimes から各図形の出現時刻を読み取り、Canvas でフレームを
 * 合成して gifenc でエンコードする(SVG 側の見た目と同一のタイムライン)。
 *
 * 使い方: CHROME_PATH=/path/to/chrome node scripts/example-gif.mjs
 * 出力:
 *   docs/assets/example-gallery.gif      1×4 横長(README・Slack 向け)
 *   docs/assets/example-gallery-2x2.gif  2×2 正方形(X などアスペクト比 3:1 制限のある SNS 向け)
 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const PORT = 5198
const ROOT = new URL('..', import.meta.url).pathname

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

for (const LAYOUT of [
  { file: 'example-gallery.gif', cols: 4, rows: 1, tile: 244 },
  { file: 'example-gallery-2x2.gif', cols: 2, rows: 2, tile: 300 },
]) {
const gifB64 = await page.evaluate(async ({ cols, rows, tile }) => {
  const { GIFEncoder, quantize, applyPalette } = await import(
    '/node_modules/gifenc/dist/gifenc.esm.js'
  )

  // SVG から図形列と出現時刻(keyTimes の3番目)をパースする
  const parseTile = async (url) => {
    const text = await (await fetch(url)).text()
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
    const svg = doc.documentElement
    const size = Number(svg.getAttribute('width')) // 600
    const bg = svg.querySelector('rect').getAttribute('fill')
    const items = []
    for (const el of svg.children) {
      const tag = el.tagName
      if (tag !== 'polygon' && tag !== 'circle' && tag !== 'ellipse') continue
      const anim = el.querySelector('animate')
      const ti = anim ? Number(anim.getAttribute('keyTimes').split(';')[2]) : 0
      const it = {
        tag,
        ti,
        fill: el.getAttribute('fill'),
        op: Number(el.getAttribute('fill-opacity')),
      }
      if (tag === 'polygon') {
        it.pts = el
          .getAttribute('points')
          .split(/[,\s]+/)
          .map(Number)
      } else {
        it.cx = Number(el.getAttribute('cx'))
        it.cy = Number(el.getAttribute('cy'))
        if (tag === 'circle') it.r = Number(el.getAttribute('r'))
        else {
          it.rx = Number(el.getAttribute('rx'))
          it.ry = Number(el.getAttribute('ry'))
        }
      }
      items.push(it)
    }
    return { size, bg, items }
  }

  const tiles = await Promise.all(
    [1, 2, 3, 4].map((i) => parseTile(`/docs/assets/example-${i}.svg`)),
  )

  const TILE = tile
  const GAP = 8
  const W = TILE * cols + GAP * (cols - 1)
  const H = TILE * rows + GAP * (rows - 1)
  const FRAMES = 48
  const DUR_MS = 16000
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d', { willReadFrequently: true })

  const gif = GIFEncoder()
  for (let f = 0; f < FRAMES; f++) {
    const p = f / (FRAMES - 1) // SMIL の keyTimes と同じ 0..1
    g.fillStyle = '#0d1117' // GitHub ダークの下地
    g.fillRect(0, 0, W, H)
    tiles.forEach((tileData, idx) => {
      const ox = (idx % cols) * (TILE + GAP)
      const oy = Math.floor(idx / cols) * (TILE + GAP)
      const sc = TILE / tileData.size
      g.save()
      g.translate(0, oy)
      g.beginPath()
      g.rect(ox, 0, TILE, TILE)
      g.clip()
      g.fillStyle = tileData.bg
      g.fillRect(ox, 0, TILE, TILE)
      for (const it of tileData.items) {
        if (it.ti > p) continue
        g.globalAlpha = it.op
        g.fillStyle = it.fill
        g.beginPath()
        if (it.tag === 'polygon') {
          g.moveTo(ox + it.pts[0] * sc, it.pts[1] * sc)
          for (let k = 2; k < it.pts.length; k += 2) {
            g.lineTo(ox + it.pts[k] * sc, it.pts[k + 1] * sc)
          }
          g.closePath()
        } else if (it.tag === 'circle') {
          g.arc(ox + it.cx * sc, it.cy * sc, it.r * sc, 0, Math.PI * 2)
        } else {
          g.ellipse(ox + it.cx * sc, it.cy * sc, it.rx * sc, it.ry * sc, 0, 0, Math.PI * 2)
        }
        g.fill()
      }
      g.globalAlpha = 1
      g.restore()
    })
    const { data } = g.getImageData(0, 0, W, H)
    const palette = quantize(data, 256)
    const index = applyPalette(data, palette)
    gif.writeFrame(index, W, H, { palette, delay: DUR_MS / FRAMES })
  }
  gif.finish()
  const bytes = gif.bytes()
  let bin = ''
  for (let i = 0; i < bytes.length; i += 32768) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 32768))
  }
  return btoa(bin)
}, LAYOUT)

writeFileSync(ROOT + 'docs/assets/' + LAYOUT.file, Buffer.from(gifB64, 'base64'))
console.log('docs/assets/' + LAYOUT.file + ' を書き出しました')
}

await browser.close()
server.kill()
