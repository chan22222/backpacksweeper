/**
 * 게임 오케스트레이터 (순수 TS, Phaser 비의존).
 * 보드·자원·가방·진행을 묶어 코어 루프(읽기→추론→지불→정비)를 구현한다.
 * Phaser 씬은 이 클래스의 상태를 읽어 렌더링하고, 입력을 메서드로 전달만 한다.
 */
import { balance, MONSTERS, STARTER_ITEMS, getItem, getMonster } from '../data';
import { computeAdjacencySums, generateBoard, idx, type BoardConfig } from './board';
import {
  autoPlace,
  computeSynergy,
  defaultBackpack,
  type SynergyConfig,
  type SynergyResult,
} from './backpack';
import { levelUpCost, maxHpAt, resolvePayment, type EconomyConfig } from './payment';
import type { Cell, GameState, Vec2 } from './types';

const econ: EconomyConfig = balance.economy;
const synCfg: SynergyConfig = balance.synergy;
const boardCfg: BoardConfig = {
  width: balance.board.width,
  height: balance.board.height,
  zoneCount: balance.board.zoneCount,
  gemCount: balance.board.gemCount,
  extraGemCount: balance.board.extraGemCount,
  lifeCount: balance.board.lifeCount,
  treasureCount: balance.board.treasureCount,
  rerollCount: balance.board.rerollCount,
  gemBorderMargin: balance.board.gemBorderMargin,
  gemRadius: balance.board.gemRadius,
};
const GEM_RADIUS = balance.board.gemRadius;
const TREASURE_EXP = balance.board.treasureExp;

export type ClickResult =
  | { kind: 'noop' }
  | { kind: 'revealed'; cells: Vec2[] }
  | { kind: 'life'; pos: Vec2; heal: number }
  | { kind: 'treasure-open'; pos: Vec2; exp: number }
  | { kind: 'treasure'; pos: Vec2; exp: number }
  | { kind: 'reroll-open'; pos: Vec2 } // 1클릭: 두루마리 정체 공개
  | { kind: 'reroll'; pos: Vec2 } // 2클릭: 상점 새로고침 발동
  | { kind: 'guarded'; pos: Vec2 }
  | {
      // 1클릭: 처치(HP 지불). 몹 이미지·숫자는 시신으로 남고, 보상은 아직.
      kind: 'defeat';
      pos: Vec2;
      monsterId: string;
      hpCost: number;
      zoneCleared: number | null;
      killedDragon: boolean;
      died: boolean;
    }
  | {
      // 2클릭: 시신 수확(경험치/골드). 이때 숫자 칸으로 바뀐다.
      kind: 'collect';
      pos: Vec2;
      monsterId: string;
      vitality: number;
      gold: number;
    };

export interface LevelUpResult {
  level: number;
  maxHp: number;
  burstGold: number;
  sculptGained: number;
}

export class Game {
  state: GameState;
  ratKingColumn: number | null;
  readonly econ = econ;

  constructor(seed: number) {
    const gen = generateBoard(seed, boardCfg, MONSTERS);
    this.ratKingColumn = gen.ratKingColumn;

    const backpack = defaultBackpack();
    for (const it of STARTER_ITEMS) autoPlace(backpack, it, getItem);

    this.state = {
      board: gen.board,
      width: boardCfg.width,
      height: boardCfg.height,
      zoneCount: boardCfg.zoneCount,
      clearedZones: new Array(boardCfg.zoneCount).fill(false),
      hp: econ.startHp,
      maxHp: econ.startHp,
      level: 1,
      vitality: 0,
      vitalityForLevel: 0,
      gold: 0,
      hpSpentThisLevel: 0,
      backpack,
      phase: 'playing',
      pendingSculptCells: 0,
      misclickGuards: 0,
      turn: 0,
      log: [],
    };
    this.refreshGuards();
    // 초기 공개 없음 — 드래곤(중앙)만 보이고, 첫 클릭 위치에서 펼쳐진다.
  }

  // ---- 파생 정보 ----

  getSynergy(): SynergyResult {
    return computeSynergy(this.state.backpack, getItem, synCfg);
  }

  /** 캠프 진입/이탈 시 실수 방지(가드) 재충전. */
  refreshGuards(): void {
    this.state.misclickGuards = this.getSynergy().misclickGuards;
  }

  cellAt(x: number, y: number): Cell {
    return this.state.board[idx(x, y, this.state.width)];
  }

  levelUpCostNow(): number {
    return levelUpCost(this.state.level, econ);
  }

  // ---- 입력 ----

