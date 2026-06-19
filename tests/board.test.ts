import { describe, it, expect } from 'vitest';
import { generateBoard, idx, neighbors8, type BoardConfig } from '../src/core/board';
import { MONSTERS, getMonster } from '../src/data';

const cfg: BoardConfig = {
  width: 11,
  height: 13,
  zoneCount: 3,
  gemCount: 1,
  extraGemCount: 0,
  lifeCount: 9,
  treasureCount: 5,
  rerollCount: 3,
  gemBorderMargin: 2,
  gemRadius: 2.0,
};

describe('보드 생성 (기획서 §2.1)', () => {
  it('소환술사를 제외한 몹 데미지(레벨)는 고유하다 — 숫자=정체 추리가 성립', () => {
    // 소환술사(ogre)는 의도적으로 거미(D3)와 같은 값으로 위장하고, 슬라임 군집+? 안개로 정체를 드러낸다.
    const levels = MONSTERS.filter((m) => m.id !== 'ogre').map((m) => m.level);
    expect(new Set(levels).size).toBe(levels.length);
  });

  it('결정론: 같은 시드 → 같은 보드', () => {
    const a = generateBoard(12345, cfg, MONSTERS);
    const b = generateBoard(12345, cfg, MONSTERS);
    expect(a.board.map((c) => c.content + (c.monsterId ?? ''))).toEqual(
      b.board.map((c) => c.content + (c.monsterId ?? '')),
    );
  });

  it('핵심 규칙: 빈 칸 숫자 = 인접 8칸 몬스터 레벨의 총합', () => {
    const { board } = generateBoard(777, cfg, MONSTERS);
    for (const cell of board) {
      if (cell.content !== 'empty') continue;
      let sum = 0;
      for (const nb of neighbors8(cell.pos.x, cell.pos.y, cfg.width, cfg.height)) {
        const n = board[idx(nb.x, nb.y, cfg.width)];
        if (n.content === 'monster') sum += getMonster(n.monsterId!).level;
      }
      expect(cell.adjacencySum).toBe(sum);
    }
  });

  it('드래곤은 중앙 고정 + 처음부터 공개', () => {
    const { board } = generateBoard(42, cfg, MONSTERS);
    const cx = Math.floor(cfg.width / 2);
    const cy = Math.floor(cfg.height / 2);
    const center = board[idx(cx, cy, cfg.width)];
    expect(center.content).toBe('monster');
    expect(center.monsterId).toBe('dragon');
    expect(center.preRevealed).toBe(true);
    expect(center.revealed).toBe(true);
  });

  it('보석은 벽에서 2칸 이상 떨어진 내부 빈 칸에만 배치된다(시작+추가)', () => {
    for (const seed of [7, 42, 100, 2024]) {
      const { board } = generateBoard(seed, cfg, MONSTERS);
      const gems = board.filter((c) => c.pickup === 'gem');
      expect(gems.length).toBe(cfg.gemCount + cfg.extraGemCount);
      for (const g of gems) {
        expect(g.content).toBe('empty');
        expect(g.pos.x).toBeGreaterThanOrEqual(2);
        expect(g.pos.x).toBeLessThanOrEqual(cfg.width - 3);
        expect(g.pos.y).toBeGreaterThanOrEqual(2);
        expect(g.pos.y).toBeLessThanOrEqual(cfg.height - 3);
      }
    }
  });

  it('라이프·보물상자 픽업이 빈 칸에 배치되고, 같은 종류끼리 인접(8방향)하지 않는다', () => {
    for (const seed of [7, 42, 100, 2024, 555]) {
      const { board } = generateBoard(seed, cfg, MONSTERS);
      const life = board.filter((c) => c.pickup === 'life');
      const treasure = board.filter((c) => c.pickup === 'treasure');
      expect(life.length).toBe(cfg.lifeCount);
      expect(treasure.length).toBe(cfg.treasureCount);
      for (const c of [...life, ...treasure]) expect(c.content).toBe('empty');

      // 같은 종류 픽업끼리 8방향 인접 없음
      const noAdjacent = (type: string) => {
        for (const c of board) {
          if (c.pickup !== type) continue;
          for (const nb of neighbors8(c.pos.x, c.pos.y, cfg.width, cfg.height)) {
            expect(board[idx(nb.x, nb.y, cfg.width)].pickup).not.toBe(type);
          }
        }
      };
      noAdjacent('gem');
      noAdjacent('life');
      noAdjacent('treasure');
    }
  });

  it('쥐는 쥐왕의 열을 바라본다(방향 단서)', () => {
    const { board, ratKingColumn } = generateBoard(2024, cfg, MONSTERS);
    if (ratKingColumn === null) return;
    for (const cell of board) {
      if (cell.monsterId === 'rat') expect(cell.facesColumn).toBe(ratKingColumn);
    }
  });

  it('보드는 승리 가능: 처치 가능 레벨 총합이 ~L12 도달치(209) 이상', () => {
    const { board } = generateBoard(555, cfg, MONSTERS);
    let total = 0;
    for (const cell of board) {
      if (cell.content === 'monster' && cell.monsterId !== 'dragon') {
        total += getMonster(cell.monsterId!).level;
      }
    }
    expect(total).toBeGreaterThanOrEqual(209);
  });
});
