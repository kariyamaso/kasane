/**
 * 軽量 i18n(日本語 / 英語)
 *
 * - 静的ラベル: HTML 側に data-i18n="key"(textContent)/ data-i18n-html="key"(innerHTML)
 *   を付けておき、applyStatic() が一括適用する
 * - 動的文言: t(key, vars) を使う。{x} が vars.x で置換される
 * - 言語の決定: URL の ?lang= > localStorage > ブラウザ言語
 *
 * 動的に書き換えられる要素(ファイル名表示など)は、書き換えるときに
 * data-i18n 属性を外すこと。外さないと言語切替時に初期文言へ戻ってしまう。
 */

export type Lang = 'ja' | 'en'

const STORE_KEY = 'kasane-lang'

const M = {
  /* ---- ページタイトル ---- */
  'title.image': {
    ja: 'Kasane 襲 — 幾何プリミティブを重ねて画像を構成する',
    en: 'Kasane 襲 — Layered geometric image approximation',
  },
  'title.video': {
    ja: 'Kasane 襲 — 動画:寿命と軌跡を持つ図形で映像を構成する',
    en: 'Kasane 襲 — Video: primitives with lifetimes and trajectories',
  },

  /* ---- ナビ ---- */
  'nav.video': { ja: '動画版 →', en: 'Video mode →' },
  'nav.image': { ja: '← 静止画版', en: '← Image mode' },

  /* ---- セクション見出し ---- */
  'img.sec.source': { ja: '1. 基準画像', en: '1. Target image' },
  'vid.sec.video': { ja: '1. 動画', en: '1. Video' },
  'sec.shapes': { ja: '2. 図形', en: '2. Shapes' },
  'sec.compose': { ja: '3. 構成', en: '3. Composition' },
  'sec.color': { ja: '4. 配色', en: '4. Color' },
  'vid.sec.temporal': { ja: '5. 時間的一貫性', en: '5. Temporal coherence' },
  'img.sec.search': { ja: '5. 探索パラメータ', en: '5. Search parameters' },
  'vid.sec.search': { ja: '6. 探索パラメータ', en: '6. Search parameters' },
  'img.sec.export': { ja: '6. 書き出し', en: '6. Export' },
  'vid.sec.export': { ja: '7. 書き出し', en: '7. Export' },

  /* ---- 入力(静止画) ---- */
  'img.drop': { ja: 'クリック / ドロップで画像を読み込む', en: 'Click or drop to load an image' },
  'img.sample': { ja: 'サンプル画像を使う', en: 'Use the sample image' },
  notLoaded: { ja: '未読み込み', en: 'Not loaded' },

  /* ---- 入力(動画) ---- */
  'vid.drop': { ja: 'クリック / ドロップで動画を読み込む', en: 'Click or drop to load a video' },
  'vid.fps': { ja: 'サンプリング', en: 'Sampling' },
  'vid.maxFrames': { ja: '最大フレーム', en: 'Max frames' },

  /* ---- 図形 ---- */
  'shape.triangle': { ja: '三角形', en: 'Triangle' },
  'shape.quad': { ja: '四角形(任意)', en: 'Quad (free)' },
  'shape.rect': { ja: '矩形(軸平行)', en: 'Rect (axis-aligned)' },
  'shape.rotrect': { ja: '矩形(回転)', en: 'Rect (rotated)' },
  'shape.ellipse': { ja: '楕円', en: 'Ellipse' },
  'shape.rotellipse': { ja: '楕円(回転)', en: 'Ellipse (rotated)' },
  'shape.circle': { ja: '円', en: 'Circle' },
  'shape.regular': { ja: '正多角形', en: 'Regular polygon' },
  'shape.line': { ja: '線分', en: 'Line' },
  'shape.bezier': { ja: 'ベジェ曲線', en: 'Bézier curve' },
  'shapes.sides': { ja: '正多角形の辺数', en: 'Sides of regular polygons' },
  'shapes.size': {
    ja: 'サイズ範囲(外接円半径 ／ 長辺比)',
    en: 'Size range (circumradius, % of long side)',
  },
  min: { ja: '最小', en: 'Min' },
  max: { ja: '最大', en: 'Max' },
  sizeHint: {
    ja: '外接円半径 {lo} 〜 {hi} px（計算解像度 {res}px 換算）。生成時の初期値と変異時の上下限の両方に効きます。',
    en: 'Circumradius {lo}–{hi} px (at {res}px compute resolution). Bounds both initial generation and mutation.',
  },

  /* ---- 構成 ---- */
  'steps.image': { ja: '図形数 N', en: 'Shape count N' },
  'steps.video': { ja: '図形数 M', en: 'Shape count M' },
  alpha: { ja: '不透明度 α', en: 'Opacity α' },
  optAlpha: { ja: 'α も最適化する', en: 'Optimize α too' },
  resolution: { ja: '計算解像度', en: 'Compute resolution' },
  'res.fast': { ja: '128 px(高速)', en: '128 px (fast)' },
  'res.std': { ja: '256 px(標準)', en: '256 px (default)' },
  'res.fine': { ja: '512 px(高精度・低速)', en: '512 px (fine, slow)' },
  'res.slow': { ja: '384 px(低速)', en: '384 px (slow)' },
  bg: { ja: '背景', en: 'Background' },
  'bg.avg.image': { ja: '元画像の平均色', en: 'Source average color' },
  'bg.avg.video': { ja: '先頭フレームの平均色', en: 'First-frame average' },
  'bg.white': { ja: '白', en: 'White' },
  'bg.black': { ja: '黒', en: 'Black' },
  'bg.custom': { ja: '指定色', en: 'Custom' },

  /* ---- 配色 ---- */
  'color.mode': { ja: 'モード', en: 'Mode' },
  'color.auto.image': { ja: '元画像から自動抽出', en: 'Auto from source image' },
  'color.auto.video': { ja: '元映像から自動抽出', en: 'Auto from source video' },
  'color.gradient': { ja: 'グラデーション', en: 'Gradient' },
  'color.palette': { ja: '固定パレット', en: 'Fixed palette' },
  'color.mono': { ja: 'モノクロ / 単色階調', en: 'Monochrome / tonal ramp' },
  'color.mapping': { ja: '写像', en: 'Mapping' },
  'map.nearest': { ja: '最近傍(色相を尊重)', en: 'Nearest (respect hue)' },
  'map.luma': { ja: '輝度マッピング', en: 'Luma mapping' },
  'color.stops': { ja: '色ストップ', en: 'Color stops' },
  'color.blend': { ja: '元色ブレンド', en: 'Blend with source' },
  'hint.auto': {
    ja: '各図形が覆う領域について、誤差が最小になる色を閉形式で解いて使います。最も忠実な復元。',
    en: 'Solves the error-minimizing color in closed form for each covered region. Most faithful.',
  },
  'hint.gradient': {
    ja: '最適色をグラデーション上の色へ射影します。ストップは何色でも追加できます。',
    en: 'Projects the optimal color onto a gradient ramp. Add as many stops as you like.',
  },
  'hint.palette': {
    ja: '指定した色だけを使います。ポスター / シルクスクリーン風。',
    en: 'Uses only the specified colors. Poster / silkscreen look.',
  },
  'hint.mono': {
    ja: '最初の 2 色を暗→明のランプとして使い、最適色の輝度で位置を決めます。',
    en: 'Uses the first two colors as a dark→light ramp, positioned by the optimal color’s luma.',
  },

  /* ---- 時間的一貫性(動画) ---- */
  'vid.lambda': { ja: '滑らかさ λ_v', en: 'Smoothness λ_v' },
  'vid.minLife': { ja: '最小寿命 L', en: 'Min lifetime L' },
  'vid.fade': { ja: '振り付け k', en: 'Choreography k' },
  'vid.birth': { ja: '誕生上限 B', en: 'Birth budget B' },
  'vid.tau': { ja: '退場閾値 τ', en: 'Death threshold τ' },
  'vid.refit': { ja: '再フィット率', en: 'Refit fraction' },
  'vid.cut': { ja: 'カット閾値', en: 'Cut threshold' },
  'vid.denoise': { ja: '時間バイラテラル前処理', en: 'Temporal bilateral prefilter' },
  'vid.rdp': { ja: 'RDP 許容 ε', en: 'RDP tolerance ε' },
  'vid.temporalHint': {
    ja: 'λ_v は輸送予測からの逸脱ペナルティ、L と k が明滅を抑えます。λ_v = 0, L = 1, k = 0 が「フレーム独立処理」に相当します。誕生の閾値は退場の4倍(ヒステリシス)。',
    en: 'λ_v penalizes deviation from the advected prediction; L and k suppress flicker. λ_v = 0, L = 1, k = 0 reduces to frame-independent processing. Birth threshold is 4× death (hysteresis).',
  },

  /* ---- 探索 ---- */
  tries: { ja: 'ランダム候補数', en: 'Random candidates' },
  age: { ja: '山登り停滞許容', en: 'Hill-climb patience' },
  'vid.refitAge': { ja: '再フィット停滞', en: 'Refit patience' },
  anneal: { ja: '焼きなましを併用', en: 'Enable annealing' },
  temp: { ja: '温度', en: 'Temperature' },
  annealIters: { ja: '焼きなまし反復', en: 'Annealing iterations' },
  seed: { ja: '乱数シード', en: 'Random seed' },
  seedShuffle: { ja: '実行ごとに新しいシード', en: 'New seed each run' },

  /* ---- 実行・書き出し ---- */
  run: { ja: '実行', en: 'Run' },
  pause: { ja: '一時停止', en: 'Pause' },
  resume: { ja: '再開', en: 'Resume' },
  reset: { ja: 'リセット', en: 'Reset' },
  outW: { ja: '出力幅', en: 'Output width' },
  'img.exportHint': {
    ja: '現在スライダーで表示中のステップを書き出します。',
    en: 'Exports the step currently shown on the slider.',
  },
  'vid.expAnim': { ja: 'アニメSVG', en: 'Animated SVG' },
  'vid.expPng': { ja: 'PNG(現フレーム)', en: 'PNG (current frame)' },
  'vid.expSvg': { ja: 'SVG(現フレーム)', en: 'SVG (current frame)' },
  'vid.exportHint': {
    ja: 'アニメSVG / JSON は RDP でキーフレーム化した軌跡を書き出します。',
    en: 'Animated SVG / JSON export the RDP-keyframed trajectories.',
  },

  /* ---- ステータス・表示 ---- */
  'stat.shapes': { ja: '図形', en: 'shapes' },
  'stat.sim': { ja: '一致度', en: 'match' },
  'stat.time': { ja: '経過', en: 'elapsed' },
  'stat.frames': { ja: 'フレーム', en: 'frames' },
  'stat.churn': { ja: '入替/フレーム', en: 'churn / frame' },
  'view.split': { ja: '並列', en: 'Split' },
  'view.result': { ja: '結果', en: 'Result' },
  'view.target.image': { ja: '元画像', en: 'Source' },
  'view.target.video': { ja: '元映像', en: 'Source' },
  'view.diff': { ja: '差分', en: 'Diff' },
  'cap.target.image': { ja: '基準画像', en: 'Target image' },
  'cap.target.video': { ja: '元映像(処理解像度)', en: 'Source (compute resolution)' },
  'cap.result': { ja: '近似結果', en: 'Approximation' },
  'cap.diff': { ja: '差分(明るいほど誤差が大きい)', en: 'Diff (brighter = larger error)' },

  /* ---- 動的文言 ---- */
  sampleName: { ja: 'サンプル画像', en: 'Sample image' },
  error: { ja: 'エラー: {msg}', en: 'Error: {msg}' },
  'vid.extractOnRun': { ja: '実行時にフレームを抽出します', en: 'Frames will be extracted on run' },
  'vid.extracting': { ja: '抽出中 {i}/{n}', en: 'Extracting {i}/{n}' },
  'vid.info': {
    ja: '{vw}×{vh} px, {dur}s → {n}フレーム @{fps}fps ({w}×{h})',
    en: '{vw}×{vh} px, {dur}s → {n} frames @{fps}fps ({w}×{h})',
  },
  'vid.doneHint': {
    ja: '軌跡 {tracks} 本 / 全{samples}サンプル → {keys}キーフレーム ({pct}%) に圧縮。',
    en: '{tracks} tracks / {samples} samples → compressed to {keys} keyframes ({pct}%).',
  },
  'vid.decodeFail': {
    ja: 'この動画はブラウザでデコードできません',
    en: 'This video cannot be decoded by the browser',
  },
  'vid.loadFail': { ja: '動画の読み込みに失敗しました', en: 'Failed to load the video' },

  /* ---- 脚注(HTML) ---- */
  'footnote.image': {
    ja: 'Î<sub>N</sub>(x,y) = Composite(P<sub>1</sub>,…,P<sub>N</sub>) ／ P<sub>i</sub> = (形状, 位置, 大きさ, 回転, 色, α) — 各ステップで最適色を閉形式で解き、山登り法と焼きなましで幾何パラメータを最適化しています。',
    en: 'Î<sub>N</sub>(x,y) = Composite(P<sub>1</sub>,…,P<sub>N</sub>) — P<sub>i</sub> = (shape, position, size, rotation, color, α). Each step solves the optimal color in closed form and refines geometry via hill climbing and annealing.',
  },
  'footnote.video': {
    ja: '𝒫 = {(θ<sub>i</sub>(·), c<sub>i</sub>(·), α<sub>i</sub>, b<sub>i</sub>, d<sub>i</sub>)} ／ R<sub>t</sub> = Composite<sub>i: b<sub>i</sub>≤t&lt;d<sub>i</sub></sub>(θ<sub>i</sub>(t), c<sub>i</sub>(t), α<sub>i</sub>) — 疎 Lucas–Kanade で図形を輸送し、warm start の山登りで再フィット、寄与の低い図形はヒステリシス付きで入れ替えます。',
    en: '𝒫 = {(θ<sub>i</sub>(·), c<sub>i</sub>(·), α<sub>i</sub>, b<sub>i</sub>, d<sub>i</sub>)} — R<sub>t</sub> = Composite<sub>i: b<sub>i</sub>≤t&lt;d<sub>i</sub></sub>(θ<sub>i</sub>(t), c<sub>i</sub>(t), α<sub>i</sub>). Shapes are advected with sparse Lucas–Kanade, refit by warm-started hill climbing, and swapped with hysteresis when their contribution drops.',
  },
} as const

