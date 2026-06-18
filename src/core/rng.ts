/**
 * 결정론적 시드 RNG (mulberry32).
 * 같은 시드 → 같은 보드. 보드 재현/테스트(안전망 ②)에 필수.
 * Math.random 을 직접 쓰지 않는다(재현 불가하므로).
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // 0 시드 회피
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  /** [0, 1) */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max] 정수 */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** 배열에서 무작위 1개 */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }

  /** Fisher–Yates 셔플(제자리). */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** p 확률로 true */
  chance(p: number): boolean {
    return this.next() < p;
  }
}

/** 시간 비의존 시드 생성기(호출 측에서 시간/입력으로 만들어 주입). */
export function makeSeed(a: number, b = 0): number {
  return ((a ^ 0x85ebca6b) + Math.imul(b, 0xc2b2ae35)) >>> 0;
}
