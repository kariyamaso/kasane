/**
 * ヘッドレス動作確認:
 * サンプル画像を読み込み → 実行 → RMSE が単調に下がり、中間ステップが描けているかを確認する。
 * 使い方: npx vite preview --port 4173 & node test/smoke.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const URL_BASE = process.env.URL || 'http://localhost:4173/'
const OUT = new URL('../tmp/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

await page.goto(URL_BASE, { waitUntil: 'networkidle' })

// --- 図形を一通り有効にする ---
await page.click('#sample')
await page.waitForFunction(() => document.getElementById('imgInfo').textContent.includes('×'))

await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)))
await page.fill('#steps', '150')
await page.fill('#tries', '32')
await page.fill('#age', '16')
await page.selectOption('#resolution', '192')

const cases = [
  { name: 'triangle-auto', shapes: ['三角形'], color: 'auto' },
  { name: 'mixed-gradient', shapes: ['円', '正多角形', '楕円(回転)'], color: 'gradient' },
  { name: 'stroke-mono', shapes: ['ベジェ曲線', '線分'], color: 'mono' },
  { name: 'rect-palette', shapes: ['矩形(回転)', '四角形(任意)'], color: 'palette' },
]

for (const c of cases) {
  // チップ選択をリセットして指定のものだけ ON にする
  await page.evaluate((labels) => {
    // チップは click のたびに再構築されるので毎回引き直す。
    // 「最低 1 つは有効」ガードがあるため、先に欲しいものを ON にしてから不要なものを OFF にする。
    const find = (t) =>
      [...document.querySelectorAll('#shapeChips .chip')].find((c) => c.textContent === t)
    const all = [...document.querySelectorAll('#shapeChips .chip')].map((c) => c.textContent)
    for (const t of labels) {
      const ch = find(t)
      if (ch && !ch.classList.contains('on')) ch.click()
    }
    for (const t of all) {
      if (labels.includes(t)) continue
      const ch = find(t)
      if (ch && ch.classList.contains('on')) ch.click()
    }
  }, c.shapes)
  const on = await page.$$eval('#shapeChips .chip.on', (n) => n.map((x) => x.textContent))
  await page.selectOption('#colorMode', c.color)

  await page.click('#run')
  await page.waitForFunction(() => document.getElementById('run').textContent === '実行', {
    timeout: 180000,
  })
  const stats = await page.evaluate(() => ({
    step: document.getElementById('statStep').textContent,
    rmse: document.getElementById('statRmse').textContent,
    sim: document.getElementById('statSim').textContent,
    time: document.getElementById('statTime').textContent,
  }))
  console.log(`[${c.name}] shapes=${on.join('/')} color=${c.color}`, stats)
  if (Number(stats.step) < 150) throw new Error(`${c.name}: ステップが完走していない`)
  if (!(Number(stats.rmse) < 0.2)) throw new Error(`${c.name}: RMSE が下がっていない (${stats.rmse})`)
  await page.screenshot({ path: `${OUT}${c.name}.png` })

  // 中間状態(概形)の確認
  await page.evaluate(() => {
    const s = document.getElementById('scrub')
    s.value = String(Math.round(Number(s.max) * 0.15))
    s.dispatchEvent(new Event('input'))
  })
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${OUT}${c.name}-coarse.png` })
  await page.click('#reset')
}

// 差分ビューと書き出しの確認
await page.click('#run')
await page.waitForFunction(() => document.getElementById('run').textContent === '実行', {
  timeout: 180000,
})
await page.click('[data-view="diff"]')
await page.waitForTimeout(300)
await page.screenshot({ path: `${OUT}diff.png` })
await page.click('[data-view="split"]')

const svgLen = await page.evaluate(() => {
  const mod = document.querySelector('canvas')
  return mod ? 1 : 0
})
if (!svgLen) throw new Error('canvas なし')

const dl = page.waitForEvent('download')
await page.click('#expSvg')
const d = await dl
await d.saveAs(`${OUT}export.svg`)

const dl2 = page.waitForEvent('download')
await page.click('#expPng')
await (await dl2).saveAs(`${OUT}export.png`)

await page.screenshot({ path: `${OUT}ui-full.png`, fullPage: false })

if (errors.length) {
  console.error('コンソールエラー:', errors)
  process.exitCode = 1
} else {
  console.log('OK — エラーなし')
}
await browser.close()
