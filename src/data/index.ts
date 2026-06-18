/**
 * 데이터 로더: JSON(엑셀 대용 — 코드 수정 없이 튜닝, 기획서 §9.3)을 타입 객체로 변환.
 * 색상 "#rrggbb" → number, shape Vec2[] → GridShape 로 정규화.
 */
import type { ItemDef, MonsterDef, Vec2 } from '../core/types';
import balanceJson from './balance.json';
import monstersJson from './monsters.json';
import itemsJson from './items.json';

function hexToNum(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

interface RawMonster extends Omit<MonsterDef, 'color'> {
  color: string;
}
interface RawItem extends Omit<ItemDef, 'color' | 'shape'> {
  color: string;
  shape: Vec2[];
}

export const balance = balanceJson;
export type Balance = typeof balanceJson;

export const MONSTERS: MonsterDef[] = (monstersJson as RawMonster[]).map((m) => ({
  ...m,
  color: hexToNum(m.color),
}));

export const ITEMS: ItemDef[] = (itemsJson as RawItem[]).map((it) => ({
  ...it,
  color: hexToNum(it.color),
  shape: { cells: it.shape },
}));

const monsterById = new Map(MONSTERS.map((m) => [m.id, m]));
const itemById = new Map(ITEMS.map((it) => [it.id, it]));

export function getMonster(id: string): MonsterDef {
  const m = monsterById.get(id);
  if (!m) throw new Error(`알 수 없는 몬스터 id: ${id}`);
  return m;
}

export function getItem(id: string): ItemDef {
  const it = itemById.get(id);
  if (!it) throw new Error(`알 수 없는 아이템 id: ${id}`);
  return it;
}

/** 드롭/상점 풀(시작 기본 아이템 제외 — 기획서 §6.4). */
export const ITEM_POOL: ItemDef[] = ITEMS.filter((it) => !it.starter);

/** 시작 기본 보유 아이템(분해 렌즈 등). */
export const STARTER_ITEMS: ItemDef[] = ITEMS.filter((it) => it.starter);
