import { describe, it, expect } from 'vitest';
import { resolvePayment, levelUpCost, maxHpAt, type EconomyConfig } from '../src/core/payment';
import type { SynergyResult } from '../src/core/backpack';

const econ: EconomyConfig = {
  startHp: 5,
  maxHpPerLevel: 1,
  levelUpCostBase: 4,
  levelUpCostStep: 3,
  vitalityPerDamage: 1,
  goldPerDamageBase: 1,
  scorePerDamageBase: 1,
  levelUpBurstGoldPerHp: 0.5,
  dragonLevel: 15,
};

function syn(partial: Partial<SynergyResult>): SynergyResult {
  return {
    goldRateSum: 0,
    goldLvScaleSum: 0,
    scorePerLvSum: 0,
    voidScoreFlat: 0,
    isolationBonus: 0,
    misclickGuards: 0,
    sculptBonus: 0,
    ...partial,
  };
}

describe('이중 트랙 결제 (기획서 §3)', () => {
  it('안전망 ②-1: 트랙 A(Vitality)는 가방 시너지와 무관하게 hpCost와 1:1', () => {
    const zero = resolvePayment('purpleslime', 8, 20, syn({}), econ);
    const loaded = resolvePayment(
      'purpleslime',
      8,
      20,
      syn({ goldRateSum: 5, goldLvScaleSum: 2, scorePerLvSum: 10, voidScoreFlat: 50, isolationBonus: 1 }),
      econ,
    );
    // ★ 핵심: 어떤 가방을 껴도 트랙 A는 동일 (생존은 빌드 무관)
    expect(zero.trackA_vitality).toBe(8);
    expect(loaded.trackA_vitality).toBe(8);
    expect(zero.hpCost).toBe(loaded.hpCost);
    // 트랙 B(골드)는 가방이 증폭
    expect(loaded.trackB_gold).toBeGreaterThan(zero.trackB_gold);
  });

  it('lethal 판정: HP가 음수가 될 때만 사망(0은 생존)', () => {
    expect(resolvePayment('lich', 11, 11, syn({}), econ).lethal).toBe(false); // 11-11=0 생존
    expect(resolvePayment('lich', 11, 10, syn({}), econ).lethal).toBe(true); // 10-11=-1 사망
    expect(resolvePayment('bat', 1, 1, syn({}), econ).lethal).toBe(false); // 1-1=0 생존
    expect(resolvePayment('bat', 1, 0, syn({}), econ).lethal).toBe(true); // 0-1=-1 사망
  });

  it('트랙 B 산식: 모든 보상 시너지가 골드로 통합 적용', () => {
    // base=8, flat=8(scorePerLv) → round((8*1.25 + 8)*1) = 18
    const r = resolvePayment('purpleslime', 8, 99, syn({ goldRateSum: 0.25, scorePerLvSum: 1 }), econ);
    expect(r.trackB_gold).toBe(18);
  });

  it('여백 골드는 처치당 고정(클릭 횟수 비례 아님 — §5.7)', () => {
    const r = resolvePayment('bat', 1, 99, syn({ voidScoreFlat: 3 }), econ);
    expect(r.trackB_gold).toBe(1 + 3);
  });

  it('경제 공식: 레벨업 비용/최대HP 곡선', () => {
    expect(levelUpCost(1, econ)).toBe(4);
    expect(levelUpCost(12, econ)).toBe(4 + 3 * 11);
    expect(maxHpAt(1, econ)).toBe(5);
    expect(maxHpAt(12, econ)).toBe(16); // 드래곤(15) 처치 생존 가능
  });
});