export type MsgKey = keyof typeof M

let lang: Lang = resolveInitialLang()
const listeners: (() => void)[] = []

function resolveInitialLang(): Lang {
  const fromUrl = new URLSearchParams(location.search).get('lang')
  if (fromUrl === 'ja' || fromUrl === 'en') return fromUrl
  try {
    const stored = localStorage.getItem(STORE_KEY)
    if (stored === 'ja' || stored === 'en') return stored
  } catch {
    /* localStorage 不可の環境は無視 */
  }
  return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en'
}

export function getLang(): Lang {
  return lang
}

export function t(key: MsgKey, vars?: Record<string, string | number>): string {
  let s: string = M[key][lang]
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  return s
}

export function onLangChange(cb: () => void): void {
  listeners.push(cb)
}

let titleKey: MsgKey = 'title.image'

function applyStatic(): void {
  document.documentElement.lang = lang
  document.title = t(titleKey)
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n as MsgKey)
  })
  document.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml as MsgKey)
  })
  document.querySelectorAll<HTMLElement>('.langswitch button').forEach((b) => {
    b.classList.toggle('on', b.dataset.lang === lang)
  })
}

export function setLang(next: Lang): void {
  if (next === lang) return
  lang = next
  try {
    localStorage.setItem(STORE_KEY, next)
  } catch {
    /* ignore */
  }
  applyStatic()
  for (const cb of listeners) cb()
}

/** ページ読み込み時に1回呼ぶ。静的ラベルの適用と言語切替ボタンの配線を行う */
export function initI18n(title: MsgKey): void {
  titleKey = title
  document.querySelectorAll<HTMLElement>('.langswitch button').forEach((b) => {
    b.addEventListener('click', () => setLang(b.dataset.lang as Lang))
  })
  applyStatic()
}
