/**
 * 動画版のヘッドレス動作確認:
 * ブラウザ内で MediaRecorder により合成動画(動く円)を生成して投入し、
 * 全フレームの処理完走・churn の低さ・アニメ SVG 書き出しを検証する。
 * 使い方: npx vite preview --port 4173 & CHROME_PATH=/path/to/chrome node test/video.mjs
 */
import { chromium } from 'playwright'

const URL_BASE = process.env.URL || 'http://localhost:4173/'

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
// テストは日本語ラベルでUIを操作するので言語を固定する
await page.addInitScript(() => localStorage.setItem('kasane-lang', 'ja'))
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

await page.goto(URL_BASE + 'video.html', { waitUntil: 'networkidle' })

// --- 合成動画を生成して file input へ投入 ---
await page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 320
  c.height = 180
  const g = c.getContext('2d')
  const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' })
  const chunks = []
  rec.ondataavailable = (e) => chunks.push(e.data)
  const stopped = new Promise((r) => (rec.onstop = r))
  rec.start()
  const t0 = performance.now()
  await new Promise((res) => {
    const draw = () => {
      const t = (performance.now() - t0) / 1000
      const grad = g.createLinearGradient(0, 0, 0, 180)
      grad.addColorStop(0, '#223')
      grad.addColorStop(1, '#68a')
      g.fillStyle = grad
      g.fillRect(0, 0, 320, 180)
      g.fillStyle = '#f2b705'
      g.beginPath()
      g.arc(40 + t * 90, 90 + Math.sin(t * 3) * 30, 30, 0, Math.PI * 2)
      g.fill()
      if (t > 2.2) {
        rec.stop()
        res()
      } else requestAnimationFrame(draw)
    }
    draw()
  })
  await stopped
  const file = new File([new Blob(chunks, { type: 'video/webm' })], 'test.webm', {
    type: 'video/webm',
  })
  const dt = new DataTransfer()
  dt.items.add(file)
  const input = document.getElementById('file')
  input.files = dt.files
  input.dispatchEvent(new Event('change'))
})
await page.waitForFunction(() => !document.getElementById('run').disabled)

await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)))
await page.selectOption('#fps', '8')
await page.fill('#maxFrames', '16')
await page.selectOption('#resolution', '128')
await page.fill('#steps', '60')

await page.click('#run')
await page.waitForFunction(() => !document.getElementById('expAnimSvg').disabled, null, {
  timeout: 180_000,
})

const stats = await page.evaluate(() => ({
  frame: document.getElementById('statFrame').textContent,
  total: document.getElementById('statTotal').textContent,
  rmse: Number(document.getElementById('statRmse').textContent),
  alive: Number(document.getElementById('statAlive').textContent),
  churn: Number(document.getElementById('statChurn').textContent),
  hint: document.getElementById('expHint').textContent,
}))
console.log('stats:', stats)

// アニメSVGのダウンロード内容
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#expAnimSvg')])
const { readFileSync } = await import('node:fs')
const svg = readFileSync(await dl.path(), 'utf8')

let fail = 0
const check = (name, ok) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) fail++
}
check('全フレーム処理完了', stats.frame === stats.total && Number(stats.total) > 0)
check('RMSE が妥当 (< 0.15)', stats.rmse > 0 && stats.rmse < 0.15)
check('churn が図形数に比べて小さい', stats.churn < stats.alive * 0.3)
check('キーフレーム化が走っている', /キーフレーム/.test(stats.hint))
check('アニメSVGに <animate> がある', svg.startsWith('<svg') && svg.includes('<animate'))
check('ページエラーなし', errors.length === 0)
if (errors.length) for (const e of errors) console.log('  error:', e)

await browser.close()
console.log(fail === 0 ? 'video smoke OK' : `${fail} FAILURES`)
process.exit(fail === 0 ? 0 : 1)
