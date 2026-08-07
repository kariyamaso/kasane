/**
 * Layer 4 — 軌跡のキーフレーム化
 *
 * 全フレーム処理後、各トラックの θ_i(t) はパラメータの時系列になっている。
 * パラメータ空間の Ramer–Douglas–Peucker を誤差許容 ε で走らせ、
 * 密な毎フレーム値を疎なキーフレーム列に落とす。これが SVG/JSON 出力と
 * 任意リタイミングの実体。距離は Λ 重み(位置=px、角度=弧長換算、色・αは減衰重み)。
 */

import type { Shape, ShapeKind } from '../core/types'
import { circumRadius } from './flow'
import type { KeyTrack, Keyframe, TrackSample } from './types'

export interface FinishedTrack {
  k: ShapeKind
  birth: number
  death: number
  samples: TrackSample[]
}

const COLOR_W = 0.15 // 色 1 単位(0..255) ≈ 0.15px の逸脱として数える
const ALPHA_W = 0.3

/** 角度パラメータの添字(-1 = なし)。flow.ts の paramDist2 と同じ規約 */
function angleIndex(k: ShapeKind): number {
  return k === 'rotrect' || k === 'rotellipse' ? 4 : k === 'regular' ? 3 : -1
}

/** サンプルを Λ 重み付きベクトルへ(角度は unwrap して連続化してから R を掛ける) */
function buildVectors(track: FinishedTrack): Float64Array[] {
  const s0 = track.samples[0]
  const ai = angleIndex(track.k)
  const R = Math.max(1, circumRadius({ k: track.k, p: s0.p } as Shape))
  const np = track.k === 'regular' ? 4 : s0.p.length // regular の辺数は除外
  const dim = np + 4 // + r,g,b,alpha
  let prevAngle = 0
  let unwrapOffset = 0
  return track.samples.map((s, idx) => {
    const v = new Float64Array(dim)
    for (let i = 0; i < np; i++) {
      if (i === ai) {
        // 角度は 2π 跨ぎで距離が跳ねないよう unwrap する
        if (idx > 0) {
          let d = s.p[i] - prevAngle
          d = Math.atan2(Math.sin(d), Math.cos(d))
          unwrapOffset += d - (s.p[i] - prevAngle)
        }
        prevAngle = s.p[i]
        v[i] = (s.p[i] + unwrapOffset) * R
      } else {
        v[i] = s.p[i]
      }
    }
    v[np] = s.color.r * COLOR_W
    v[np + 1] = s.color.g * COLOR_W
    v[np + 2] = s.color.b * COLOR_W
    v[np + 3] = s.alpha * ALPHA_W
    return v
  })
}

/** 時刻パラメータの線形補間からの逸脱で分割する RDP(スタック版) */
function rdpKeep(vecs: Float64Array[], eps: number): boolean[] {
  const n = vecs.length
  const keep = new Array<boolean>(n).fill(false)
  keep[0] = true
  keep[n - 1] = true
  if (n <= 2) return keep
  const eps2 = eps * eps
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [i0, i1] = stack.pop()!
    if (i1 - i0 < 2) continue
    const a = vecs[i0]
    const b = vecs[i1]
    let worst = -1
    let worstD = eps2
    for (let j = i0 + 1; j < i1; j++) {
      const t = (j - i0) / (i1 - i0)
      const v = vecs[j]
      let d2 = 0
      for (let m = 0; m < v.length; m++) {
        const d = v[m] - (a[m] + (b[m] - a[m]) * t)
        d2 += d * d
      }
      if (d2 > worstD) {
        worstD = d2
        worst = j
      }
    }
    if (worst >= 0) {
      keep[worst] = true
      stack.push([i0, worst], [worst, i1])
    }
  }
  return keep
}

export function keyframeTracks(tracks: FinishedTrack[], eps: number): KeyTrack[] {
  return tracks
    .filter((t) => t.samples.length > 0)
    .map((t) => {
      const keep = rdpKeep(buildVectors(t), eps)
      const keys: Keyframe[] = []
      for (let i = 0; i < t.samples.length; i++) {
        if (!keep[i]) continue
        const s = t.samples[i]
        keys.push({ t: t.birth + i, p: s.p.slice(), color: s.color, alpha: s.alpha })
      }
      return { k: t.k, birth: t.birth, death: t.death, keys }
    })
}
