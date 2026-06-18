import { describe, it, expect } from 'vitest';
import {
  canPlace,
  computeSynergy,
  createBackpackFromLayout,
  defaultBackpack,
  rotatedCells,
  type SynergyConfig,
} from '../src/core/backpack';
import { balance, getItem } from '../src/data';
import type { PlacedItem } from '../src/core/types';

const synCfg: SynergyConfig = balance.synergy;

describe('가방 시스템 (기획서 §4, §5)', () => {
  it('레이아웃: 활성/돌출 슬롯 파싱', () => {
    const bp = createBackpackFromLayout(['.X.', 'XPX']);
    expect(bp.width).toBe(3);
    expect(bp.cells.filter((c) => c.active).length).toBe(4);
    expect(bp.cells.filter((c) => c.protruding).length).toBe(1);
  });

  it('회전: L자 형태가 90도 회전 후 정규화', () => {
    const lshape = getItem('hazard-marker'); // [(0,0),(0,1),(1,1)]
    const r0 = rotatedCells(lshape, 0);
    const r1 = rotatedCells(lshape, 1);
    expect(r0.length).toBe(3);
    expect(r1.length).toBe(3);
    // 회전해도 모든 좌표는 음수가 아니다(정규화)
    expect(r1.every((c) => c.x >= 0 && c.y >= 0)).toBe(true);
  });

  it('배치 검증: 비활성/범위 밖은 거부', () => {
    const bp = defaultBackpack();
    const ring = getItem('whetstone-ring'); // 1x1
    expect(canPlace(bp, ring, { x: 0, y: 0 }, 0, getItem)).toBe(false); // (0,0) 비활성
    expect(canPlace(bp, ring, { x: 2, y: 2 }, 0, getItem)).toBe(true);
  });

  it('line 시너지: 같은 행 정렬 시 선형 강화', () => {
    const bp = defaultBackpack();
    bp.items = [
      { itemId: 'whetstone-ring', origin: { x: 1, y: 0 }, rotation: 0 },
      { itemId: 'whetstone-ring', origin: { x: 2, y: 0 }, rotation: 0 },
    ] as PlacedItem[];
    const s = computeSynergy(bp, getItem, synCfg);
    // 각 숫돌 base 1, 같은 행 1개 정렬 → ×2 → 2+2 = 4
    expect(s.scorePerLvSum).toBeCloseTo(4, 5);
  });

  it('isolation: 저주는 돌출 단독 격리 시 보너스, 아니면 패널티', () => {
    const bpIso = defaultBackpack();
    bpIso.items = [{ itemId: 'bloodthirst-curse', origin: { x: 2, y: 4 }, rotation: 0 }] as PlacedItem[];
    expect(computeSynergy(bpIso, getItem, synCfg).isolationBonus).toBeCloseTo(0.25, 5);

    const bpBad = defaultBackpack();
    bpBad.items = [{ itemId: 'bloodthirst-curse', origin: { x: 2, y: 2 }, rotation: 0 }] as PlacedItem[];
    expect(computeSynergy(bpBad, getItem, synCfg).isolationBonus).toBeCloseTo(-synCfg.isolationPenalty, 5);
  });

  it('방어구는 misclickGuard 제공(생존 흡수 아님)', () => {
    const bp = defaultBackpack();
    bp.items = [{ itemId: 'gauntlet-guard', origin: { x: 1, y: 1 }, rotation: 0 }] as PlacedItem[];
    expect(computeSynergy(bp, getItem, synCfg).misclickGuards).toBe(1);
  });

  it('헌법: SynergyResult 에 트랙 A(생존) 출력 필드가 존재하지 않는다', () => {
    const s = computeSynergy(defaultBackpack(), getItem, synCfg);
    const keys = Object.keys(s);
    for (const forbidden of ['hp', 'heal', 'revive', 'absorb', 'vitality', 'maxHp']) {
      expect(keys).not.toContain(forbidden);
    }
  });
});
