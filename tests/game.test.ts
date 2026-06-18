import { describe, it, expect } from 'vitest';
import { Game } from '../src/core/game';
import { autoPlace } from '../src/core/backpack';
import { getItem } from '../src/data';
import type { Vec2 } from '../src/core/types';

function findAliveMonster(g: Game, id: string): Vec2 | null {
  for (const c of g.state.board) {
    if (c.content === 'monster' && c.monsterId === id && !c.dead) return c.pos;
  }
  return null;
}

function firstHiddenEmpty(g: Game): Vec2 {
  for (const c of g.state.board) {
    if (c.content === 'empty' && !c.gem && !c.revealed) return c.pos;
  }
  return { x: 0, y: 0 };
}

describe('게임 통합 (코어 루프 — 보석 정찰)', () => {
  it('초기화: 풀피, 드래곤 + 시작 보석 1개만 발견', () => {
    const g = new Game(2024);
    expect(g.state.phase).toBe('playing');
    expect(g.state.hp).toBe(g.state.maxHp);
    expect(g.state.hp).toBe(5);
    // 드래곤 + 시작 보석 1개
    const revealed = g.state.board.filter((c) => c.revealed);
    expect(revealed.length).toBe(2);
    // 보석은 처음 1개만 발견(visible)
    const visibleGems = g.state.board.filter((c) => c.gem && c.revealed);
    expect(visibleGems.length).toBe(1);
  });

  it('발견된 보석 클릭 → 주변 원형 공개(HP 소모 없는 정찰, 몬스터는 살아있음)', () => {
    const g = new Game(2024);
    const gem = g.state.board.find((c) => c.gem && c.revealed)!;
    const before = g.state.hp;
    const r = g.click(gem.pos.x, gem.pos.y);
    expect(r.kind).toBe('revealed');
    if (r.kind === 'revealed') expect(r.cells.length).toBeGreaterThan(1);
    expect(g.state.hp).toBe(before);
    const revealedMonsters = g.state.board.filter(
      (c) => c.revealed && c.content === 'monster' && c.monsterId !== 'dragon',
    );
    expect(revealedMonsters.every((c) => !c.dead)).toBe(true);
  });

  it('빈 칸 클릭은 확장 없이 그 칸만 공개, 재클릭은 noop', () => {
    const g = new Game(2024);
    const e = firstHiddenEmpty(g);
    const r = g.click(e.x, e.y);
    expect(r.kind).toBe('revealed');
    if (r.kind === 'revealed') expect(r.cells.length).toBe(1);
    expect(g.click(e.x, e.y).kind).toBe('noop');
  });

  it('안전망 ②-1(게임 레벨): 트랙 A는 가방과 무관, 트랙 B만 가방이 증폭', () => {
    const seed = 31337;
    const g1 = new Game(seed);
    const g2 = new Game(seed);
    autoPlace(g2.state.backpack, getItem('whetstone-ring'), getItem);
    g2.refreshGuards();

    // 첫 숨김칸 공개로 firstClick 소비(동일 위치)
    const e1 = firstHiddenEmpty(g1);
    g1.click(e1.x, e1.y);
    g2.click(e1.x, e1.y);
    const bat = findAliveMonster(g1, 'bat');
    expect(bat).not.toBeNull();
    // 1클릭: 처치(HP 지불, 보상 없음) → 2클릭: 수확(경험치/점수)
    const d1 = g1.click(bat!.x, bat!.y);
    g2.click(bat!.x, bat!.y);
    expect(d1.kind).toBe('defeat');
    expect(g1.state.vitality).toBe(0); // 처치만으론 경험치 0
    g1.click(bat!.x, bat!.y); // 수확
    g2.click(bat!.x, bat!.y);

    expect(g1.state.vitality).toBe(g2.state.vitality); // 트랙 A는 가방 무관
    expect(g1.state.vitality).toBeGreaterThan(0);
    expect(g2.state.score).toBeGreaterThan(g1.state.score); // 트랙 B는 가방이 증폭
  });

  it('수동 레벨업: 성장 충전 후 유저가 직접 레벨업 → 완전 회복 + 최대 HP 증가 (자동 아님)', () => {
    const g = new Game(2024);
    const e = firstHiddenEmpty(g);
    g.click(e.x, e.y); // 첫 숨김칸 공개로 firstClick 소비

    // 박쥐를 처치+수확해 성장 누적 — 자동 레벨업이 일어나지 않는다.
    for (let i = 0; i < 60 && !g.canLevelUp(); i++) {
      const phase: string = g.state.phase;
      if (phase === 'full-camp') {
        g.closeCamp();
        continue;
      }
      if (phase !== 'playing') break;
      const bat = findAliveMonster(g, 'bat');
      if (!bat) break;
      const beforeLevel = g.state.level;
      g.click(bat.x, bat.y); // 처치
      if ((g.state.phase as string) === 'full-camp') g.closeCamp();
      g.click(bat.x, bat.y); // 수확(경험치)
      // 전투/수확만으로는 절대 레벨이 오르지 않는다(수동)
      expect(g.state.level).toBe(beforeLevel);
    }

    expect(g.canLevelUp()).toBe(true);
    const beforeLevel = g.state.level;
    const beforeMax = g.state.maxHp;
    const r = g.levelUp();
    expect(r).not.toBeNull();
    expect(g.state.level).toBe(beforeLevel + 1);
    expect(g.state.maxHp).toBe(beforeMax + 1);
    expect(g.state.hp).toBe(g.state.maxHp); // 완전 회복
  });

  it('HP는 0에서 생존, 음수가 되면 사망', () => {
    const g = new Game(7);
    const e = firstHiddenEmpty(g);
    g.click(e.x, e.y); // firstClick 소비(이후 직격은 이주되지 않음)
    g.state.hp = 4;
    const garg = findAliveMonster(g, 'gargoyle');
    expect(garg).not.toBeNull();
    const r = g.click(garg!.x, garg!.y); // Lv4 직격(처치) → HP 4-4=0
    expect(r.kind).toBe('defeat');
    expect(g.state.hp).toBe(0);
    expect(g.state.phase).not.toBe('lost'); // 0은 생존
  });
});
