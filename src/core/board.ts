/**
 * 보드 생성 + 격자 헬퍼 (순수 TS).
 * 핵심 규칙(기획서 §2.1): 빈 칸의 표시 숫자 = 인접 8칸 몬스터 레벨의 총합.
 *
 * MVP 안전 시작 보장(기획서 §6.4 일부): 시작 칸 + 8 이웃을 몬스터 free 로 예약 →
 * 첫 클릭이 항상 0-숫자 칸이 되어 플러드 오프닝이 열린다(추측 도박 방지의 1차선).
 * (3칸 동시연립·체인 깊이 4 의 완전 Human-Solvable 솔버는 후속 과제로 명시.)
 */
import type { Cell, MonsterDef, PickupType, Vec2 } from './types';

export interface BoardConfig {
  width: number;
  height: number;
  zoneCount: number;
  gemCount: number;
  /** 무작위 위치에 추가로 생성되는 숨김 보석 수. */
  extraGemCount: number;
  /** 라이프(하트) 픽업 수. */
  lifeCount: number;
  /** 보물상자 픽업 수. */
  treasureCount: number;
  /** 상점 새로고침(리롤) 픽업 수. */
  rerollCount: number;
  /** 보석을 벽에서 최소 몇 칸 떨어뜨릴지(정찰 원이 보드 안에 다 들어오게). */
  gemBorderMargin: number;
  /** 보석 정찰 반경(약한 몹 구역 선정에 사용). */
  gemRadius: number;
}

export function idx(x: number, y: number, w: number): number {
  return y * w + x;
}

export function inBounds(x: number, y: number, w: number, h: number): boolean {
  return x >= 0 && y >= 0 && x < w && y < h;
}

const DIRS8: Vec2[] = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
  { x: -1, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 },
];

const DIRS4: Vec2[] = [
  { x: 0, y: -1 }, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 },
];

export function neighbors8(x: number, y: number, w: number, h: number): Vec2[] {
  const out: Vec2[] = [];
  for (const d of DIRS8) {
    const nx = x + d.x;
    const ny = y + d.y;
    if (inBounds(nx, ny, w, h)) out.push({ x: nx, y: ny });
  }
  return out;
}

export function neighbors4(x: number, y: number, w: number, h: number): Vec2[] {
  const out: Vec2[] = [];
  for (const d of DIRS4) {
    const nx = x + d.x;
    const ny = y + d.y;
    if (inBounds(nx, ny, w, h)) out.push({ x: nx, y: ny });
  }
  return out;
}

export function zoneOf(x: number, cfg: BoardConfig): number {
  const band = cfg.width / cfg.zoneCount;
  return Math.min(cfg.zoneCount - 1, Math.floor(x / band));
}

export interface GeneratedBoard {
  board: Cell[];
  ratKingColumn: number | null;
}

/**
 * 인접 8칸의 '살아있는' 몬스터 레벨 총합을 모든 칸에 (재)계산.
 * 처치(dead)된 몬스터는 합산에서 빠지므로, 몹을 잡을수록 주변 숫자가 줄어든다.
 * 처치된 칸도 자기 주변의 남은 몹 수를 보여주기 위해 모든 칸을 계산한다.
 */
export function computeAdjacencySums(board: Cell[], w: number, h: number, monsters: MonsterDef[]): void {
  const byId = new Map(monsters.map((m) => [m.id, m]));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = board[idx(x, y, w)];
      let sum = 0;
      for (const nb of neighbors8(x, y, w, h)) {
        const n = board[idx(nb.x, nb.y, w)];
        if (n.content === 'monster' && !n.dead) {
          const m = byId.get(n.monsterId!);
          if (m?.contributesToSum) sum += m.level;
        }
      }
      c.adjacencySum = sum;
    }
  }
}

import { Rng } from './rng';

