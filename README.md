<p align="center">
  <img src="docs/assets/title.svg" width="760" alt="KASANE 襲 — タイトル文字が900枚の三角形で構成されていくアニメーション" />
</p>

<p align="center"><b>Layered Geometric Primitive-Based Image Approximation</b></p>

<p align="center"><b>日本語</b> ｜ <a href="./README.en.md">English</a></p>

<p align="center">
  <img src="docs/assets/hero.svg" width="100%" alt="240枚の半透明三角形が1枚ずつ重なって山と日輪の風景が立ち上がる(ループ)" />
</p>

[![CI](https://github.com/kariyamaso/kasane/actions/workflows/ci.yml/badge.svg)](https://github.com/kariyamaso/kasane/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

<p align="center">
  <a href="https://kariyamaso.github.io/kasane/?lang=ja"><img src="docs/assets/btn-demo.svg" width="280" alt="▶ 静止画デモを開く" /></a>&nbsp;
  <a href="https://kariyamaso.github.io/kasane/video.html?lang=ja"><img src="docs/assets/btn-video.svg" width="280" alt="▶ 動画デモを開く" /></a>
</p>

> A web app that progressively reconstructs a target image by layering
> semi-transparent geometric primitives (triangles, quads, circles, polygons,
> lines, Bézier curves). Uses stochastic hill climbing with optional simulated
> annealing, closed-form optimal color solving, and scanline-based incremental
> SSE evaluation — all running in a Web Worker. Exports PNG / SVG / JSON.
> Fully client-side, no server required.

**Kasane（襲／かさね）** は、半透明の衣を何枚も重ねて合成色を作る平安期の色彩技法
「[襲の色目](https://ja.wikipedia.org/wiki/%E8%A5%B2%E3%81%AE%E8%89%B2%E7%9B%AE)」に由来します。
半透明の幾何図形を重ね、パレットで色を統制しながら像を立ち上げるこのアプリの動作そのものです。

基準画像を、三角形・四角形・円・正多角形・線分・ベジェ曲線などの単純図形を
半透明で重ねることによって段階的に構成する Web アプリケーションです。

## アルゴリズム

各ステップで 1 図形を確定させる。

1. **ランダム候補生成** — 有効化された図形種別からランダムに `randomTries` 個の候補を生成
2. **最適色を閉形式で決定** — 図形が覆う画素集合について、合成後に元画像へ最も近づく塗り色は解析的に解ける

   ```
   合成: result = current·(1-α) + s·α
   result ≈ target とすると  s = current + (target - current)/α
   ```

   これを被覆画素で平均する。「色を探索する」必要がないので探索空間は幾何パラメータだけになる。

3. **配色制約の適用** — 求めた最適色を、ユーザー指定の色空間(グラデーション / 固定パレット / モノクロ階調)へ射影
4. **局所探索** — 最良候補を初期解として、焼きなまし(任意)→ 山登り法で幾何パラメータを改善
5. **確定・合成** — 誤差が最も減る図形を current バッファへ α 合成

### 高速化の要点

- 図形は**スキャンライン(行ごとの塗り区間 `[y, x1, x2]`)**に変換し、被覆画素だけを走査する
- 誤差は SSE(二乗誤差和)を状態として持ち回り、**被覆画素分だけ差し引き・足し直す**差分更新
  → 1 候補の評価が画像全体のサイズに依存しない
- 1 候補の評価は**被覆画素の 1 パスだけ**で完結する。`e = target - current·(1-α)` の
  統計量 Σe・Σe² を集めれば、最適色 `s* = Σe/(n·α)` も任意の色 s での合成後 SSE
  `Σe² - 2αs·Σe + nα²s²` も閉形式で出るため、「最適色のパス+誤差評価のパス」の
  2 回走査が 1 回になる(除算も画素ループから消える)
- 点列生成(回転楕円の多角形近似・ストローク輪郭など)はスクラッチバッファを
  使い回し、評価ループ内のアロケーションを避ける
- 評価は縮小画像(既定 256px)で行い、表示・書き出しは元解像度でベクタ的に再描画する
- 最適化は Web Worker で回すので UI は固まらない。Worker はページ読み込み時に
  事前生成して実行間で使い回し、画像の縮小結果もキャッシュするので、
  「実行」ボタンから最初の図形が現れるまでの体感ラグがない(遅い回線でも
  クリック経路にネットワーク取得が入らない)
- 8bit 丸めによる SSE の推定ドリフトは 32 ステップごとに全画素再計算でリセット

## 機能

- **基準画像**: ドラッグ&ドロップ / ファイル選択 / 内蔵サンプル
- **図形**: 三角形・任意四角形・矩形(軸平行/回転)・楕円(軸平行/回転)・円・正多角形(辺数選択可)・線分・2次ベジェ曲線。複数種を混在させられる
- **図形サイズ**: 最小・最大を長辺比(外接円半径)で指定するスライダー
- **配色**
  - `元画像から自動抽出` — 最適色をそのまま使う(最も忠実)
  - `グラデーション` — 任意個の色ストップで作ったランプへ射影。写像は「最近傍(色相を尊重)」と「輝度マッピング」を選択可
  - `固定パレット` — 指定色のみを使用(ポスター/シルクスクリーン風)
  - `モノクロ / 単色階調` — 2色ランプへ輝度で写像
  - `元色ブレンド` — 制約色と元色を任意比率で混ぜられる(0% = 完全にパレット / 100% = 元色)
- **中間状態**: タイムラインスライダーで任意ステップの状態を再描画、再生ボタンで構成過程をアニメーション
- **続きから追加**: 実行完了後(や一時停止中)に図形数 N だけを増やして実行すると、再計算せずに N+1 個目から追加する。他の設定を変えた場合は新規実行になる
- **表示**: 並列 / 結果のみ / 元画像 / 差分ヒートマップ
- **書き出し**: PNG(任意解像度) / SVG(ベクタ、無限に拡大可) / JSON(図形列そのもの)
- **再現性**: 乱数シード固定。同じ設定なら常に同じ結果

## 動画版

<p align="center">
  <img src="docs/assets/video-demo.svg" width="100%" alt="日輪が弧を描いて渡る合成シーンを図形の軌跡で再構成したアニメーションSVG" />
</p>
<p align="center"><sub>
動画パイプラインの実出力(36フレーム・図形90個)。図形が明滅せず<b>軌跡として動く</b>のがフレーム独立処理との違い
</sub></p>

`video.html` は静止画のパイプラインを時間方向へ拡張したもの。出力表現は
「フレームごとの図形集合」ではなく**寿命と軌跡を持つ図形の集合**で、
z 順(添字)は不変とする。

```
𝒫 = { (θ_i(·), c_i(·), α_i, b_i, d_i) }_{i=1..M}     [b_i, d_i) = 寿命
R_t(𝒫) = Composite_{i: b_i ≤ t < d_i} (θ_i(t), c_i(t), α_i)

L(𝒫) = Σ_t ‖I_t − R_t‖²                    … 忠実度
     + λ_v Σ_i Σ_t ‖θ_i(t+1) − θ_i(t)‖²_Λ  … 軌跡の滑らかさ
     + λ_M M                                … 簡潔さ
     s.t. d_i − b_i ≥ L_min
```

フレーム独立に貪欲法を回すと明滅する。原因は貪欲追加法が argmax の離散選択で
**入力に対して不連続**なことなので、前フレームの解の近傍に解を拘束する
warm start 型の逐次ソルバにしている(λ_v = 0, L_min = 1, k = 0 がフレーム独立処理に相当)。

| 層                     | 処理                                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layer 0 前処理         | 3フレーム時間バイラテラル(動きのある画素は混ぜない)+ フレーム間 RMSE によるカット検出。カットをまたいで輸送しない                                                                                                                     |
| Layer 1 輸送           | 各図形の支持領域から最大28点をサンプルし、疎なピラミッド型 Lucas–Kanade → 2×3 アフィンを最小二乗フィット → 図形の自由度へ射影(円なら平行移動+半径、角度持ちは回転も)。密フロー不要で O(M×数十点)                                      |
| Layer 2 再フィット     | z順の下から上への1掃引で合成しつつ、支持領域残差の大きい上位(既定40%)だけ warm start の山登り。スコアには λ\_v·n·‖θ−θ̂‖²\_Λ を直接足す(Λ は角度を弧長換算して px に揃える対角重み)。最適色は毎フレーム閉形式で解き直し、色の慣性で混ぜる |
| Layer 3 生死           | 寄与(被覆1画素あたりのSSE改善)が τ_death 未満 × 2フレーム連続で退場、残差への貪欲追加は 1フレーム B 個まで。**τ_birth = 4·τ_death のヒステリシス**が閾値付近の明滅を防ぐ。生死は瞬時にせず k フレームかけて α をランプ(振り付け)      |
| Layer 4 キーフレーム化 | 全フレーム処理後、各 θ_i(t) にパラメータ空間の Ramer–Douglas–Peucker(許容 ε、角度は unwrap + 弧長換算)を走らせ、毎フレーム値を疎なキーフレーム列へ圧縮                                                                                |

## 使い方

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ に静的ファイルを出力(そのままどこにでも置ける)
npm run preview
```

### 動作確認(ヘッドレス)

```bash
npm run build
npx vite preview --port 4173 &
CHROME_PATH=/path/to/chrome node test/smoke.mjs   # tmp/ にスクリーンショットが出る
CHROME_PATH=/path/to/chrome node test/size.mjs
CHROME_PATH=/path/to/chrome node test/video.mjs   # 動画版(合成webmを生成して完走・churn・アニメSVGを検証)
CHROME_PATH=/path/to/chrome node test/rerun.mjs   # 図形数変更→再実行(続きから追加/新規実行の分岐)を検証
```

## パラメータの勘所

| パラメータ     | 効果                                                                             |
| -------------- | -------------------------------------------------------------------------------- |
| 図形数 N       | 大きいほど細部が出る。200〜1000 が実用域                                         |
| サイズ範囲     | 狭く小さく取ると点描調、広く大きく取ると抽象画調。N とセットで調整する           |
| α (不透明度)   | 小さいほど滑らか・多くの図形が必要。128 前後が標準。小さめ(64〜96)にすると水彩的 |
| 計算解像度     | 品質と速度のトレードオフ。256px で十分なことが多い                               |
| ランダム候補数 | 大きいほど良い図形を引きやすいが線形に遅くなる                                   |
| 山登り停滞許容 | 局所改善の粘り。大きいほど 1 図形あたりの品質が上がる                            |
| 焼きなまし     | 局所解から抜け出しやすくなる。図形が複雑(回転楕円・ベジェ)なときに効く           |
| 温度           | 高いほど悪化を受け入れやすい。0.2〜0.5 が目安                                    |

参考値(サンプル画像 640×640、計算解像度 192px、候補32・停滞16、150 図形):

| 図形                 | 配色           | RMSE   | 一致度 | 時間 |
| -------------------- | -------------- | ------ | ------ | ---- |
| 三角形               | 自動抽出       | 0.0253 | 97.5%  | 0.5s |
| 円+正多角形+回転楕円 | グラデーション | 0.0839 | 91.6%  | 0.3s |
| 矩形(回転)+四角形    | 固定パレット   | 0.0942 | 90.6%  | 0.3s |
| 線分+ベジェ          | モノクロ       | 0.1888 | 81.1%  | 0.2s |

## 構成

```
index.html
src/
  main.ts              UI の配線・状態管理・書き出し
  style.css
  core/
    types.ts           図形・設定・Worker メッセージの型
    rng.ts             再現性のある擬似乱数 (mulberry32)
    raster.ts          スキャンライン・ラスタライザ(nonzero winding / 楕円 / ストローク輪郭)
    shapes.ts          図形の生成・変異・ラスタライズ
    color.ts           配色制約(ランプ/パレット射影)
    score.ts           SSE 全体計算・誤差統計の単一パス収集(最適色と差分 SSE を閉形式で導出)・α合成
    model.ts           1ステップの最適化(ランダム探索 → 焼きなまし → 山登り)
    svg.ts             任意ステップの SVG 書き出し
    worker.ts          最適化ワーカー
  ui/
    i18n.ts            日本語/英語の UI 辞書と切替
    render.ts          Canvas 2D への高解像度描画
  video/               動画版(video.html)
    types.ts           トラック・キーフレーム・設定・Worker メッセージの型
    flow.ts            疎ピラミッドLK・アフィンフィット・図形自由度への射影・Λ距離
    model.ts           逐次ソルバ(輸送 → 再フィット → 生死 → 誕生)
    keyframes.ts       パラメータ空間 RDP によるキーフレーム化
    animsvg.ts         SMIL アニメーション SVG 書き出し
    worker.ts          動画ワーカー(カット検出・時間バイラテラルを含む)
    main.ts            動画ページの UI・フレーム抽出・再生
test/
  smoke.mjs            Playwright によるヘッドレス動作確認(4通りの図形×配色で完走と誤差低下を検証)
  size.mjs             サイズ範囲が全ステップで守られているかを JSON 書き出しから検証
  video.mjs            動画版の動作確認(合成webmで完走・churn・キーフレーム化・アニメSVGを検証)
  rerun.mjs            図形数変更→再実行の分岐(続きから追加 / 新規実行)を検証
scripts/
  readme-assets.mjs    README 用 SVG(タイトル/ヒーロー/配色比較/動画デモ)をアプリ自身のパイプラインで生成
docs/assets/           上記スクリプトの出力(README から参照される)
```

## 類似プロジェクト

- [fogleman/primitive](https://github.com/fogleman/primitive) — Go 製 CLI。この系譜の代表実装
- [Geometrize](https://github.com/Tw1ddle/geometrize) — デスクトップ GUI (Qt) + Haxe ライブラリ
- [primitive.js](https://github.com/ondras/primitive.js) — ブラウザ実装
- Roger Alsing の "EvoLisa" — 遺伝的アルゴリズムによる先駆的実装

## License

[MIT](LICENSE)
