/** 再現性のある擬似乱数 (mulberry32)。同じ seed なら常に同じ結果になる。 */
export class Rng {
  private s: number

  constructor(seed: number) {
    this.s = seed >>> 0 || 1
  }

  next(): number {
    let t = (this.s += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  int(n: number): number {
    return Math.floor(this.next() * n)
  }

  range(a: number, b: number): number {
    return a + this.next() * (b - a)
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)]
  }

  /** 標準正規分布 (Box-Muller) */
  gauss(): number {
    let u = 0
    let v = 0
    while (u === 0) u = this.next()
    while (v === 0) v = this.next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