export function generateBoard(
  seed: number,
  cfg: BoardConfig,
  monsters: MonsterDef[],
): GeneratedBoard {
  const { width: w, height: h } = cfg;
  const rng = new Rng(seed);

  const board: Cell[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      board.push({
        pos: { x, y },
        content: 'empty',
        adjacencySum: 0,
        revealed: false,
        preRevealed: false,
        zone: zoneOf(x, cfg),
      });
    }
  }

  const at = (x: number, y: number) => board[idx(x, y, w)];

  // 1) 드래곤 중앙 고정 + 공개
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const dragon = monsters.find((m) => m.placement === 'center-revealed');
  const dragonIdx = idx(cx, cy, w);
  if (dragon) {
    board[dragonIdx].content = 'monster';
    board[dragonIdx].monsterId = dragon.id;
    board[dragonIdx].preRevealed = true;
    board[dragonIdx].revealed = true;
  }

  // 2) 안전 시작 영역은 예약하지 않는다. 첫 클릭 시 그 자리 주변 몬스터를 이주시켜
  //    "플레이어가 처음 누른 곳"에서 오브처럼 펼쳐지게 한다(Game.ensureSafeStart).
  const isFree = (x: number, y: number): boolean => {
    const i = idx(x, y, w);
    return board[i].content === 'empty' && i !== dragonIdx;
  };

  const place = (x: number, y: number, monsterId: string) => {
    const c = at(x, y);
    c.content = 'monster';
    c.monsterId = monsterId;
  };

  // 무작위 free 칸 목록(셔플)
  const freeCells = (): Vec2[] => {
    const list: Vec2[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (isFree(x, y)) list.push({ x, y });
      }
    }
    return rng.shuffle(list);
  };

  // ── 몹 배치: 기믹별 다단계 패스 ──
  let ratKingColumn: number | null = null;
  const anchorPos: Record<string, Vec2[]> = {};

  // 패스 1: 앵커 (column-anchor=쥐왕, surround-anchor=오우거)
  for (const m of monsters.filter((mm) => mm.placement === 'column-anchor' || mm.placement === 'surround-anchor')) {
    anchorPos[m.id] = [];
    for (let n = 0; n < m.budget; n++) {
      const cells = freeCells();
      if (cells.length === 0) break;
      const c = cells[0];
      place(c.x, c.y, m.id);
      anchorPos[m.id].push(c);
      if (m.placement === 'column-anchor') ratKingColumn = c.x;
    }
  }

  // 패스 2a: faces-anchor (쥐 → 앵커의 열을 바라봄)
  for (const m of monsters.filter((mm) => mm.placement === 'faces-anchor')) {
    const list = m.anchor ? anchorPos[m.anchor] : undefined;
    const col = list && list.length > 0 ? list[0].x : ratKingColumn;
    for (let n = 0; n < m.budget; n++) {
      const cells = freeCells();
      if (cells.length === 0) break;
      place(cells[0].x, cells[0].y, m.id);
      if (col !== null) at(cells[0].x, cells[0].y).facesColumn = col;
    }
  }

  // 패스 2b: surround-satellite (슬라임 → 오우거를 둘러쌈)
  for (const m of monsters.filter((mm) => mm.placement === 'surround-satellite')) {
    let remaining = m.budget;
    const anchors = (m.anchor ? anchorPos[m.anchor] : undefined) ?? [];
    for (const a of anchors) {
      if (remaining <= 0) break;
      const ring = rng.shuffle(neighbors8(a.x, a.y, w, h).filter((p) => isFree(p.x, p.y)));
      for (const p of ring) {
        if (remaining <= 0) break;
        place(p.x, p.y, m.id);
        remaining--;
      }
    }
    while (remaining > 0) {
      const cells = freeCells();
      if (cells.length === 0) break;
      place(cells[0].x, cells[0].y, m.id);
      remaining--;
    }
  }

  // 패스 3: pair (가고일 — 가로/세로 인접 쌍)
  for (const m of monsters.filter((mm) => mm.placement === 'pair')) {
    for (let n = 0; n < m.budget; n++) {
      const cells = freeCells();
      let placed = false;
      for (const c of cells) {
        const adj = neighbors4(c.x, c.y, w, h).filter((p) => isFree(p.x, p.y));
        if (adj.length > 0) {
          const partner = rng.pick(adj);
          place(c.x, c.y, m.id);
          place(partner.x, partner.y, m.id);
          placed = true;
          break;
        }
      }
      if (!placed) break;
    }
  }

  // 패스 4: swarm (박쥐 — 무리 군집)
  for (const m of monsters.filter((mm) => mm.placement === 'swarm')) {
    let remaining = m.budget;
    while (remaining > 0) {
      const seeds = freeCells();
      if (seeds.length === 0) break;
      const seed = seeds[0];
      place(seed.x, seed.y, m.id);
      remaining--;
      const ring = rng.shuffle(neighbors8(seed.x, seed.y, w, h).filter((p) => isFree(p.x, p.y)));
      for (const p of ring) {
        if (remaining <= 0) break;
        if (rng.chance(0.7)) {
          place(p.x, p.y, m.id);
          remaining--;
        }
      }
    }
  }

  // 패스 5: edge (망령 — 보드 가장자리)
  for (const m of monsters.filter((mm) => mm.placement === 'edge')) {
    for (let n = 0; n < m.budget; n++) {
      const free = freeCells();
      if (free.length === 0) break;
      const edges = free.filter((p) => p.x === 0 || p.y === 0 || p.x === w - 1 || p.y === h - 1);
      const t = edges.length > 0 ? edges[0] : free[0];
      place(t.x, t.y, m.id);
    }
  }

  // 패스 6: lonely (가저 — 인접에 몹이 없는 외딴 자리)
  for (const m of monsters.filter((mm) => mm.placement === 'lonely')) {
    for (let n = 0; n < m.budget; n++) {
      const free = freeCells();
      if (free.length === 0) break;
      const isolated = free.filter((p) =>
        neighbors8(p.x, p.y, w, h).every((q) => at(q.x, q.y).content !== 'monster'),
      );
      const t = isolated.length > 0 ? isolated[0] : free[0];
      place(t.x, t.y, m.id);
    }
  }

  // 패스 7: deep (리치 — 중앙 구역 깊은 곳)
  const midZone = Math.floor(cfg.zoneCount / 2);
  for (const m of monsters.filter((mm) => mm.placement === 'deep')) {
    for (let n = 0; n < m.budget; n++) {
      const free = freeCells();
      if (free.length === 0) break;
      const deep = free.filter((p) => zoneOf(p.x, cfg) === midZone);
      const t = deep.length > 0 ? deep[0] : free[0];
      place(t.x, t.y, m.id);
    }
  }

  // 패스 8: scatter (나머지 — 거미/골렘/뱀파이어)
  for (const m of monsters.filter((mm) => mm.placement === 'scatter')) {
    for (let n = 0; n < m.budget; n++) {
      const cells = freeCells();
      if (cells.length === 0) break;
      place(cells[0].x, cells[0].y, m.id);
    }
  }

  // 7) 픽업 배치
  const margin = cfg.gemBorderMargin;
  const monById = new Map(monsters.map((mm) => [mm.id, mm]));
  const r2 = cfg.gemRadius * cfg.gemRadius;

  // 같은 종류 픽업이 인접(8방향)해 있으면 배치 금지(서로 붙지 않게).
  const adjacentToType = (i: number, type: PickupType): boolean => {
    const p = board[i].pos;
    return neighbors8(p.x, p.y, w, h).some((nb) => board[idx(nb.x, nb.y, w)].pickup === type);
  };

  // 7a) 하트/보물 먼저 — 무작위 빈 칸(같은 종류끼리 인접 금지), 숨김.
  const anyEmpty: number[] = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i].content === 'empty' && i !== dragonIdx) anyEmpty.push(i);
  }
  rng.shuffle(anyEmpty);
  const placePickup = (count: number, type: PickupType) => {
    let placed = 0;
    for (let k = 0; k < anyEmpty.length && placed < count; k++) {
      const i = anyEmpty[k];
      if (board[i].pickup || adjacentToType(i, type)) continue;
      board[i].pickup = type;
      placed++;
    }
  };
  placePickup(cfg.lifeCount, 'life');
  placePickup(cfg.treasureCount, 'treasure');
  placePickup(cfg.rerollCount, 'reroll');

  // 7b) 영역 점수: 정찰 반경 내 '하트/보물/쥐왕'을 우선 회피, 그다음 '약한 몹'.
  const areaScore = (cx: number, cy: number): number => {
    let maxLv = 0;
    let sum = 0;
    let avoid = 0; // 하트/보물/쥐왕 = 시작 구역에서 피하고 싶은 것
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const dx = xx - cx;
        const dy = yy - cy;
        if (dx * dx + dy * dy > r2) continue;
        const nc = board[idx(xx, yy, w)];
        if (nc.content === 'monster') {
          const m = monById.get(nc.monsterId!);
          const lv = m?.level ?? 0;
          maxLv = Math.max(maxLv, lv);
          sum += lv;
          if (m?.placement === 'column-anchor') avoid++; // 쥐왕 회피
        } else if (nc.pickup === 'life' || nc.pickup === 'treasure' || nc.pickup === 'reroll') {
          avoid++;
        }
      }
    }
    // 회피 대상(하트/보물/쥐왕)이 0순위 → 그다음 가장 센 몹(최대 레벨)·합.
    return avoid * 100000 + maxLv * 1000 + sum;
  };

  // 7c) 시작 보석: 벽에서 margin 떨어진 내부 빈(픽업 아닌) 칸 중,
  //     점수가 가장 낮은(= 하트/보물 적고 약한 몹) 자리에 배치하고 공개.
  const gemCandidates: number[] = [];
  for (let i = 0; i < board.length; i++) {
    const c = board[i];
    if (c.content !== 'empty' || i === dragonIdx || c.pickup) continue;
    if (c.pos.x < margin || c.pos.x > w - 1 - margin || c.pos.y < margin || c.pos.y > h - 1 - margin) continue;
    gemCandidates.push(i);
  }
  rng.shuffle(gemCandidates); // 동점 무작위
  gemCandidates.sort((a, b) => areaScore(board[a].pos.x, board[a].pos.y) - areaScore(board[b].pos.x, board[b].pos.y));

  let placedGems = 0;
  for (let k = 0; k < gemCandidates.length && placedGems < cfg.gemCount; k++) {
    const i = gemCandidates[k];
    if (board[i].pickup || adjacentToType(i, 'gem')) continue;
    board[i].pickup = 'gem';
    board[i].revealed = true;
    placedGems++;
  }

  // 7d) 추가 보석(있으면): 무작위 내부(픽업 아님·보석끼리 인접 금지), 숨김.
  const extraPool = rng.shuffle([...gemCandidates]);
  let placedExtra = 0;
  for (let k = 0; k < extraPool.length && placedExtra < cfg.extraGemCount; k++) {
    const i = extraPool[k];
    if (board[i].pickup || adjacentToType(i, 'gem')) continue;
    board[i].pickup = 'gem';
    placedExtra++;
  }

  // 8) 인접 숫자(레벨 총합) 계산
  computeAdjacencySums(board, w, h, monsters);

  return { board, ratKingColumn };
}
