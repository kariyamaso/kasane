/**
 * 再実行まわりの動作確認:
 *   1. 完了後に図形数だけ増やして実行 → 再計算せず続きから追加される
 *   2. 一時停止中に図形数を減らして実行 → 新しい目標が反映される
 *   3. 一時停止中に他の設定(α)を変えて実行 → 旧設定の続行ではなく新規実行になる
 * 使い方: npx vite preview --port 4173 & CHROME_PATH=/path/to/chrome node test/rerun.mjs
 */
import { chromium } from 'playwright'

const URL_BASE = process.env.URL || 'http://localhost:4173/'

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

let fail = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fail++
}

await page.goto(URL_BASE, { waitUntil: 'networkidle' })
await page.click('#sample')
await page.waitForFunction(() => !document.getElementById('run').disabled)
await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)))

const waitDone = (n, timeout = 30000) =>
  page.waitForFunction(
    (target) =>
      document.getElementById('run').textContent === '実行' &&
      Number(document.getElementById('statStep').textContent) >= target,
    n,
    { timeout },
  )

/** scrub.max の最小値を監視して「巻き戻し(=新規実行)が起きたか」を観測する */
const watchScrub = () =>
  page.evaluate(() => {
    window.__minScrub = Number(document.getElementById('scrub').max)
    clearInterval(window.__scrubIv)
    window.__scrubIv = setInterval(() => {
      window.__minScrub = Math.min(
        window.__minScrub,
        Number(document.getElementById('scrub').max),
      )
    }, 5)
  })
const minScrub = () => page.evaluate(() => window.__minScrub)

// --- 1. 完了後に N を増やす → 続きから追加 ---
await page.fill('#steps', '50')
await page.click('#run')
await waitDone(50)
await page.fill('#steps', '120')
await watchScrub()
await page.click('#run')
await waitDone(120)
check(
  '完了後の増加: 120 まで到達',
  (await page.textContent('#statStep')) === '120' &&
    (await page.textContent('#statTotal')) === '120',
)
check('完了後の増加: 巻き戻さず続きから追加', (await minScrub()) >= 50, `min=${await minScrub()}`)

// --- 2. 一時停止中に N を減らす → 新しい目標で止まる ---
await page.fill('#steps', '400')
await page.click('#run')
await page.waitForFunction(() => {
  const n = Number(document.getElementById('statStep').textContent)
  return n >= 30 && n < 380
})
await page.click('#run') // 一時停止
await page.waitForFunction(() => document.getElementById('run').textContent === '再開')
const pausedAt = Number(await page.textContent('#statStep'))
await page.fill('#steps', String(Math.max(60, pausedAt + 20)))
await page.click('#run')
await waitDone(Math.max(60, pausedAt + 20))
const total2 = await page.textContent('#statTotal')
check(
  '一時停止中の変更が反映される',
  Number(total2) === Math.max(60, pausedAt + 20),
  `pausedAt=${pausedAt} total=${total2}`,
)

// --- 3. 一時停止中に α を変える → 新規実行になる ---
// 前のシナリオの続きにならないようリセットし、一時停止が間に合う規模にする
await page.click('#reset')
await page.fill('#steps', '3000')
await page.click('#run')
await page.waitForFunction(() => {
  const n = Number(document.getElementById('statStep').textContent)
  return n >= 30 && n < 2500
})
await page.click('#run') // 一時停止
await page.waitForFunction(() => document.getElementById('run').textContent === '再開')
await page.evaluate(() => {
  const a = document.getElementById('alpha')
  a.value = String(Number(a.value) === 96 ? 160 : 96)
  a.dispatchEvent(new Event('input'))
})
await page.fill('#steps', '80')
await watchScrub()
await page.click('#run')
await waitDone(80)
check('設定変更後は新規実行(巻き戻しが起きる)', (await minScrub()) === 0, `min=${await minScrub()}`)
check('新規実行が新しい目標で完了', (await page.textContent('#statTotal')) === '80')

await page.evaluate(() => clearInterval(window.__scrubIv))
check('ページエラーなし', errors.length === 0)
if (errors.length) for (const e of errors) console.log('  error:', e)

await browser.close()
console.log(fail === 0 ? 'rerun OK' : `${fail} FAILURES`)
process.exit(fail === 0 ? 0 : 1)
