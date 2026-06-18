/**
 * 이중 트랙 결제 (기획서 §3) — 이 게임의 심장.
 *
 * HP 지불 → 두 장부로 회수:
 *   트랙 A(Vitality): = hpCost, 가방 절대 불가침, 레벨업/생존 결정(빌드 무관·결정론적).
 *   트랙 B(Gold·Score): 가방 시너지가 증폭하는 유일한 대상. 생존엔 닿지 못한다.
 *
 * resolvePayment 는 트랙 A 를 바꿀 수 있는 인자를 애초에 받지 않는다(설계로 차단).
 */
import type { PaymentResult } from './types';
import type { SynergyResult } from './backpack';

export interface EconomyConfig {
  startHp: number;
  maxHpPerLevel: number;
  levelUpCostBase: number;
  levelUpCostStep: number;
  vitalityPerDamage: number;
  goldPerDamageBase: number;
  scorePerDamageBase: number;
  levelUpBurstGoldPerHp: number;
  dragonLevel: number;
}

/** 레벨 L→L+1 에 필요한 Vitality(기획서 §2.3 곡선). */
export function levelUpCost(level: number, econ: EconomyConfig): number {
  return econ.levelUpCostBase + econ.levelUpCostStep * (level - 1);
}

/** 레벨 L 에서의 최대 HP. */
export function maxHpAt(level: number, econ: EconomyConfig): number {
  return econ.startHp + (level - 1) * econ.maxHpPerLevel;
}

/**
 * 몬스터 처치(클릭) 결제. synergy 는 트랙 B 에만 전달된다.
 * trackA_vitality 는 hpCost 에서만 파생 — synergy 와 무관(헌법 #1).
 */
export function resolvePayment(
  monsterId: string,
  monsterLevel: number,
  currentHp: number,
  synergy: SynergyResult,
  econ: EconomyConfig,
): PaymentResult {
  const hpCost = monsterLevel;

  // ★ 트랙 A: 가방 미적용. 지불 Lv 에만 비례.
  const trackA = Math.round(hpCost * econ.vitalityPerDamage);

  // ★ 트랙 B: 가방 시너지 적용.
  const gold = Math.round(
    monsterLevel * econ.goldPerDamageBase * (1 + synergy.goldRateSum) +
      monsterLevel * synergy.goldLvScaleSum,
  );
  const scoreBase =
    monsterLevel * econ.scorePerDamageBase +
    monsterLevel * synergy.scorePerLvSum +
    synergy.voidScoreFlat;
  const score = Math.max(0, Math.round(scoreBase * (1 + synergy.isolationBonus)));

  return {
    monsterId,
    monsterLevel,
    hpCost,
    trackA_vitality: trackA,
    trackB_gold: Math.max(0, gold),
    trackB_score: score,
    // 사망은 HP가 음수가 될 때만(0은 생존 — 0까지 쥐어짜고 레벨업 가능).
    lethal: currentHp - hpCost < 0,
  };
}
