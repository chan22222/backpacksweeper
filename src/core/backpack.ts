/**
 * 가방 시스템 (순수 TS) — 기획서 §4, §5.
 *
 * 헌법: 시너지는 오직 트랙 B(골드·점수)와 정보·실수방지에만 작용한다.
 * 트랙 A(생존)에 영향을 주는 출력 필드 자체가 존재하지 않는다.
 * 시너지 축은 line / void / isolation 3개로 한정(곱연산·체인 금지, 선형만).
 */
import type { BackpackCell, BackpackState, ItemDef, PlacedItem, Vec2 } from './types';

export type GetItem = (id: string) => ItemDef;

/** ASCII 레이아웃으로 가방 생성. X=활성, P=돌출 격리 슬롯(활성), .=비활성. */
export function createBackpackFromLayout(rows: string[]): BackpackState {
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const cells: BackpackCell[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = rows[y][x] ?? '.';
      cells.push({
        pos: { x, y },
        active: ch === 'X' || ch === 'P',
        protruding: ch === 'P',
      });
    }
  }
  return { width, height, cells, items: [] };
}

export function defaultBackpack(): BackpackState {
  // 기획서 §5.6 배치도(돌출 격리 슬롯 포함).
  return createBackpackFromLayout([
    '.XXX.',
    'XXXXX',
    'XXXXX',
    '.XXX.',
    '..P..',
  ]);
}

export function bpCell(bp: BackpackState, x: number, y: number): BackpackCell | undefined {
  if (x < 0 || y < 0 || x >= bp.width || y >= bp.height) return undefined;
  return bp.cells[y * bp.width + x];
}

/** 회전(0/1/2/3 = 0/90/180/270 cw)을 적용한 형태 셀(0,0 정규화). */
export function rotatedCells(item: ItemDef, rotation: number): Vec2[] {
  let cells = item.shape.cells.map((c) => ({ ...c }));
  const times = ((rotation % 4) + 4) % 4;
  for (let t = 0; t < times; t++) {
    cells = cells.map((c) => ({ x: -c.y, y: c.x }));
  }
  const minX = Math.min(...cells.map((c) => c.x));
  const minY = Math.min(...cells.map((c) => c.y));
  return cells.map((c) => ({ x: c.x - minX, y: c.y - minY }));
}

/** 배치된 아이템의 절대 점유 좌표. */
export function absoluteCells(_bp: BackpackState, placed: PlacedItem, getItem: GetItem): Vec2[] {
  const def = getItem(placed.itemId);
  return rotatedCells(def, placed.rotation).map((c) => ({
    x: placed.origin.x + c.x,
    y: placed.origin.y + c.y,
  }));
}

function keyOf(p: Vec2): string {
  return `${p.x},${p.y}`;
}

/** 점유된 좌표 집합(특정 아이템 제외 가능). */
export function occupiedSet(bp: BackpackState, getItem: GetItem, excludeIndex = -1): Set<string> {
  const set = new Set<string>();
  bp.items.forEach((pl, i) => {
    if (i === excludeIndex) return;
    for (const c of absoluteCells(bp, pl, getItem)) set.add(keyOf(c));
  });
  return set;
}

/** 배치 가능 여부: 모든 칸이 활성·범위 내·미점유. */
export function canPlace(
  bp: BackpackState,
  item: ItemDef,
  origin: Vec2,
  rotation: number,
  getItem: GetItem,
  excludeIndex = -1,
): boolean {
  const occupied = occupiedSet(bp, getItem, excludeIndex);
  const cells = rotatedCells(item, rotation);
  for (const c of cells) {
    const ax = origin.x + c.x;
    const ay = origin.y + c.y;
    const cell = bpCell(bp, ax, ay);
    if (!cell || !cell.active) return false;
    if (occupied.has(keyOf({ x: ax, y: ay }))) return false;
  }
  return true;
}

/** 첫 배치 가능 위치를 찾아 자동 배치(캠프 자동 정리/초기 장착용). */
export function autoPlace(bp: BackpackState, item: ItemDef, getItem: GetItem): boolean {
  for (let y = 0; y < bp.height; y++) {
    for (let x = 0; x < bp.width; x++) {
      for (let r = 0 as 0 | 1 | 2 | 3; r < 4; r++) {
        if (canPlace(bp, item, { x, y }, r, getItem)) {
          bp.items.push({ itemId: item.id, origin: { x, y }, rotation: r as 0 | 1 | 2 | 3 });
          return true;
        }
      }
    }
  }
  return false;
}

// ----------------------------- 시너지 -----------------------------

