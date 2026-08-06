# Kasane 襲

**Layered geometric image approximation in the browser**
**幾何プリミティブを重ねて画像を構成する / Geometric Primitive-Based Image Approximation**

[![CI](https://github.com/kariyamaso/kasane/actions/workflows/ci.yml/badge.svg)](https://github.com/kariyamaso/kasane/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Demo: https://kariyamaso.github.io/kasane/**

> A web app that progressively reconstructs a target image by layering
> semi-transparent geometric primitives (triangles, quads, circles, polygons,
> lines, Bézier curves). Uses stochastic hill climbing with optional simulated
> annealing, closed-form optimal color solving, and scanline-based incremental
> SSE evaluation — all running in a Web Worker. Exports PNG / SVG / JSON.
> Fully client-side, no server required.

**Kasane（襲／かさね）** は、半透明の衣を何枚も重ねて合成色を作る平安期の色彩技法
「[襲の色目](https://ja.wikipedia.org/wiki/%E8%A5%B2%E3%81%AE%E8%89%B2%E7%9B%AE)」に由来します。
半透明の幾何図形を重ね、パレットで色を統制しながら像を立ち上げるこのアプリの動作そのものです。

*The name comes from* kasane no irome, *the Heian-era practice of layering
translucent garments so that the overlapping colors form a new composite hue —
which is, quite literally, what this program does.*

基準画像を、三角形・四角形・円・正多角形・線分・ベジェ曲線などの単純図形を
半透明で重ねることによって段階的に構成する Web アプリケーション。
図形数 N が少ない段階では概形だけが見え、N が増えるほど細部が復元される
(coarse-to-fine / progressive approximation)。

```
Î_N(x, y) = Composite(P_1, P_2, …, P_N)
P_i       = (形状, 位置, 大きさ, 回転, 色, α)
```

## 既存実装との差分

同じ系譜の実装との比較。**過大に主張しないために、相手側の機能は公式 README・UI 定義・API
ドキュメントで確認できた範囲のみを記載している**（「なし」は「文書化された機能として確認できなかった」の意）。

| | [fogleman/primitive](https://github.com/fogleman/primitive) | [Geometrize](https://github.com/Tw1ddle/geometrize) | [primitive.js](https://github.com/ondras/primitive.js) | **Kasane** |
| --- | --- | --- | --- | --- |
| 形態 | CLI (Go) | デスクトップ GUI (Qt) + Haxe ライブラリ | ブラウザ | ブラウザ |
| 図形 | 8種 + combo | 9種 | 4種 | 10種 |
| 色 | 最適色（自動） | 最適色（自動） | 最適色（自動、背景のみ固定色指定可） | 最適色 **+ グラデーション / 固定パレット / モノクロ階調への射影、元色ブレンド** |
| 図形サイズの制約 | なし | GUI にはなし（ChaiScript のシェイプミューテータを編集すれば可能） | なし | **GUI スライダーで外接円半径の下限・上限** |
| 中間状態 | `-nth` で連番出力 / アニメ GIF | ステップ実行・連番 PNG・アニメ GIF | 逐次表示のみ | **全ステップを保持し、双方向にスクラブ・再生** |
| 配置範囲の制約 | なし | あり（Shape Bounding Area） | なし | なし |
| 拡張 | ソース改変 | **ChaiScript フック多数**（誤差関数・変異・各種コールバック） | ソース改変 | ソース改変 |
| 並列化 | あり (`-j`) | あり (`maxThreads`) | なし | なし（Worker 1本） |
| 出力 | PNG/JPG/SVG/GIF | PNG/連番PNG/SVG/GIF/JSON/HTML5 canvas/WebGL | PNG/SVG | PNG/SVG/JSON |

**本質的な機能差は「配色の統制」の一点**。閉形式で求めた最適色を、ユーザー指定の色空間へ射影する
層を挟むことで、忠実度を保ったまま作風だけを差し替えられる。上記 4 実装のいずれにも
パレット・グラデーション制約は文書化されていない（Geometrize は `customEnergyFunction`
スクリプトフックがあるため、書けば近いことは実現できる）。

サイズ範囲と中間状態のスクラブは、機能の有無ではなく **GUI で直に触れることの差**（Geometrize は
スクリプト編集、primitive はフラグと外部ツール）。拡張性と並列化では Geometrize が明確に上。

## この手法の呼び名

| 文脈 | 名称 |
| --- | --- |
| 総称 | Geometric Primitive-Based Image Approximation / Primitive-Based Image Reconstruction |
| 途中経過が概形として成立する性質 | Progressive Image Approximation / Coarse-to-Fine Image Reconstruction |
| 進化計算で解く系譜 | Evolutionary Image Approximation / Evolutionary Art / Genetic Algorithm Image Reconstruction |
| 多角形に限定した場合 | Polygon-Based Image Approximation |
| 代表的実装 | [fogleman/primitive](https://github.com/fogleman/primitive)(Go)、Roger Alsing の "EvoLisa"(GA) |

本実装は fogleman/primitive 系の **確率的山登り法 + 焼きなまし** を採用している
(GA より 1〜2 桁速く、同じ図形数でより低い誤差に到達するため)。

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
- **図形サイズ**: 最小・最大を長辺比で指定するスライダー。詳細は下記「サイズの制御」
- **配色**
  - `元画像から自動抽出` — 最適色をそのまま使う(最も忠実)
  - `グラデーション` — 任意個の色ストップで作ったランプへ射影。写像は「最近傍(色相を尊重)」と「輝度マッピング」を選択可
  - `固定パレット` — 指定色のみを使用(ポスター/シルクスクリーン風)
  - `モノクロ / 単色階調` — 2色ランプへ輝度で写像
  - `元色ブレンド` — 制約色と元色を任意比率で混ぜられる(0% = 完全にパレット / 100% = 元色)
- **中間状態**: タイムラインスライダーで任意ステップの状態を再描画、再生ボタンで構成過程をアニメーション
- **表示**: 並列 / 結果のみ / 元画像 / 差分ヒートマップ
- **書き出し**: PNG(任意解像度) / SVG(ベクタ、無限に拡大可) / JSON(図形列そのもの)
- **再現性**: 乱数シード固定。同じ設定なら常に同じ結果

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
```

## サイズの制御

サイズは一貫して **外接円半径 R**(重心から最も遠い点までの距離)として扱い、
UI の「サイズ範囲」スライダーで **画像の長辺に対する比率**で下限・上限を指定する(既定 1.5% 〜 30%)。
この範囲は生成時と変異時の両方に効くので、探索の全域で保証される。

| 図形 | R の解釈 |
| --- | --- |
| 三角形 / 任意四角形 | 重心から各頂点までの最大距離 |
| 矩形 / 回転矩形 | 対角線の半分 |
| 楕円 / 回転楕円 | 長半径 |
| 円 / 正多角形 | 半径 / 外接円半径 |
| 線分 / ベジェ | 端点(と制御点)の重心からの最大距離。線の太さは別枠で `[0.3·minR, 0.25·maxR]` から導出 |

範囲外に出た図形は `constrainSize()` が押し戻す。頂点が自由な図形は重心を中心にスケール、
半径パラメータを持つ図形はアスペクト比を保ったままスケールするので、形は崩れない。

使い分けの例(サンプル画像・80図形・256px・全図形種):

| 設定 | 結果 |
| --- | --- |
| 1.0% 〜 3.0% | 点描・スティップル調。RMSE 0.185(少ない図形数では画面を覆いきれない) |
| 1.5% 〜 30%(既定) | 標準。RMSE 0.047 |
| 35% 〜 60% | 大胆な面構成・抽象画調。RMSE 0.069 |

小さい図形だけで構成する場合は図形数 N を大きく(1000〜)、
大きい図形だけなら N は少なく(50〜150)、α を下げると馴染む。

## 内部のサイズ関連定数

スライダーで足りない場合に触る場所(`src/core/shapes.ts`)。`u = 計算解像度の長辺`。

| 定数 | 既定 | 意味 |
| --- | --- | --- |
| `sigma` | `min(u·0.06, maxR·0.6) · temp` | 位置・半径の変異ジッタの標準偏差 |
| `strokeRange()` | `[0.3·minR, 0.25·maxR]` | 線分・ベジェの太さ範囲 |
| 座標クランプ | `[-0.15w, 1.15w] × [-0.15h, 1.15h]` | 画面外へのはみ出し許容量 |
| 角度ジッタ | `N(0, 0.5·temp)` rad | 回転の変異幅 |
| `halfExtents()` | `θ ∈ [0.24, π/2−0.24]` | 矩形のアスペクト比の許容範囲 |
| `ELLIPSE_SEGMENTS` | 40 | 回転楕円の多角形近似の分割数 |

## パラメータの勘所

| パラメータ | 効果 |
| --- | --- |
| 図形数 N | 大きいほど細部が出る。200〜1000 が実用域 |
| サイズ範囲 | 狭く小さく取ると点描調、広く大きく取ると抽象画調。N とセットで調整する |
| α (不透明度) | 小さいほど滑らか・多くの図形が必要。128 前後が標準。小さめ(64〜96)にすると水彩的 |
| 計算解像度 | 品質と速度のトレードオフ。256px で十分なことが多い |
| ランダム候補数 | 大きいほど良い図形を引きやすいが線形に遅くなる |
| 山登り停滞許容 | 局所改善の粘り。大きいほど 1 図形あたりの品質が上がる |
| 焼きなまし | 局所解から抜け出しやすくなる。図形が複雑(回転楕円・ベジェ)なときに効く |
| 温度 | 高いほど悪化を受け入れやすい。0.2〜0.5 が目安 |

参考値(サンプル画像 640×640、計算解像度 192px、候補32・停滞16、150 図形):

| 図形 | 配色 | RMSE | 一致度 | 時間 |
| --- | --- | --- | --- | --- |
| 三角形 | 自動抽出 | 0.0253 | 97.5% | 0.5s |
| 円+正多角形+回転楕円 | グラデーション | 0.0839 | 91.6% | 0.3s |
| 矩形(回転)+四角形 | 固定パレット | 0.0942 | 90.6% | 0.3s |
| 線分+ベジェ | モノクロ | 0.1888 | 81.1% | 0.2s |

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
    render.ts          Canvas 2D への高解像度描画
test/
  smoke.mjs            Playwright によるヘッドレス動作確認(4通りの図形×配色で完走と誤差低下を検証)
  size.mjs             サイズ範囲が全ステップで守られているかを JSON 書き出しから検証
```

## 拡張の入口

- **新しい図形を足す**: `types.ts` の `ShapeKind` に追加 → `shapes.ts` の `randomShape` / `mutateShape` / `shapeScanlines` / `outlinePoints` に分岐を足す → `svg.ts` と `ui/render.ts` に描画を足す。それだけで最適化・UI・書き出しすべてに乗る
- **別の誤差指標**: `score.ts` の `partialSSE` を差し替える(SSIM 的な重み付け、勾配項の追加など)
- **GA との比較実験**: `model.ts` の `search()` を差し替えれば、同じ評価系のまま進化計算版を実装できる
- **図形列の解析**: JSON 書き出しに全図形のパラメータ・色・α・そのステップ時点の RMSE が入っているので、
  「N に対する誤差の減衰曲線」「図形種別ごとの寄与」などをそのまま解析できる

## License

[MIT](LICENSE)
