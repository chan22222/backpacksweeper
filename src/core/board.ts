/**
 * 보드 생성 + 격자 헬퍼 (순수 TS).
 * 핵심 규칙(기획서 §2.1): 빈 칸의 표시 숫자 = 인접 8칸 몬스터 레벨의 총합.
 *
 * MVP 안전 시작 보장(기획서 §6.4 일부): 시작 칸 + 8 이웃을 몬스터 free 로 예약 →
 * 첫 클릭이 항상 0-숫자 칸이 되어 플러드 오프닝이 열린다(추측 도박 방지의 1차선).
 * (3칸 동시연립·체인 깊이 4 의 완전 Human-Solvable 솔버는 후속 과제로 명시.)
 */
import type { Cell, MonsterDef, Vec2 } from './types';

export interface BoardConfig {
  width: number;
  height: number;
  zoneCount: number;
  gemCount: number;
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

  // 3) 쥐왕(column-anchor) 먼저 배치 → 열 기록
  let ratKingColumn: number | null = null;
  const ratKing = monsters.find((m) => m.placement === 'column-anchor');
  if (ratKing) {
    for (let n = 0; n < ratKing.budget; n++) {
      const cells = freeCells();
      if (cells.length === 0) break;
      const c = cells[0];
      place(c.x, c.y, ratKing.id);
      ratKingColumn = c.x;
    }
  }

  // 4) 가고일(pair) 배치
  for (const m of monsters.filter((mm) => mm.placement === 'pair')) {
    for (let n = 0; n < m.budget; n++) {
      const cells = freeCells();
      let placed = false;
      for (const c of cells) {
        // 인접 free 칸이 있는 자리 찾기
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

  // 5) 쥐(faces-anchor) 배치 → 쥐왕 열을 바라봄
  for (const m of monsters.filter((mm) => mm.placement === 'faces-anchor')) {
    for (let n = 0; n < m.budget; n++) {
      const cells = freeCells();
      if (cells.length === 0) break;
      const c = cells[0];
      place(c.x, c.y, m.id);
      if (ratKingColumn !== null) at(c.x, c.y).facesColumn = ratKingColumn;
    }
  }

  // 6) 산포(scatter) 배치
  for (const m of monsters.filter((mm) => mm.placement === 'scatter')) {
    for (let n = 0; n < m.budget; n++) {
      const cells = freeCells();
      if (cells.length === 0) break;
      place(cells[0].x, cells[0].y, m.id);
    }
  }

  // 7) 보석 배치 — 벽에서 margin 칸 이상 떨어진 '내부' 빈 칸 중,
  //    정찰 반경 안의 몹이 '가장 약한'(레벨이 낮은) 자리에 우선 배치. 첫 정찰이 안전하도록.
  const margin = cfg.gemBorderMargin;
  const monById = new Map(monsters.map((mm) => [mm.id, mm]));
  const r2 = cfg.gemRadius * cfg.gemRadius;
  const areaStrength = (cx: number, cy: number): number => {
    let maxLv = 0;
    let sum = 0;
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const dx = xx - cx;
        const dy = yy - cy;
        if (dx * dx + dy * dy > r2) continue;
        const nc = board[idx(xx, yy, w)];
        if (nc.content === 'monster') {
          const lv = monById.get(nc.monsterId!)?.level ?? 0;
          maxLv = Math.max(maxLv, lv);
          sum += lv;
        }
      }
    }
    return maxLv * 1000 + sum; // 가장 센 몹(최대 레벨)이 지배, 합은 보조 기준
  };

  const interiorEmpty: number[] = [];
  for (let i = 0; i < board.length; i++) {
    const c = board[i];
    if (c.content !== 'empty' || i === dragonIdx) continue;
    if (c.pos.x < margin || c.pos.x > w - 1 - margin || c.pos.y < margin || c.pos.y > h - 1 - margin) continue;
    interiorEmpty.push(i);
  }
  rng.shuffle(interiorEmpty); // 동점 시 무작위
  interiorEmpty.sort((a, b) => areaStrength(board[a].pos.x, board[a].pos.y) - areaStrength(board[b].pos.x, board[b].pos.y));

  const gemsToPlace = Math.min(cfg.gemCount, interiorEmpty.length);
  for (let n = 0; n < gemsToPlace; n++) board[interiorEmpty[n]].gem = true;
  // 시작 보석 1개만 발견(visible) — 가장 약한 구역. 나머지는 정찰/공개로 번져나간다.
  if (gemsToPlace > 0) board[interiorEmpty[0]].revealed = true;

  // 8) 인접 숫자(레벨 총합) 계산
  computeAdjacencySums(board, w, h, monsters);

  return { board, ratKingColumn };
}