export interface SynergyResult {
  goldRateSum: number; // 골드 환율 가산(트랙 B)
  goldLvScaleSum: number; // +값×Lv 골드(트랙 B)
  scorePerLvSum: number; // 점수/Lv 가산(트랙 B)
  voidScoreFlat: number; // 처치당 고정 점수(void 축, 트랙 B)
  isolationBonus: number; // 점수 배율 가산(±)
  misclickGuards: number; // 실수 방지(방어구)
  sculptBonus: number; // 캠프 신규 칸 +N(특수)
}

export interface SynergyConfig {
  lineBonusPerAligned: number;
  isolationPenalty: number;
}

/** 같은 line(행/열) 정렬 이웃 아이템 수(자기 제외). */
function alignedCount(
  bp: BackpackState,
  selfIndex: number,
  selfCells: Vec2[],
  dir: 'row' | 'col',
  getItem: GetItem,
): number {
  const lines = new Set(selfCells.map((c) => (dir === 'row' ? c.y : c.x)));
  let count = 0;
  bp.items.forEach((pl, i) => {
    if (i === selfIndex) return;
    const cells = absoluteCells(bp, pl, getItem);
    if (cells.some((c) => lines.has(dir === 'row' ? c.y : c.x))) count++;
  });
  return count;
}

/** 아이템 셀에 직교 인접한 '빈 활성 칸' 수(void 축). */
function adjacentVoid(bp: BackpackState, cells: Vec2[], occupied: Set<string>): number {
  const cellSet = new Set(cells.map(keyOf));
  const counted = new Set<string>();
  let voids = 0;
  const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
  for (const c of cells) {
    for (const d of dirs) {
      const p = { x: c.x + d.x, y: c.y + d.y };
      const k = keyOf(p);
      if (cellSet.has(k) || counted.has(k)) continue;
      const cell = bpCell(bp, p.x, p.y);
      if (cell && cell.active && !occupied.has(k)) {
        voids++;
        counted.add(k);
      }
    }
  }
  return voids;
}

/** 돌출 슬롯에 단독 격리되었는가(직교 이웃 아이템 없음 + 돌출 칸 점유). */
function isIsolated(bp: BackpackState, selfIndex: number, cells: Vec2[], getItem: GetItem): boolean {
  const onProtruding = cells.some((c) => bpCell(bp, c.x, c.y)?.protruding);
  if (!onProtruding) return false;
  const others = occupiedSet(bp, getItem, selfIndex);
  const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
  for (const c of cells) {
    for (const d of dirs) {
      if (others.has(keyOf({ x: c.x + d.x, y: c.y + d.y }))) return false;
    }
  }
  return true;
}

export function computeSynergy(bp: BackpackState, getItem: GetItem, cfg: SynergyConfig): SynergyResult {
  const res: SynergyResult = {
    goldRateSum: 0,
    goldLvScaleSum: 0,
    scorePerLvSum: 0,
    voidScoreFlat: 0,
    isolationBonus: 0,
    misclickGuards: 0,
    sculptBonus: 0,
  };

  bp.items.forEach((pl, i) => {
    const def = getItem(pl.itemId);
    const cells = absoluteCells(bp, pl, getItem);

    // line 축 배율(선형, 자기 본인 보너스에만 적용 — 체인 없음)
    let lineFactor = 1;
    if (def.synergyAxis === 'line' && def.lineDir) {
      const aligned = alignedCount(bp, i, cells, def.lineDir, getItem);
      lineFactor = 1 + cfg.lineBonusPerAligned * aligned;
    }

    res.goldRateSum += (def.goldRateBonus ?? 0) * lineFactor;
    res.goldLvScaleSum += (def.goldLvScale ?? 0) * lineFactor;
    res.scorePerLvSum += (def.scorePerLvBonus ?? 0) * lineFactor;

    if (def.synergyAxis === 'void' && def.scorePerVoidBonus) {
      const occupied = occupiedSet(bp, getItem, i);
      res.voidScoreFlat += def.scorePerVoidBonus * adjacentVoid(bp, cells, occupied);
    }

    if (def.synergyAxis === 'isolation') {
      const iso = isIsolated(bp, i, cells, getItem);
      if (def.isolationScoreBonus) {
        res.isolationBonus += iso ? def.isolationScoreBonus : -cfg.isolationPenalty;
      }
      if (def.misclickGuard) res.misclickGuards += iso ? 2 : 1;
    } else if (def.misclickGuard) {
      res.misclickGuards += 1;
    }

    res.sculptBonus += def.sculptBonus ?? 0;
  });

  return res;
}