  /** 우클릭 메모: 미공개 칸에 추리용 숫자 표시(null이면 지움). */
  setNote(x: number, y: number, value: number | null): void {
    const c = this.cellAt(x, y);
    if (c.revealed) return;
    if (value === null) delete c.note;
    else c.note = value;
  }

  click(x: number, y: number): ClickResult {
    if (this.state.phase !== 'playing') return { kind: 'noop' };
    const c = this.cellAt(x, y);

    // 보물상자: 몹과 동일하게 '열기(1클릭) → 수확(2클릭)'. HP 비용은 없다.
    if (c.pickup === 'treasure' && !c.collected) {
      if (!c.dead) {
        c.revealed = true;
        c.dead = true; // 개봉됨(=시신과 동일한 수확 대기 상태)
        this.state.turn++;
        return { kind: 'treasure-open', pos: { x, y }, exp: TREASURE_EXP };
      }
      this.state.vitality += TREASURE_EXP;
      this.state.vitalityForLevel += TREASURE_EXP;
      c.collected = true;
      this.state.turn++;
      return { kind: 'treasure', pos: { x, y }, exp: TREASURE_EXP };
    }

    // 상점 새로고침 두루마리: 보물상자와 동일한 2단계(열기 → 발동). 효과는 씬이 처리.
    if (c.pickup === 'reroll' && !c.collected) {
      if (!c.dead) {
        c.revealed = true;
        c.dead = true; // 정체 공개(발동 대기)
        this.state.turn++;
        return { kind: 'reroll-open', pos: { x, y } };
      }
      c.collected = true;
      this.state.turn++;
      return { kind: 'reroll', pos: { x, y } };
    }

    // 발견된 보석/라이프 픽업(발견 후 1클릭 사용)
    if ((c.pickup === 'gem' || c.pickup === 'life') && !c.pickupUsed && c.revealed) {
      if (c.pickup === 'gem') {
        c.pickupUsed = true;
        this.state.turn++;
        // 주변 원형 공개(전투 없는 무료 정찰). 정찰 영역의 픽업/몹이 발견된다.
        return { kind: 'revealed', cells: this.revealArea(x, y) };
      }
      // 라이프: 풀피면 소비하지 않고 아껴둔다(무반응).
      if (this.state.hp >= this.state.maxHp) return { kind: 'noop' };
      c.pickupUsed = true;
      this.state.turn++;
      const heal = this.state.maxHp - this.state.hp;
      this.state.hp = this.state.maxHp; // 완전 회복
      return { kind: 'life', pos: { x, y }, heal };
    }

    // 공개된 처치 몬스터(미수확) → 2클릭: 경험치 수확
    if (c.revealed && c.content === 'monster' && c.dead && !c.collected) return this.collect(x, y, c);

    // 이미 공개된 빈 칸 / 수확 완료 → 무반응
    if (c.revealed && (c.content === 'empty' || c.collected)) return { kind: 'noop' };

    // 공개된 살아있는 몬스터 → 1클릭: 처치
    if (c.revealed && c.content === 'monster') return this.defeat(x, y, c);

    if (c.content === 'empty') {
      // 빈 칸은 그 칸만 공개(확장 없음). 주변 숫자는 절대 바뀌지 않는다.
      c.revealed = true;
      this.state.turn++;
      return { kind: 'revealed', cells: [{ x, y }] };
    }

    // 미공개 몬스터 클릭 = 공개 + 처치(HP 지불). 몹은 시신으로 남아 무엇인지 보인다.
    return this.defeat(x, y, c);
  }

