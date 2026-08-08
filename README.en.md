<p align="center">
  <img src="docs/assets/title.svg" width="760" alt="KASANE 襲 — the wordmark being assembled from 900 triangles (looping animation)" />
</p>

<p align="center"><b>Layered Geometric Primitive-Based Image Approximation</b></p>

<p align="center"><a href="./README.md">日本語</a> ｜ <b>English</b></p>

<p align="center">
  <img src="docs/assets/hero.svg" width="100%" alt="240 translucent triangles layering one by one into a landscape of mountains and a sun (looping)" />
</p>

[![CI](https://github.com/kariyamaso/kasane/actions/workflows/ci.yml/badge.svg)](https://github.com/kariyamaso/kasane/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

<p align="center">
  <a href="https://kariyamaso.github.io/kasane/?lang=en"><img src="docs/assets/btn-demo.svg" width="280" alt="▶ Open the image demo" /></a>&nbsp;
  <a href="https://kariyamaso.github.io/kasane/video.html?lang=en"><img src="docs/assets/btn-video.svg" width="280" alt="▶ Open the video demo" /></a>
</p>

> A web app that progressively reconstructs a target image by layering
> semi-transparent geometric primitives (triangles, quads, circles, polygons,
> lines, Bézier curves). Uses stochastic hill climbing with optional simulated
> annealing, closed-form optimal color solving, and scanline-based incremental
> SSE evaluation — all running in a Web Worker. Exports PNG / SVG / JSON.
> Fully client-side, no server required.

**Kasane (襲 / かさね)** is named after
[kasane no irome](https://en.wikipedia.org/wiki/Irome), the Heian-era practice
of layering translucent garments so that the overlapping colors form a new
composite hue — which is, quite literally, what this program does: it layers
translucent geometric shapes while keeping their colors under palette control.

The app reconstructs a target image step by step from simple shapes —
triangles, quads, circles, regular polygons, line segments, Bézier strokes —
rendered semi-transparently on top of each other.

<img src="docs/assets/divider.svg" width="100%" alt="" />

## Example

<p align="center">
  <img src="docs/assets/example-1.svg" width="24%" alt="Monet, Water Lilies — 4000 shapes" />
  <img src="docs/assets/example-2.svg" width="24%" alt="Van Gogh, The Starry Night — 4-color fixed palette, 12000 shapes" />
  <img src="docs/assets/example-3.svg" width="24%" alt="Apple — 3500 shapes" />
  <img src="docs/assets/example-4.svg" width="24%" alt="Lakeside lupins — 4500 shapes" />
</p>
<p align="center"><sub>
All four are Kasane's own output, replaying their construction in a loop. Left to right:
Monet's <i>Water Lilies</i> (mixed shapes, 4000) ／
Van Gogh's <i>The Starry Night</i> (4-color fixed palette, α101, 12000) ／
an apple (circle/ellipse-heavy, 3500) ／ lakeside lupins (with Bézier strokes, 4500)
</sub></p>

<img src="docs/assets/divider.svg" width="100%" alt="" />

## Algorithm

Each step commits one shape.

1. **Random candidates** — generate `randomTries` random candidates from the enabled shape kinds
2. **Closed-form optimal color** — for the pixels a shape covers, the fill color that best matches the target after compositing can be solved analytically

   ```
   composite: result = current·(1-α) + s·α
   setting result ≈ target gives  s = current + (target - current)/α
   ```

   averaged over the covered pixels. Since color never needs to be searched, the search space is geometry only.

3. **Apply the color constraint** — project the optimal color onto the user-specified color space (gradient / fixed palette / monochrome ramp)
4. **Local search** — from the best candidate, refine geometry with (optional) simulated annealing → hill climbing
5. **Commit & composite** — α-blend the shape with the lowest error into the current buffer

<img src="docs/assets/divider.svg" width="100%" alt="" />

## Video mode

<p align="center">
  <img src="docs/assets/video-demo.svg" width="100%" alt="An animated SVG reconstructing a synthetic scene of a sun arcing across the sky from shape trajectories" />
</p>
<p align="center"><sub>
Real output of the video pipeline (36 frames, 90 shapes). Unlike frame-independent processing, shapes <b>move as trajectories</b> instead of flickering.
</sub></p>

| Layer                | Processing                                                                                                                                                                                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layer 0 preprocess   | 3-frame temporal bilateral (moving pixels are not mixed) + shot-cut detection by inter-frame RMSE. Never advect across a cut                                                                                                                                                             |
| Layer 1 advection    | Sample up to 28 points from each shape's support, solve sparse pyramidal Lucas–Kanade, least-squares fit a 2×3 affine, project onto the shape's degrees of freedom (translation + radius for circles, rotation too for angled shapes). No dense flow needed — O(M × a few dozen points)   |
| Layer 2 refit        | Composite in one bottom-to-top z-sweep; only the top fraction (default 40%) by support residual gets warm-start hill climbing. The smoothness term λ\_v·n·‖θ−θ̂‖²\_Λ is added directly to the score (Λ converts angles to arc length in px). Optimal colors are re-solved in closed form every frame and mixed with color inertia |
| Layer 3 birth/death  | A shape whose contribution (SSE improvement per covered pixel) stays below τ_death for 2 consecutive frames retires; greedy additions against the residual are capped at B per frame. The **hysteresis τ_birth = 4·τ_death** prevents flicker near the threshold. Birth and death ramp α over k frames (choreography) |
| Layer 4 keyframing   | After all frames, run parameter-space Ramer–Douglas–Peucker on each θ_i(t) (tolerance ε; angles unwrapped and arc-length weighted), compressing per-frame values into sparse keyframes                                                                                                    |

<img src="docs/assets/divider.svg" width="100%" alt="" />

## Usage

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # emits static files into dist/ (deployable anywhere)
npm run preview
```

### Headless verification

```bash
npm run build
npx vite preview --port 4173 &
CHROME_PATH=/path/to/chrome node test/smoke.mjs   # screenshots land in tmp/
CHROME_PATH=/path/to/chrome node test/size.mjs
CHROME_PATH=/path/to/chrome node test/video.mjs   # video mode (generates a synthetic webm; checks completion, churn, animated SVG)
CHROME_PATH=/path/to/chrome node test/rerun.mjs   # verifies the rerun branching (extend vs fresh run)
```

<img src="docs/assets/divider.svg" width="100%" alt="" />

## Parameter intuitions

| Parameter           | Effect                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Shape count N       | More shapes = more detail. 200–1000 is the practical range                                 |
| Size range          | Narrow & small = pointillism; wide & large = abstract. Tune together with N                |
| α (opacity)         | Lower = smoother, needs more shapes. ~128 is standard; 64–96 gives a watercolor feel       |
| Compute resolution  | Quality/speed trade-off. 256px is usually enough                                           |
| Random candidates   | More candidates find better shapes but cost scales linearly                                |
| Hill-climb patience | Persistence of local refinement; higher = better quality per shape                         |
| Annealing           | Helps escape local optima; effective for complex shapes (rotated ellipses, Béziers)        |
| Temperature         | Higher accepts worse moves more readily. 0.2–0.5 is a good range                           |

Reference numbers (sample image 640×640, compute 192px, 32 candidates,
patience 16, 150 shapes):

| Shapes                              | Color         | RMSE   | Match | Time |
| ----------------------------------- | ------------- | ------ | ----- | ---- |
| Triangles                           | Auto          | 0.0253 | 97.5% | 0.5s |
| Circles + polygons + rot. ellipses  | Gradient      | 0.0839 | 91.6% | 0.3s |
| Rot. rects + quads                  | Fixed palette | 0.0942 | 90.6% | 0.3s |
| Lines + Béziers                     | Monochrome    | 0.1888 | 81.1% | 0.2s |

<img src="docs/assets/divider.svg" width="100%" alt="" />

## Layout

```
index.html
src/
  main.ts              UI wiring, state management, export
  style.css
  ui/
    i18n.ts            Japanese/English UI dictionary and switcher
    render.ts          High-resolution Canvas 2D rendering
  core/
    types.ts           Shape / config / worker message types
    rng.ts             Reproducible PRNG (mulberry32)
    raster.ts          Scanline rasterizer (nonzero winding / ellipses / stroke outlines)
    shapes.ts          Shape generation, mutation, rasterization
    color.ts           Color constraints (ramp/palette projection)
    score.ts           Full SSE, single-pass error statistics (closed-form optimal color & delta SSE), α compositing
    model.ts           One optimization step (random search → annealing → hill climb)
    svg.ts             SVG export at any step
    worker.ts          Optimization worker
  video/               Video mode (video.html)
    types.ts           Track / keyframe / config / worker message types
    flow.ts            Sparse pyramidal LK, affine fit, projection onto shape DOF, Λ distance
    model.ts           Sequential solver (advect → refit → birth/death)
    keyframes.ts       Parameter-space RDP keyframing
    animsvg.ts         SMIL-animated SVG export
    worker.ts          Video worker (cut detection, temporal bilateral)
    main.ts            Video page UI, frame extraction, playback
test/
  smoke.mjs            Headless check via Playwright (4 shape×color cases: completion & error decrease)
  size.mjs             Verifies size bounds hold at every step, from the JSON export
  video.mjs            Video-mode check (synthetic webm: completion, churn, keyframing, animated SVG)
  rerun.mjs            Verifies rerun branching (extend vs fresh run)
scripts/
  readme-assets.mjs    Generates the README SVGs (title/hero/palette/video demo) with the app's own pipeline
docs/assets/           Output of the script above (referenced from the README)
```

<img src="docs/assets/divider.svg" width="100%" alt="" />

## Related projects

- [fogleman/primitive](https://github.com/fogleman/primitive) — Go CLI; the representative implementation of this lineage
- [Geometrize](https://github.com/Tw1ddle/geometrize) — desktop GUI (Qt) + Haxe library
- [primitive.js](https://github.com/ondras/primitive.js) — browser implementation
- Roger Alsing's "EvoLisa" — pioneering genetic-algorithm variant

<img src="docs/assets/divider.svg" width="100%" alt="" />

## Creator

<p align="center">
  <a href="https://x.com/so_kariyama"><img src="https://img.shields.io/badge/X_(Twitter)-%40so__kariyama-0e1013?style=for-the-badge&logo=x&logoColor=white" alt="X: @so_kariyama" /></a>
</p>
<p align="center">
  <a href="https://x.com/so_kariyama"><img src="docs/assets/qr.png" width="150" alt="QR code for @so_kariyama on X" /></a>
</p>

<img src="docs/assets/divider.svg" width="100%" alt="" />

## License

[MIT](LICENSE)
