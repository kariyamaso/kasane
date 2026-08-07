/**
 * サイズ範囲スライダーの検証:
 * 指定した [最小, 最大] の外接円半径の外に出る図形が生成されないことを、
 * JSON 書き出しを実際にパースして確認する。
 */
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'

const URL_BASE = process.env.URL || 'http://localhost:4173/'
const OUT = new URL('../tmp/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

/** 図形の外接円半径(重心からの最大距離 / 半径パラメータ) */
function boundingRadius(shape) {
  const p = shape.p
  const span = { triangle: 3, quad: 4, rect: 2, line: 2, bezier: 3 }[shape.k]
  if (span) {
    let cx = 0
    let cy = 0
    for (let i = 0; i < span; i++) {
      cx += p[i * 2]
      cy += p[i * 2 + 1]
    }
    cx /= span
    cy /= span
    let d = 0
    for (let i = 0; i < span; i++) d = Math.max(d, Math.hypot(p[i * 2] - cx, p[i * 2 + 1] - cy))
    return d
  }
  switch (shape.k) {
    case 'circle':
      return p[2]
    case 'ellipse':
    case 'rotellipse':
      return Math.max(p[2], p[3])
    case 'regular':
      return p[2]
    case 'rotrect':
      return Math.hypot(p[2] / 2, p[3] / 2)
    default:
      throw new Error(`未知の図形: ${shape.k}`)
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
// テストは日本語ラベルでUIを操作するので言語を固定する
await page.addInitScript(() => localStorage.setItem('kasane-lang', 'ja'))
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

await page.goto(URL_BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)))
await page.click('#sample')
await page.waitForFunction(() => document.getElementById('imgInfo').textContent.includes('×'))
await page.fill('#steps', '80')
await page.fill('#tries', '24')
await page.fill('#age', '12')
await page.selectOption('#resolution', '256')

const setRange = (lo, hi) =>
  page.evaluate(
    ([lo, hi]) => {
      const a = document.getElementById('sizeMin')
      const b = document.getElementById('sizeMax')
      b.value = String(hi)
      b.dispatchEvent(new Event('input'))
      a.value = String(lo)
      a.dispatchEvent(new Event('input'))
    },
    [lo, hi],
  )

const ALL = ['三角形', '四角形(任意)', '矩形(軸平行)', '矩形(回転)', '楕円', '楕円(回転)', '円', '正多角形', '線分', 'ベジェ曲線']
await page.evaluate((labels) => {
  const find = (t) =>
    [...document.querySelectorAll('#shapeChips .chip')].find((c) => c.textContent === t)
  for (const t of labels) {
    const ch = find(t)
    if (ch && !ch.classList.contains('on')) ch.click()
  }
}, ALL)

// [スライダー値(‰), ラベル]
const cases = [
  { lo: 10, hi: 30, name: 'tiny' }, // 1.0% 〜 3.0%
  { lo: 15, hi: 300, name: 'default' }, // 1.5% 〜 30%
  { lo: 350, hi: 600, name: 'huge' }, // 35% 〜 60%
]

const RES = 256
for (const c of cases) {
  await setRange(c.lo, c.hi)
  await page.click('#run')
  await page.waitForFunction(() => document.getElementById('run').textContent === '実行', {
    timeout: 180000,
  })
  await page.screenshot({ path: `${OUT}size-${c.name}.png` })

  const dl = page.waitForEvent('download')
  await page.click('#expJson')
  const path = `${OUT}size-${c.name}.json`
  await (await dl).saveAs(path)

  const data = JSON.parse(readFileSync(path, 'utf8'))
  const unit = Math.max(data.canvas.width, data.canvas.height)
  const minR = Math.max(0.5, (c.lo / 1000) * unit)
  const maxR = (c.hi / 1000) * unit
  const radii = data.records.map((r) => boundingRadius(r.shape))
  const lo = Math.min(...radii)
  const hi = Math.max(...radii)
  const eps = 0.75 // 8bit 座標丸め等の許容
  console.log(
    `[${c.name}] 指定 ${minR.toFixed(1)}〜${maxR.toFixed(1)}px / 実測 ${lo.toFixed(1)}〜${hi.toFixed(1)}px (n=${radii.length}, unit=${unit}px, rmse=${data.records.at(-1).score.toFixed(4)})`,
  )
  if (lo < minR - eps) throw new Error(`${c.name}: 下限違反 ${lo} < ${minR}`)
  if (hi > maxR + eps) throw new Error(`${c.name}: 上限違反 ${hi} > ${maxR}`)
  await page.click('#reset')
}
void RES

if (errors.length) {
  console.error('コンソールエラー:', errors)
  process.exitCode = 1
} else {
  console.log('OK — サイズ範囲は全ステップで守られている')
}
await browser.close()