  /** 1클릭: 처치 — HP만 지불. 몹은 시신(이미지+숫자)으로 남고 보상은 수확(2클릭) 때. */
  private defeat(x: number, y: number, c: Cell): ClickResult {
    const def = getMonster(c.monsterId!);
    const synergy = this.getSynergy();
    const payment = resolvePayment(def.id, def.level, this.state.hp, synergy, econ);

    // 감당 불가 → 가드 있으면 입력 취소(HP 미지불, 처치 안 함). 단 그 칸은 공개해 정체를 보여준다.
    if (payment.lethal && this.state.misclickGuards > 0) {
      this.state.misclickGuards--;
      c.revealed = true; // 보석처럼: 무엇이 있었는지 드러난다(살아있는 몹으로 표시).
      return { kind: 'guarded', pos: { x, y } };
    }

    this.state.hp -= payment.hpCost;
    this.state.hpSpentThisLevel += payment.hpCost;
    c.revealed = true;
    c.dead = true;
    this.state.turn++;
    // 처치된 몹은 합산에서 빠진다 → 주변 숫자 즉시 갱신.
    computeAdjacencySums(this.state.board, this.state.width, this.state.height, MONSTERS);

    const killedDragon = def.placement === 'center-revealed';
    let died = false;
    let zoneCleared: number | null = null;

    if (this.state.hp < 0) {
      // HP가 음수가 되면 사망(0은 생존). 드래곤을 죽였어도 본인이 죽으면 패배.
      died = true;
      c.killer = true; // 나를 죽인 몹 — 빨간 테두리로 표시
      this.state.phase = 'lost';
      this.state.hp = 0;
    } else if (killedDragon) {
      // 드래곤은 처치(생존)하면 즉시 승리(수확 불필요).
      this.state.phase = 'won';
    } else {
      const z = c.zone;
      if (!this.state.clearedZones[z] && this.aliveMonstersInZone(z) === 0) {
        this.state.clearedZones[z] = true;
        zoneCleared = z; // 상점은 항상 탭으로 접근하므로 페이즈는 그대로 'playing'.
      }
    }

    return {
      kind: 'defeat',
      pos: { x, y },
      monsterId: def.id,
      hpCost: payment.hpCost,
      zoneCleared,
      killedDragon: killedDragon && !died,
      died,
    };
  }

  /** 2클릭: 시신 수확 — 경험치(Vitality)·골드·점수 획득. 이후 그 칸은 숫자 타일이 된다. */
  private collect(x: number, y: number, c: Cell): ClickResult {
    const def = getMonster(c.monsterId!);
    const synergy = this.getSynergy();
    const payment = resolvePayment(def.id, def.level, this.state.hp, synergy, econ);

    this.state.vitality += payment.trackA_vitality;
    this.state.vitalityForLevel += payment.trackA_vitality;
    this.state.gold += payment.trackB_gold;
    c.collected = true;
    this.state.turn++;

    return {
      kind: 'collect',
      pos: { x, y },
      monsterId: def.id,
      vitality: payment.trackA_vitality,
      gold: payment.trackB_gold,
    };
  }

  /** 레벨업 가능 여부(누적 성장이 비용 이상). */
  canLevelUp(): boolean {
    return this.state.phase === 'playing' && this.state.vitalityForLevel >= this.levelUpCostNow();
  }

  /** 유저가 직접 레벨업: 완전 회복 + 최대 HP +1 + 버스트 골드 + 조형 칸. */
  levelUp(): LevelUpResult | null {
    if (!this.canLevelUp()) return null;
    const synergy = this.getSynergy();
    const cost = this.levelUpCostNow();
    this.state.vitalityForLevel -= cost;
    this.state.level++;
    this.state.maxHp = maxHpAt(this.state.level, econ);
    this.state.hp = this.state.maxHp; // 완전 회복
    const burstGold = Math.round(this.state.hpSpentThisLevel * econ.levelUpBurstGoldPerHp);
    this.state.gold += burstGold;
    this.state.hpSpentThisLevel = 0;
    const sculptGained = balance.backpack.cellsPerLevelUp + synergy.sculptBonus;
    this.state.pendingSculptCells += sculptGained;
    return { level: this.state.level, maxHp: this.state.maxHp, burstGold, sculptGained };
  }

  /** 유저가 원할 때 캠프(가방 정리·상점)를 연다. */
  openCampManual(): void {
    if (this.state.phase === 'playing') this.state.phase = 'full-camp';
  }

  /** 캠프 종료 → 진행 재개 + 가드 재충전. */
  closeCamp(): void {
    if (this.state.phase === 'mini-camp' || this.state.phase === 'full-camp') {
      this.state.phase = 'playing';
      this.refreshGuards();
    }
  }

  private aliveMonstersInZone(zone: number): number {
    const dragonId = getMonster('dragon').id;
    let n = 0;
    for (const cell of this.state.board) {
      if (cell.zone !== zone) continue;
      if (cell.content === 'monster' && !cell.dead && cell.monsterId !== dragonId) n++;
    }
    return n;
  }

  /** 보석 정찰: 중심 주변 원형 반경 내 칸을 공개(몬스터는 보이되 처치되지 않음). */
  private revealArea(cx: number, cy: number): Vec2[] {
    const { width: w, height: h } = this.state;
    const r2 = GEM_RADIUS * GEM_RADIUS;
    const out: Vec2[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        const cell = this.state.board[idx(x, y, w)];
        if (!cell.revealed) {
          cell.revealed = true;
          out.push({ x, y });
        }
      }
    }
    return out;
  }

  /** 사망/승리 시 전체 맵 공개. */
  revealAll(): void {
    for (const cell of this.state.board) cell.revealed = true;
  }
}
