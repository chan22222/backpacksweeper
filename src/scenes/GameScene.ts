import Phaser from 'phaser';
import { BOARD_ORIGIN, BP_CELL, BP_ORIGIN, COLORS, FONT, LAYOUT, TILE, VIEW } from '../config';
import { Game, type ClickResult } from '../core/game';
import { neighbors8 } from '../core/board';
import { absoluteCells, bpCell, canPlace } from '../core/backpack';
import type { SynergyResult } from '../core/backpack';
import { balance, getItem, getMonster, ITEM_POOL, MONSTERS } from '../data';
import { Rng } from '../core/rng';
import type { ItemDef, PickupType } from '../core/types';

const TREASURE_EXP = balance.board.treasureExp;

const PICKUP_STYLE: Record<PickupType, { fill: number; stroke: number; glyph: string; glyphColor: string }> = {
  gem: { fill: COLORS.gemFill, stroke: COLORS.gemEdge, glyph: '◆', glyphColor: '#5fd6ea' },
  life: { fill: COLORS.lifeFill, stroke: COLORS.lifeEdge, glyph: '❤', glyphColor: '#ff7d99' },
  treasure: { fill: COLORS.treasureFill, stroke: COLORS.treasureEdge, glyph: '📦', glyphColor: COLORS.goldText },
  reroll: { fill: COLORS.rerollFill, stroke: COLORS.rerollEdge, glyph: '🔄', glyphColor: '#c9a6ff' },
};

const SHOP_COST: Record<string, number> = { weapon: 30, relic: 40, defense: 25, special: 35 };

interface ShopEntry {
  item: ItemDef;
  cost: number;
  sold: boolean;
}

type Tab = 'bag' | 'shop' | 'census';

export class GameScene extends Phaser.Scene {
  private engine!: Game;

  private cellRects: Phaser.GameObjects.Rectangle[] = [];
  private cellText: Phaser.GameObjects.Text[] = [];
  private cellIcon: Phaser.GameObjects.Text[] = [];
  private bpRects: Phaser.GameObjects.Rectangle[] = [];
  private itemLayer!: Phaser.GameObjects.Container;
  private fxLayer!: Phaser.GameObjects.Container;

  private hpBarFill!: Phaser.GameObjects.Rectangle;
  private vitBarFill!: Phaser.GameObjects.Rectangle;
  private hpText!: Phaser.GameObjects.Text;
  private vitText!: Phaser.GameObjects.Text;
  private goldText!: Phaser.GameObjects.Text;
  private guardText!: Phaser.GameObjects.Text;
  private synText!: Phaser.GameObjects.Text;
  private timeText!: Phaser.GameObjects.Text;
  private startMs = 0;
  private endMs: number | null = null;
  private levelUpBtn!: Phaser.GameObjects.Text;

  private tab: Tab = 'bag';
  private tabBtns: { key: Tab; btn: Phaser.GameObjects.Text }[] = [];
  private bagContent!: Phaser.GameObjects.Container;
  private shopContent!: Phaser.GameObjects.Container;
  private censusContent!: Phaser.GameObjects.Container;
  private tooltip!: Phaser.GameObjects.Container;
  private notePopup?: Phaser.GameObjects.Container;
  private helpModal?: Phaser.GameObjects.Container;
  private adminReveal = false; // 테스트용 전체 맵 공개(렌더 전용, 상태 미변경)
  private adminBtn?: Phaser.GameObjects.Text;

  private selectedItem: number | null = null;
  private dragItemIdx: number | null = null;
  private dragGrab = { x: 0, y: 0 };
  private dragHover = { x: 0, y: 0 };
  private shop: ShopEntry[] = [];
  private shopRolls = 0; // 새로고침 횟수(시드) — 두루마리를 먹어야만 증가
  private cellsPurchased = 0; // 상점에서 구매한 가방 칸 확장 수(비용 곡선용)
  private lastClick = { x: 0, y: 0 };
  private syn!: SynergyResult;

  constructor() {
    super('GameScene');
  }

  create(data?: { seed?: number }): void {
    this.input.enabled = true;
    const seed = (data?.seed ?? (Date.now() & 0x7fffffff)) || 0xc0ffee;
    this.engine = new Game(seed);
    this.startMs = this.time.now;
    this.endMs = null;
    this.cellRects = [];
    this.cellText = [];
    this.cellIcon = [];
    this.bpRects = [];
    this.tabBtns = [];
    this.tab = 'bag';
    this.selectedItem = null;
    this.dragItemIdx = null;
    this.notePopup = undefined;
    this.helpModal = undefined;
    this.adminReveal = false;
    this.shopRolls = 0;
    this.cellsPurchased = 0;

    this.input.mouse?.disableContextMenu();

    this.drawChrome();
    this.buildBoard();
    this.buildResources();
    this.buildTabs();
    this.buildBag();
    this.buildShop();
    this.buildCensus();
    this.buildTooltip();
    this.buildHelpButton();
    this.buildAdminButton();

    this.fxLayer = this.add.container(0, 0).setDepth(60);

    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);
    this.input.keyboard?.on('keydown-R', () => this.rotateSelected());

    this.rollShop(); // 초기 매물 1회. 이후엔 새로고침 두루마리로만 갱신.
    this.switchTab('bag');
    this.redrawAll();
  }

  // ----------------------------- chrome / helpers -----------------------------

  private drawChrome(): void {
    const g = this.add.graphics().setDepth(-10);
    g.fillStyle(COLORS.bg, 1);
    g.fillRect(0, 0, VIEW.width, VIEW.height);
    for (const p of [LAYOUT.boardFrame, LAYOUT.playerPanel]) {
      g.fillStyle(COLORS.bgInk, 0.4);
      g.fillRect(p.x + 3, p.y + 5, p.w, p.h);
      g.fillStyle(COLORS.panel, 1);
      g.fillRect(p.x, p.y, p.w, p.h);
      g.lineStyle(1, COLORS.panelEdge, 1);
      g.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
      g.lineStyle(2, COLORS.gold, 0.45);
      g.lineBetween(p.x + 10, p.y + 2, p.x + p.w - 10, p.y + 2);
    }
  }

  private sectionHeader(parent: Phaser.GameObjects.Container | null, x: number, y: number, w: number, label: string): void {
    const t = this.add.text(x, y, label, { fontFamily: FONT, fontSize: '14px', color: COLORS.goldText }).setOrigin(0, 0.5);
    const lineX = x + t.width + 10;
    const rule = this.add.rectangle(lineX, y, Math.max(0, x + w - lineX), 1, COLORS.goldDim).setOrigin(0, 0.5).setAlpha(0.7);
    if (parent) parent.add([t, rule]);
  }

  // ----------------------------- build -----------------------------

  private buildBoard(): void {
    const st = this.engine.state;
    for (let y = 0; y < st.height; y++) {
      for (let x = 0; x < st.width; x++) {
        const sx = BOARD_ORIGIN.x + x * TILE + TILE / 2;
        const sy = BOARD_ORIGIN.y + y * TILE + TILE / 2;
        const rect = this.add
          .rectangle(sx, sy, TILE - 3, TILE - 3, COLORS.hidden)
          .setStrokeStyle(1, COLORS.border)
          .setInteractive({ useHandCursor: true });
        rect.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.onCellPointer(x, y, pointer.rightButtonDown()));
        rect.on('pointerover', () => {
          const cc = this.engine.cellAt(x, y);
          if (this.engine.state.phase === 'playing' && !cc.revealed && !(cc.pickup && !cc.pickupUsed)) {
            rect.setFillStyle(COLORS.hiddenHover);
          }
        });
        rect.on('pointerout', () => this.redrawCell(x, y));
        this.cellRects.push(rect);
        this.cellText.push(this.add.text(sx, sy, '', { fontFamily: FONT, fontSize: '20px', color: COLORS.text }).setOrigin(0.5));
        this.cellIcon.push(this.add.text(sx, sy - 7, '', { fontFamily: FONT, fontSize: '18px', color: COLORS.text }).setOrigin(0.5));
      }
    }
  }

  /** 패널 상단 — 항상 보이는 자원/레벨업(좁은 폭에 맞춰 세로 배치). */
  private buildResources(): void {
    const X = LAYOUT.playerPanel.x + 16; // 524
    const barX = X + 36;
    const barW = 150;
    this.sectionHeader(null, X, 88, LAYOUT.playerPanel.w - 32, '자원');
    // 클리어 타임(자원 헤더 우측 정렬, 매 프레임 갱신)
    this.timeText = this.add
      .text(LAYOUT.playerPanel.x + LAYOUT.playerPanel.w - 14, 88, '⏱ 00:00', {
        fontFamily: FONT,
        fontSize: '15px',
        color: COLORS.goldText,
        backgroundColor: '#191d29',
        padding: { x: 6, y: 2 },
      })
      .setOrigin(1, 0.5);

    this.add.text(X, 116, 'HP', { fontFamily: FONT, fontSize: '13px', color: '#ffb0bb' }).setOrigin(0, 0.5);
    this.add.rectangle(barX, 116, barW, 14, COLORS.hpTrack).setOrigin(0, 0.5);
    this.hpBarFill = this.add.rectangle(barX, 116, barW, 14, COLORS.hp).setOrigin(0, 0.5);
    this.hpText = this.add.text(barX + barW + 10, 116, '', { fontFamily: FONT, fontSize: '13px', color: COLORS.text }).setOrigin(0, 0.5);

    this.add.text(X, 142, '성장', { fontFamily: FONT, fontSize: '13px', color: '#e7c78a' }).setOrigin(0, 0.5);
    this.add.rectangle(barX, 142, barW, 14, COLORS.vitTrack).setOrigin(0, 0.5);
    this.vitBarFill = this.add.rectangle(barX, 142, 0, 14, COLORS.vitality).setOrigin(0, 0.5);
    this.vitText = this.add.text(barX + barW + 10, 142, '', { fontFamily: FONT, fontSize: '13px', color: COLORS.text }).setOrigin(0, 0.5);

    this.goldText = this.add.text(X, 172, '', { fontFamily: FONT, fontSize: '15px', color: COLORS.goldText }).setOrigin(0, 0.5);
    this.guardText = this.add.text(X + 150, 172, '', { fontFamily: FONT, fontSize: '14px', color: COLORS.textDim }).setOrigin(0, 0.5);

    this.levelUpBtn = this.add
      .text(X, 202, '', { fontFamily: FONT, fontSize: '15px', color: '#1a1208', backgroundColor: '#2a3140', padding: { x: 12, y: 8 } })
      .setOrigin(0, 0.5)
      .setInteractive({ useHandCursor: true });
    this.levelUpBtn.on('pointerover', () => this.levelUpBtn.setAlpha(0.9));
    this.levelUpBtn.on('pointerout', () => this.levelUpBtn.setAlpha(1));
    this.levelUpBtn.on('pointerdown', () => this.tryLevelUp());

    this.add.rectangle(X, 230, LAYOUT.playerPanel.w - 32, 1, COLORS.panelEdge).setOrigin(0, 0.5);
  }

  private buildTabs(): void {
    const X = LAYOUT.playerPanel.x + 16;
    const y = 256;
    const defs: { key: Tab; label: string }[] = [
      { key: 'bag', label: '가방' },
      { key: 'shop', label: '상점' },
      { key: 'census', label: '남은 몹' },
    ];
    let tx = X;
    for (const d of defs) {
      const btn = this.add
        .text(tx, y, `  ${d.label}  `, { fontFamily: FONT, fontSize: '15px', color: COLORS.textDim, padding: { x: 8, y: 7 } })
        .setOrigin(0, 0.5)
        .setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => this.switchTab(d.key));
      this.tabBtns.push({ key: d.key, btn });
      tx += btn.width + 8;
    }
  }

  private buildBag(): void {
    const X = LAYOUT.playerPanel.x + 16;
    const effX = 760;
    this.bagContent = this.add.container(0, 0);
    this.sectionHeader(this.bagContent, X, 288, 210, '가방');

    const bp = this.engine.state.backpack;
    for (let gy = 0; gy < bp.height; gy++) {
      for (let gx = 0; gx < bp.width; gx++) {
        const sx = BP_ORIGIN.x + gx * BP_CELL + BP_CELL / 2;
        const sy = BP_ORIGIN.y + gy * BP_CELL + BP_CELL / 2;
        const rect = this.add.rectangle(sx, sy, BP_CELL - 4, BP_CELL - 4, COLORS.bpActive).setStrokeStyle(1, COLORS.border);
        this.bpRects.push(rect);
        this.bagContent.add(rect);
      }
    }
    this.itemLayer = this.add.container(0, 0);
    this.bagContent.add(this.itemLayer);

    this.sectionHeader(this.bagContent, effX, 288, LAYOUT.playerPanel.x + LAYOUT.playerPanel.w - 16 - effX, '효과');
    this.synText = this.add.text(effX, 312, '', { fontFamily: FONT, fontSize: '12px', color: COLORS.textDim, lineSpacing: 6, wordWrap: { width: 252 } });
    this.bagContent.add(this.synText);

    const hint = this.add.text(effX, 452, '아이템을 드래그해 옮기고, R 키로 회전해요.\n마우스를 올리면 설명이 나와요.\n🔒 잠긴 칸은 상점에서 "가방 칸 확장"으로 열 수 있어요.', {
      fontFamily: FONT,
      fontSize: '12px',
      color: COLORS.textFaint,
      lineSpacing: 6,
      wordWrap: { width: 252 },
    });
    this.bagContent.add(hint);
  }

  private buildShop(): void {
    this.shopContent = this.add.container(0, 0);
  }

  private buildCensus(): void {
    this.censusContent = this.add.container(0, 0);
  }

  private buildTooltip(): void {
    this.tooltip = this.add.container(0, 0).setDepth(70).setVisible(false);
  }

  private switchTab(tab: Tab): void {
    this.tab = tab;
    this.selectedItem = null;
    for (const t of this.tabBtns) {
      const active = t.key === tab;
      t.btn.setBackgroundColor(active ? '#e7b65a' : '#232a38').setColor(active ? '#1a1208' : COLORS.textDim);
    }
    this.bagContent.setVisible(tab === 'bag');
    this.shopContent.setVisible(tab === 'shop');
    this.censusContent.setVisible(tab === 'census');
    this.hideTooltip();
    if (tab === 'shop') this.redrawShop();
    if (tab === 'census') this.redrawCensus();
    this.redrawAll();
  }

  // ----------------------------- input -----------------------------

  private onCellPointer(x: number, y: number, right: boolean): void {
    if (this.engine.state.phase !== 'playing') return;
    if (right) {
      this.openNotePopup(x, y);
      return;
    }
    this.lastClick = { x, y };
    this.handleResult(this.engine.click(x, y));
  }

  /** 씬 레벨 입력 — 가방 탭에서 가방 편집. */
  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.notePopup || this.helpModal) return;
    if (this.engine.state.phase !== 'playing' || this.tab !== 'bag') return;
    const st = this.engine.state;
    const gx = Math.floor((pointer.x - BP_ORIGIN.x) / BP_CELL);
    const gy = Math.floor((pointer.y - BP_ORIGIN.y) / BP_CELL);
    if (gx >= 0 && gy >= 0 && gx < st.backpack.width && gy < st.backpack.height) {
      this.onBpPointer(gx, gy, pointer.rightButtonDown());
    }
  }

  /** 가방 클릭: 아이템이면 드래그 시작, 우클릭이면 회전, 빈 칸이면 조형. */
  private onBpPointer(gx: number, gy: number, right: boolean): void {
    const bp = this.engine.state.backpack;
    const cell = bpCell(bp, gx, gy);
    if (!cell) return;
    const itemIdx = bp.items.findIndex((pl) => absoluteCells(bp, pl, getItem).some((p) => p.x === gx && p.y === gy));

    if (right) {
      if (itemIdx >= 0) {
        this.rotateItem(itemIdx);
        this.redrawAll();
      }
      return;
    }
    if (itemIdx >= 0) {
      const pl = bp.items[itemIdx];
      if (getItem(pl.itemId).fixed) return; // 고정 아이템(저주)은 옮길 수 없음
      // 드래그 시작 — 잡은 칸과 앵커의 상대 오프셋을 기억.
      this.dragItemIdx = itemIdx;
      this.selectedItem = itemIdx; // R 회전 대상
      this.dragGrab = { x: gx - pl.origin.x, y: gy - pl.origin.y };
      this.dragHover = { x: gx, y: gy };
      this.redrawBackpack();
    } else if (!cell.active) {
      this.trySculpt(gx, gy);
      this.redrawAll();
    }
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.dragItemIdx === null) return;
    this.dragHover = {
      x: Math.floor((pointer.x - BP_ORIGIN.x) / BP_CELL),
      y: Math.floor((pointer.y - BP_ORIGIN.y) / BP_CELL),
    };
    this.redrawBackpack();
  }

  private onPointerUp(): void {
    if (this.dragItemIdx === null) return;
    const bp = this.engine.state.backpack;
    const idx = this.dragItemIdx;
    const pl = bp.items[idx];
    const def = getItem(pl.itemId);
    const origin = { x: this.dragHover.x - this.dragGrab.x, y: this.dragHover.y - this.dragGrab.y };
    if (canPlace(bp, def, origin, pl.rotation, getItem, idx)) {
      pl.origin = origin;
      this.engine.refreshGuards();
    }
    this.dragItemIdx = null;
    this.selectedItem = null;
    this.redrawAll();
  }

  /** 드래그 중인 아이템의 후보 앵커(없으면 null). */
  private dragOrigin(): { x: number; y: number } | null {
    if (this.dragItemIdx === null) return null;
    return { x: this.dragHover.x - this.dragGrab.x, y: this.dragHover.y - this.dragGrab.y };
  }

  private rotateSelected(): void {
    if (this.tab !== 'bag' || this.selectedItem === null) return;
    this.rotateItem(this.selectedItem);
    this.redrawAll();
  }

  private rotateItem(idx: number): void {
    const bp = this.engine.state.backpack;
    const pl = bp.items[idx];
    const def = getItem(pl.itemId);
    if (def.fixed) return;
    const next = ((pl.rotation + 1) % 4) as 0 | 1 | 2 | 3;
    if (canPlace(bp, def, pl.origin, next, getItem, idx)) {
      pl.rotation = next;
      this.engine.refreshGuards();
    }
  }

  private trySculpt(gx: number, gy: number): void {
    const st = this.engine.state;
    if (st.pendingSculptCells <= 0 || !this.bpUnlockable(gx, gy)) return;
    const cell = bpCell(st.backpack, gx, gy);
    if (!cell) return;
    cell.active = true;
    st.pendingSculptCells--;
  }

  /** 비활성 칸이 활성 칸과 4방향 인접해 확장 가능한가. */
  private bpUnlockable(gx: number, gy: number): boolean {
    const bp = this.engine.state.backpack;
    const cell = bpCell(bp, gx, gy);
    if (!cell || cell.active) return false;
    const adj = [bpCell(bp, gx, gy - 1), bpCell(bp, gx, gy + 1), bpCell(bp, gx - 1, gy), bpCell(bp, gx + 1, gy)];
    return adj.some((a) => a?.active);
  }

  private tryAutoPlace(item: ItemDef): boolean {
    const bp = this.engine.state.backpack;
    for (let y = 0; y < bp.height; y++) {
      for (let x = 0; x < bp.width; x++) {
        for (let r = 0; r < 4; r++) {
          if (canPlace(bp, item, { x, y }, r, getItem)) {
            bp.items.push({ itemId: item.id, origin: { x, y }, rotation: r as 0 | 1 | 2 | 3 });
            return true;
          }
        }
      }
    }
    return false;
  }

  private buyItem(entry: ShopEntry): void {
    const st = this.engine.state;
    if (entry.sold) return;
    if (st.gold < entry.cost) {
      this.floatText(790, 130, '골드가 부족해요', COLORS.goldText, 18);
      this.cameras.main.shake(60, 0.0015);
      return;
    }
    if (!this.tryAutoPlace(entry.item)) {
      this.floatText(790, 130, '가방에 공간이 없어요', COLORS.goldText, 18);
      return;
    }
    st.gold -= entry.cost;
    entry.sold = true;
    this.engine.refreshGuards();
    this.redrawShop();
    this.redrawAll();
  }

  // ----------------------------- 툴팁 -----------------------------

  private showTooltip(def: ItemDef, sx: number, sy: number): void {
    this.tooltip.removeAll(true);
    const w = 240;
    const name = this.add.text(12, 10, def.name, { fontFamily: FONT, fontSize: '15px', color: COLORS.goldText });
    const desc = this.add.text(12, 34, def.desc, { fontFamily: FONT, fontSize: '12px', color: COLORS.text, wordWrap: { width: w - 24 }, lineSpacing: 3 });
    const h = 44 + desc.height;
    const bg = this.add.rectangle(0, 0, w, h, COLORS.panel, 0.98).setOrigin(0, 0).setStrokeStyle(1, COLORS.gold, 0.7);
    this.tooltip.add([bg, name, desc]);
    let px = sx + 26;
    let py = sy - h / 2;
    px = Phaser.Math.Clamp(px, 8, VIEW.width - w - 8);
    py = Phaser.Math.Clamp(py, 8, VIEW.height - h - 8);
    this.tooltip.setPosition(px, py).setVisible(true);
  }

  private hideTooltip(): void {
    this.tooltip.setVisible(false);
  }

  // ----------------------------- result/FX -----------------------------

  private cellScreen(x: number, y: number): { x: number; y: number } {
    return { x: BOARD_ORIGIN.x + x * TILE + TILE / 2, y: BOARD_ORIGIN.y + y * TILE + TILE / 2 };
  }

  private handleResult(res: ClickResult): void {
    const st = this.engine.state;
    switch (res.kind) {
      case 'revealed':
        this.redrawAll();
        this.animateReveal(res.cells);
        break;
      case 'life': {
        const c = this.cellScreen(res.pos.x, res.pos.y);
        this.floatText(c.x, c.y, `풀피 회복! +${res.heal} ❤`, '#ff6b8a', 22);
        this.redrawAll();
        break;
      }
      case 'treasure-open': {
        const c = this.cellScreen(res.pos.x, res.pos.y);
        this.floatText(c.x, c.y - 4, `📦 열림! 클릭해 +${res.exp} 수확`, '#e7b65a', 18);
        this.redrawAll();
        break;
      }
      case 'treasure': {
        const c = this.cellScreen(res.pos.x, res.pos.y);
        this.floatText(c.x, c.y, `+${res.exp} EXP`, '#e7b65a', 24);
        this.redrawAll();
        break;
      }
      case 'reroll-open': {
        const c = this.cellScreen(res.pos.x, res.pos.y);
        this.floatText(c.x, c.y - 4, '🔄 새로고침 두루마리! 다시 클릭', '#c9a6ff', 17);
        this.redrawAll();
        break;
      }
      case 'reroll': {
        const c = this.cellScreen(res.pos.x, res.pos.y);
        this.shopRolls++;
        this.rollShop(); // 새 매물 확정
        this.floatText(c.x, c.y, '상점 새로고침!', '#c9a6ff', 22);
        this.redrawAll();
        break;
      }
      case 'guarded': {
        const c = this.cellScreen(res.pos.x, res.pos.y);
        this.floatText(c.x, c.y, '가드 발동! 정체 공개', '#9fb4d6');
        this.cameras.main.shake(90, 0.002);
        this.redrawAll();
        break;
      }
      case 'defeat': {
        const c = this.cellScreen(res.pos.x, res.pos.y);
        this.cameras.main.shake(120, res.hpCost > 0 ? 0.003 : 0.0015);
        this.floatText(c.x, c.y - 4, `-${res.hpCost}`, '#ff6b54');
        if (res.zoneCleared !== null) {
          this.floatText(VIEW.width / 2, 100, `구역 ${res.zoneCleared + 1} 클리어! 상점에서 정비하세요`, '#e7b65a', 26);
        }
        if (st.phase === 'won' || st.phase === 'lost') {
          if (st.phase === 'lost') this.cameras.main.shake(260, 0.009);
          this.engine.revealAll();
          this.redrawAll();
          const t = this.fmtTime(this.time.now - this.startMs);
          const msg = st.phase === 'won' ? `🏆 클리어 타임 ${t}` : `💀 생존 시간 ${t}`;
          this.floatText(VIEW.width / 2, 130, msg, st.phase === 'won' ? '#e7b65a' : '#ff6b78', 30);
        } else {
          this.redrawAll();
          // 쥐왕 처치 → 공개된 쥐들 연출 + 안내.
          if (res.revealedCells && res.revealedCells.length > 0) {
            this.animateReveal(res.revealedCells);
            this.floatText(VIEW.width / 2, 100, `👑 쥐왕 처치! 쥐 ${res.revealedCells.length}마리 위치 공개`, '#e7b65a', 24);
          }
          // 소환술사 처치 → 둘러싼 슬라임이 보상 수확칸(◆2)으로 전환.
          if (res.absorbedCells && res.absorbedCells.length > 0) {
            this.animateReveal(res.absorbedCells);
            this.floatText(VIEW.width / 2, 100, `🧙 소환술사 처치! 슬라임 ${res.absorbedCells.length}마리가 보상칸으로 (각 ◆2)`, '#7fd6a0', 22);
          }
          // 드래곤 처치(생존) → 시신 수확 유도.
          if (res.killedDragon) {
            this.floatText(c.x, c.y - 22, '드래곤을 쓰러뜨렸다! 시신을 수확하세요(+15 EXP)', '#e7b65a', 18);
          }
        }
        break;
      }
      case 'collect': {
        const c = this.cellScreen(res.pos.x, res.pos.y);
        this.floatText(c.x - 14, c.y - 4, `+${res.vitality} EXP`, '#e7c78a', 22);
        if (res.gold > 0) this.floatText(c.x + 20, c.y + 14, `+${res.gold}G`, '#e7b65a', 22);
        this.redrawAll();
        // 드래곤 시신을 수확하면 왕관 등장.
        if (res.monsterId === 'dragon') {
          this.floatText(VIEW.width / 2, 120, '👑 승리의 왕관이 나타났다! 왕관을 눌러 승리하세요', '#e7b65a', 22);
        }
        break;
      }
      case 'crown-win': {
        this.engine.revealAll();
        this.redrawAll();
        const t = this.fmtTime(this.time.now - this.startMs);
        this.floatText(VIEW.width / 2, 130, `🏆 클리어 타임 ${t}`, '#e7b65a', 30);
        break;
      }
      default:
        break;
    }
  }

  private floatText(x: number, y: number, str: string, color: string, size = 22): void {
    const t = this.add.text(x, y, str, { fontFamily: FONT, fontSize: `${size}px`, color, fontStyle: 'bold' }).setOrigin(0.5).setDepth(80);
    this.fxLayer.add(t);
    // 떠오르며(1.2s) 머물다 사라진다 → 약 1.2초간 노출.
    this.tweens.add({ targets: t, y: y - 46, duration: 1200, ease: 'Sine.out' });
    this.tweens.add({ targets: t, alpha: 0, delay: 600, duration: 600, ease: 'Quad.in', onComplete: () => t.destroy() });
  }

  private flashScreen(): void {
    const f = this.add.rectangle(VIEW.width / 2, VIEW.height / 2, VIEW.width, VIEW.height, 0xffffff).setDepth(75);
    this.tweens.add({ targets: f, alpha: 0, duration: 320, onComplete: () => f.destroy() });
  }

  private animateReveal(cells: { x: number; y: number }[]): void {
    const w = this.engine.state.width;
    for (const p of cells) {
      const i = p.y * w + p.x;
      const d = Math.hypot(p.x - this.lastClick.x, p.y - this.lastClick.y);
      const delay = d * 32;
      const objs = [this.cellRects[i], this.cellText[i], this.cellIcon[i]];
      objs.forEach((o) => o.setAlpha(0));
      this.tweens.add({ targets: objs, alpha: 1, duration: 150, delay, ease: 'Quad.out' });
    }
  }

  private tryLevelUp(): void {
    const ph = this.engine.state.phase;
    if (ph === 'won' || ph === 'lost') {
      this.scene.restart();
      return;
    }
    if (ph !== 'playing') return;
    if (!this.engine.canLevelUp()) {
      this.cameras.main.shake(60, 0.0015);
      return;
    }
    const r = this.engine.levelUp();
    if (!r) return;
    this.flashScreen();
    const bx = BOARD_ORIGIN.x + (this.engine.state.width * TILE) / 2;
    const by = BOARD_ORIGIN.y + (this.engine.state.height * TILE) / 2;
    this.floatText(bx, by, `LEVEL UP!  Lv${r.level}  ·  HP ${r.maxHp} 완전회복`, '#e7b65a', 30);
    if (r.burstGold > 0) this.floatText(bx, by + 30, `버스트 +${r.burstGold}G`, '#e7b65a', 24);
    this.redrawAll();
  }

  // ----------------------------- 우클릭 숫자 메모 -----------------------------

  private openNotePopup(x: number, y: number): void {
    this.closeNotePopup();
    if (this.engine.cellAt(x, y).revealed) return;

    const c = this.add.container(0, 0).setDepth(90);
    const blocker = this.add.rectangle(VIEW.width / 2, VIEW.height / 2, VIEW.width, VIEW.height, 0x000000, 0.001).setInteractive();
    blocker.on('pointerdown', () => this.closeNotePopup());
    c.add(blocker);

    const levels = [...new Set(MONSTERS.map((m) => m.level))].sort((a, b) => a - b);
    const opts: Array<number | null> = [0, ...levels, null];
    const cols = 5;
    const bw = 40;
    const bh = 32;
    const pad = 6;
    const rows = Math.ceil(opts.length / cols);
    const panelW = cols * bw + (cols + 1) * pad;
    const panelH = rows * bh + (rows + 1) * pad + 22;
    let px = BOARD_ORIGIN.x + x * TILE + TILE / 2;
    let py = BOARD_ORIGIN.y + y * TILE - panelH / 2;
    px = Phaser.Math.Clamp(px, panelW / 2 + 8, VIEW.width - panelW / 2 - 8);
    py = Phaser.Math.Clamp(py, panelH / 2 + 8, VIEW.height - panelH / 2 - 8);

    const panel = this.add.rectangle(px, py, panelW, panelH, COLORS.panel, 0.98).setStrokeStyle(2, COLORS.gold, 0.5);
    const title = this.add.text(px, py - panelH / 2 + 12, '메모: 숫자 지정', { fontFamily: FONT, fontSize: '12px', color: COLORS.goldText }).setOrigin(0.5);
    c.add([panel, title]);

    const x0 = px - panelW / 2 + pad + bw / 2;
    const y0 = py - panelH / 2 + 22 + pad + bh / 2;
    opts.forEach((v, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const bxp = x0 + col * (bw + pad);
      const byp = y0 + row * (bh + pad);
      const clear = v === null;
      const btn = this.add.rectangle(bxp, byp, bw, bh, clear ? 0x4a2030 : 0x232a38).setStrokeStyle(1, COLORS.border).setInteractive({ useHandCursor: true });
      const lab = this.add.text(bxp, byp, clear ? '지움' : String(v), { fontFamily: FONT, fontSize: '15px', color: clear ? '#ff9aa2' : COLORS.text }).setOrigin(0.5);
      btn.on('pointerdown', () => {
        this.engine.setNote(x, y, v);
        this.closeNotePopup();
        this.redrawCell(x, y);
      });
      c.add([btn, lab]);
    });
    this.notePopup = c;
  }

  private closeNotePopup(): void {
    if (this.notePopup) {
      this.notePopup.destroy(true);
      this.notePopup = undefined;
    }
  }

  // ----------------------------- 도움말 -----------------------------

  /** 상단 우측 도움말 버튼(빈 상단 스트립에 배치). */
  private buildHelpButton(): void {
    const btn = this.add
      .text(VIEW.width - 16, 30, '❓ 게임 설명', {
        fontFamily: FONT,
        fontSize: '15px',
        color: COLORS.goldText,
        backgroundColor: '#191d29',
        padding: { x: 12, y: 7 },
      })
      .setOrigin(1, 0.5)
      .setDepth(50)
      .setInteractive({ useHandCursor: true });
    btn.on('pointerover', () => btn.setBackgroundColor('#252d3c'));
    btn.on('pointerout', () => btn.setBackgroundColor('#191d29'));
    btn.on('pointerdown', () => this.openHelp());
  }

  /** 임시 테스트용 — 우측 하단. 누르면 전체 맵을 미리 본다(렌더 전용 토글). */
  private buildAdminButton(): void {
    const btn = this.add
      .text(VIEW.width - 14, VIEW.height - 14, '🔧 admin: 맵 공개', {
        fontFamily: FONT,
        fontSize: '13px',
        color: COLORS.textDim,
        backgroundColor: '#15171f',
        padding: { x: 10, y: 6 },
      })
      .setOrigin(1, 1)
      .setDepth(50)
      .setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => {
      this.adminReveal = !this.adminReveal;
      this.adminBtn?.setText(this.adminReveal ? '🔧 admin: 가리기' : '🔧 admin: 맵 공개').setColor(this.adminReveal ? COLORS.goldText : COLORS.textDim);
      this.redrawAll();
    });
    this.adminBtn = btn;
  }

  private openHelp(): void {
    if (this.helpModal) return;
    const cx = VIEW.width / 2;
    const cy = VIEW.height / 2;
    const w = 760;
    const h = 650;
    const left = cx - w / 2;
    const top = cy - h / 2;

    const c = this.add.container(0, 0).setDepth(120);
    const overlay = this.add.rectangle(cx, cy, VIEW.width, VIEW.height, COLORS.bgInk, 0.74).setInteractive();
    overlay.on('pointerdown', () => this.closeHelp());
    const shadow = this.add.rectangle(cx + 4, cy + 7, w, h, COLORS.bgInk, 0.5);
    const panel = this.add.rectangle(cx, cy, w, h, COLORS.panel, 1).setStrokeStyle(1, COLORS.panelEdge).setInteractive();
    const rule = this.add.rectangle(left + 10, top + 3, w - 20, 2, COLORS.gold, 0.45).setOrigin(0, 0.5);
    c.add([overlay, shadow, panel, rule]);

    c.add(this.add.text(left + 28, top + 28, '게임 설명', { fontFamily: FONT, fontSize: '23px', color: COLORS.goldText }).setOrigin(0, 0.5));
    const closeBtn = this.add
      .text(left + w - 24, top + 28, '✕', { fontFamily: FONT, fontSize: '20px', color: COLORS.textDim })
      .setOrigin(1, 0.5)
      .setInteractive({ useHandCursor: true });
    closeBtn.on('pointerover', () => closeBtn.setColor('#ffffff'));
    closeBtn.on('pointerout', () => closeBtn.setColor(COLORS.textDim));
    closeBtn.on('pointerdown', () => this.closeHelp());
    c.add(closeBtn);

    // 좌/우 2열로 나눠 세로 넘침 방지(섹션 4 + 4 균형).
    const columns: Array<Array<{ h: string; b: string }>> = [
      [
        { h: '🎯 목표', b: '최종 보스 드래곤(D15)을 처치하고, 시신을 수확하면 나오는 👑왕관을 누르면 승리! 내 HP가 음수가 되면 패배예요.' },
        {
          h: '🔢 숫자가 핵심 (지뢰찾기 규칙)',
          b: '빈 칸의 숫자 = 그 칸 주변 8칸에 숨은 몬스터 데미지의 합계예요. 몹마다 데미지가 달라서 숫자로 정체를 추리할 수 있어요. (합이 0이면 숫자는 안 보여요.)',
        },
        {
          h: '⚔️ 몹 처치 — HP가 곧 화폐',
          b: '몹을 클릭하면 데미지만큼 HP를 내고 처치(1클릭), 한 번 더 누르면 경험치·골드를 수확해요(2클릭). 내 HP보다 센 몹을 치면 죽으니 조심하세요.',
        },
        {
          h: '⬆️ 성장과 레벨업',
          b: '경험치가 차면 [레벨업] 버튼이 켜져요. 누르면 HP가 완전 회복되고 최대 HP도 늘어요. HP를 거의 다 쓴 뒤 레벨업하는 게 효율적이에요.',
        },
      ],
      [
        {
          h: '✨ 특수 칸',
          b: '🔷 보석 — 주변을 원형으로 정찰\n❤ 하트 — HP 완전 회복\n📦 상자 — 열어 경험치 획득(2클릭)\n🔄 두루마리 — 상점 매물 새로고침(2클릭)',
        },
        {
          h: '🎒 가방·상점',
          b: '상점에서 골드로 아이템을 사 가방에 넣으면 골드 보상이 커져요(생존 HP엔 영향 없음). 모양·배치에 따라 효과가 달라져요.',
        },
        { h: '🖱️ 조작', b: '좌클릭=행동 · 우클릭=메모(예상 숫자) · R=아이템 회전' },
        {
          h: '💡 팁',
          b: '쥐(🐀)의 ←→ 화살표는 쥐왕(👑)이 있는 방향이에요. 쥐왕을 잡으면 모든 쥐가 공개돼요.\n슬라임(🟢)이 빙 둘러싼 한가운데엔 소환술사(🧙)가 숨어 있어요.',
        },
      ],
    ];

    const colX = [left + 28, left + w / 2 + 6];
    const bodyW = w / 2 - 40;
    columns.forEach((col, ci) => {
      let y = top + 64;
      for (const s of col) {
        const head = this.add.text(colX[ci], y, s.h, { fontFamily: FONT, fontSize: '15px', color: '#e7c78a' });
        c.add(head);
        y += head.height + 3;
        const body = this.add.text(colX[ci], y, s.b, {
          fontFamily: FONT,
          fontSize: '13px',
          color: COLORS.textDim,
          wordWrap: { width: bodyW },
          lineSpacing: 4,
        });
        c.add(body);
        y += body.height + 12;
      }
    });

    c.add(this.add.text(cx, top + h - 18, '바깥 영역이나 ✕ 를 누르면 닫혀요', { fontFamily: FONT, fontSize: '12px', color: COLORS.textFaint }).setOrigin(0.5));

    this.helpModal = c;
  }

  private closeHelp(): void {
    if (this.helpModal) {
      this.helpModal.destroy(true);
      this.helpModal = undefined;
    }
  }

  // ----------------------------- redraw -----------------------------

  private redrawAll(): void {
    this.syn = this.engine.getSynergy();
    const st = this.engine.state;
    for (let y = 0; y < st.height; y++) {
      for (let x = 0; x < st.width; x++) this.redrawCell(x, y);
    }
    this.redrawBackpack();
    this.redrawHud();
    if (this.tab === 'shop') this.redrawShop();
    if (this.tab === 'census') this.redrawCensus();
  }

  private redrawCell(x: number, y: number): void {
    const st = this.engine.state;
    const i = y * st.width + x;
    const cell = this.engine.cellAt(x, y);
    const rect = this.cellRects[i];
    const text = this.cellText[i];
    const icon = this.cellIcon[i];
    const sx = BOARD_ORIGIN.x + x * TILE + TILE / 2;
    const sy = BOARD_ORIGIN.y + y * TILE + TILE / 2;
    text.setText('').setPosition(sx, sy).setFontSize(20);
    icon.setText('').setAlpha(1).setColor(COLORS.text).setPosition(sx, sy - 7);

    // admin 미리보기(렌더 전용): 미공개 칸의 내용을 파란 톤으로 엿본다(상태 변경 없음).
    if (this.adminReveal && !cell.revealed && !cell.crown) {
      rect.setFillStyle(COLORS.numbered);
      rect.setStrokeStyle(1, 0x35507a);
      if (cell.content === 'monster') {
        const def = getMonster(cell.monsterId!);
        icon.setText(def.glyph).setFontSize(18).setAlpha(0.85).setPosition(sx, sy - 7);
        text.setText(String(def.level)).setColor('#6fb0ff').setFontSize(12).setPosition(sx, sy + 13);
      } else if (cell.pickup) {
        icon.setText(PICKUP_STYLE[cell.pickup].glyph).setColor('#6fb0ff').setFontSize(18).setPosition(sx, sy);
      } else if (cell.adjacencySum > 0) {
        text.setText(String(cell.adjacencySum)).setColor('#6fb0ff').setFontSize(16);
      }
      return;
    }

    // 드래곤 왕관: 클릭 시 승리(드래곤 시신 수확 후 등장).
    if (cell.crown) {
      rect.setFillStyle(COLORS.treasureFill);
      rect.setStrokeStyle(2, COLORS.gold);
      icon.setText('👑').setColor(COLORS.goldText).setFontSize(22).setPosition(sx, sy - 5);
      text.setText('승리').setColor(COLORS.goldText).setFontSize(11).setPosition(sx, sy + 14);
      return;
    }

    // 보물상자: 미개봉=닫힌 상자(숫자 없음), 개봉=금화 + 경험치(수확 대기)
    if (cell.pickup === 'treasure' && !cell.collected) {
      if (!cell.revealed) {
        rect.setFillStyle(COLORS.hidden);
        rect.setStrokeStyle(1, COLORS.border);
        if (cell.note !== undefined) icon.setText(String(cell.note)).setColor('#e6c07a').setFontSize(16).setPosition(sx, sy);
        return;
      }
      if (!cell.dead) {
        rect.setFillStyle(COLORS.treasureFill);
        rect.setStrokeStyle(2, COLORS.treasureEdge);
        icon.setText('📦').setFontSize(20).setPosition(sx, sy);
      } else {
        rect.setFillStyle(COLORS.corpseTile);
        rect.setStrokeStyle(2, COLORS.gold);
        icon.setText('🪙').setFontSize(20).setPosition(sx, sy - 7);
        text.setText(`+${TREASURE_EXP}`).setColor(COLORS.goldText).setFontSize(12).setPosition(sx, sy + 13);
      }
      return;
    }

    // 새로고침 두루마리: 미공개=닫힘, 공개(정찰)=두루마리, 개봉=발동 대기(클릭 시 새로고침)
    if (cell.pickup === 'reroll' && !cell.collected) {
      if (!cell.revealed) {
        rect.setFillStyle(COLORS.hidden);
        rect.setStrokeStyle(1, COLORS.border);
        if (cell.note !== undefined) icon.setText(String(cell.note)).setColor('#e6c07a').setFontSize(16).setPosition(sx, sy);
        return;
      }
      rect.setFillStyle(COLORS.rerollFill);
      rect.setStrokeStyle(2, COLORS.rerollEdge);
      icon.setText('🔄').setFontSize(20).setPosition(sx, cell.dead ? sy - 7 : sy);
      if (cell.dead) text.setText('새로고침').setColor('#c9a6ff').setFontSize(11).setPosition(sx, sy + 13);
      return;
    }

    // 보석/라이프: 발견된 것만 아이콘, 미발견은 일반 타일
    if ((cell.pickup === 'gem' || cell.pickup === 'life') && !cell.pickupUsed) {
      if (cell.revealed) {
        const style = PICKUP_STYLE[cell.pickup];
        rect.setFillStyle(style.fill);
        rect.setStrokeStyle(2, style.stroke);
        icon.setText(style.glyph).setColor(style.glyphColor).setFontSize(22).setPosition(sx, sy);
      } else {
        rect.setFillStyle(COLORS.hidden);
        rect.setStrokeStyle(1, COLORS.border);
        if (cell.note !== undefined) icon.setText(String(cell.note)).setColor('#e6c07a').setFontSize(16).setPosition(sx, sy);
      }
      return;
    }

    // 미공개(활성) 칸 — 일반 타일 (메모 표시)
    if (!cell.revealed) {
      rect.setFillStyle(COLORS.hidden);
      rect.setStrokeStyle(1, COLORS.border);
      if (cell.note !== undefined) icon.setText(String(cell.note)).setColor('#e6c07a').setFontSize(16).setPosition(sx, sy);
      return;
    }

    if (cell.content === 'monster') {
      const def = getMonster(cell.monsterId!);
      const isDragon = cell.monsterId === 'dragon';
      const alive = !cell.dead; // 드래곤도 처치되면 시신(◆ 보상) → 수확 → 왕관 순서.
      if (alive) {
        rect.setFillStyle(COLORS.monsterTile);
        rect.setStrokeStyle(isDragon ? 2 : 1, COLORS.border);
        // 쥐는 쥐왕이 있는 열 방향(←/→/↕)을 아이콘 옆에 표시(방향 단서).
        if (cell.monsterId === 'rat' && cell.facesColumn !== undefined) {
          this.drawRatIcon(icon, def.glyph, cell.facesColumn, x, sx, sy, 1);
        } else {
          icon.setText(def.glyph).setFontSize(isDragon ? 24 : 20).setPosition(sx, sy - 7);
        }
        text.setText(String(def.level)).setColor(COLORS.goldText).setFontSize(13).setPosition(sx, sy + 13);
        return;
      }
      if (!cell.collected) {
        // 미수확 시신: 골드 테두리 유지(처치 표식) + 숫자 왼쪽 ◆ 로 '수확할 보상 있음' 표시.
        rect.setFillStyle(COLORS.corpseTile);
        rect.setStrokeStyle(2, cell.killer ? COLORS.danger : COLORS.gold);
        // 시신이 된 쥐도 방향 단서는 유지(쥐왕을 아직 못 찾았을 수 있으므로).
        if (cell.monsterId === 'rat' && cell.facesColumn !== undefined) {
          this.drawRatIcon(icon, def.glyph, cell.facesColumn, x, sx, sy, 0.55);
        } else {
          icon.setText(def.glyph).setFontSize(18).setAlpha(0.55).setPosition(sx, sy - 7);
        }
        text.setText(`◆${cell.rewardOverride ?? def.level}`).setColor(COLORS.goldText).setFontSize(13).setPosition(sx, sy + 13);
        return;
      }
    }

    // 숫자 타일 — 비활성처럼 흐리게 + 단일 색. 0이면 미표기.
    rect.setFillStyle(COLORS.numbered);
    rect.setStrokeStyle(1, COLORS.numberedBorder);
    // 슬라임에 인접한 칸은 합이 가려져 '?'로만 보인다(소환술사 군집의 안개).
    if (this.adjacentToAliveSlime(x, y)) {
      text.setText('?').setColor('#7fd6a0').setFontSize(18);
    } else if (cell.adjacencySum > 0) {
      text.setText(String(cell.adjacencySum)).setColor(COLORS.numberText).setFontSize(18);
    }
  }

  /** 해당 칸이 살아있는 슬라임과 8방향으로 인접하는가(숫자 가림 판정). */
  private adjacentToAliveSlime(x: number, y: number): boolean {
    const st = this.engine.state;
    return neighbors8(x, y, st.width, st.height).some((p) => {
      const nc = this.engine.cellAt(p.x, p.y);
      return nc.content === 'monster' && nc.monsterId === 'slime' && !nc.dead;
    });
  }

  /** 쥐 아이콘 + 쥐왕 방향 화살표(←/→/↕)를 아이콘 옆에 그린다. */
  private drawRatIcon(icon: Phaser.GameObjects.Text, glyph: string, facesColumn: number, x: number, sx: number, sy: number, alpha: number): void {
    const left = facesColumn < x;
    const arrow = left ? '←' : facesColumn > x ? '→' : '↕';
    icon.setText(left ? `${arrow}${glyph}` : `${glyph}${arrow}`).setColor('#5fd6ea').setFontSize(18).setAlpha(alpha).setPosition(sx, sy - 7);
  }

  private redrawBackpack(): void {
    const bp = this.engine.state.backpack;
    const editable = this.tab === 'bag' && this.engine.state.phase === 'playing';
    const canUnlock = editable && this.engine.state.pendingSculptCells > 0;
    for (let y = 0; y < bp.height; y++) {
      for (let x = 0; x < bp.width; x++) {
        const c = bp.cells[y * bp.width + x];
        const rect = this.bpRects[y * bp.width + x];
        // 빨간(튀어나온) 칸 색 제거 — 활성은 모두 동일, 비활성은 잠금.
        rect.setFillStyle(c.active ? COLORS.bpActive : COLORS.bpInactive);
        rect.setStrokeStyle(1, c.active ? COLORS.border : COLORS.numberedBorder);
        if (canUnlock && !c.active) rect.setStrokeStyle(1, COLORS.gold); // 확장 가능 칸 강조
      }
    }

    this.itemLayer.removeAll(true);

    // 비활성 칸은 흐림 대신 자물쇠로 표시(확장 가능하면 골드 열쇠).
    for (let y = 0; y < bp.height; y++) {
      for (let x = 0; x < bp.width; x++) {
        const c = bp.cells[y * bp.width + x];
        if (c.active) continue;
        const sx = BP_ORIGIN.x + x * BP_CELL + BP_CELL / 2;
        const sy = BP_ORIGIN.y + y * BP_CELL + BP_CELL / 2;
        const unlockable = canUnlock && this.bpUnlockable(x, y);
        this.itemLayer.add(
          this.add
            .text(sx, sy, unlockable ? '🔓' : '🔒', { fontFamily: FONT, fontSize: '17px', color: COLORS.textFaint })
            .setOrigin(0.5)
            .setAlpha(unlockable ? 1 : 0.5),
        );
      }
    }
    bp.items.forEach((pl, idx) => {
      const def = getItem(pl.itemId);
      const dragging = this.dragItemIdx === idx;
      const dorigin = dragging ? this.dragOrigin()! : pl.origin;
      const cells = absoluteCells(bp, { itemId: pl.itemId, origin: dorigin, rotation: pl.rotation }, getItem);
      const valid = !dragging || canPlace(bp, def, dorigin, pl.rotation, getItem, idx);
      for (const cc of cells) {
        const sx = BP_ORIGIN.x + cc.x * BP_CELL + BP_CELL / 2;
        const sy = BP_ORIGIN.y + cc.y * BP_CELL + BP_CELL / 2;
        const r = this.add
          .rectangle(sx, sy, BP_CELL - 8, BP_CELL - 8, def.color, dragging ? 0.75 : 0.9)
          .setInteractive();
        if (dragging) r.setStrokeStyle(3, valid ? 0x6ad08a : 0xe0563a);
        else r.setStrokeStyle(1, 0x10131d);
        r.on('pointerover', () => this.showTooltip(def, sx, sy));
        r.on('pointerout', () => this.hideTooltip());
        this.itemLayer.add(r);
      }
      const head = cells[0];
      this.itemLayer.add(
        this.add
          .text(BP_ORIGIN.x + head.x * BP_CELL + BP_CELL / 2, BP_ORIGIN.y + head.y * BP_CELL + BP_CELL / 2, def.glyph, {
            fontFamily: FONT,
            fontSize: '18px',
            color: '#120d06',
          })
          .setOrigin(0.5),
      );
    });
  }

  private redrawHud(): void {
    const st = this.engine.state;
    const s = this.syn ?? this.engine.getSynergy();
    const BAR = 150;
    this.hpBarFill.setSize((BAR * Math.max(0, st.hp)) / Math.max(1, st.maxHp), 14);
    this.hpText.setText(`${st.hp} / ${st.maxHp}`);
    const cost = this.engine.levelUpCostNow();
    this.vitBarFill.setSize((BAR * Math.min(st.vitalityForLevel, cost)) / cost, 14);
    this.vitText.setText(`Lv ${st.level} · 다음 ${Math.max(0, cost - st.vitalityForLevel)}`);

    if (st.phase === 'lost') {
      this.levelUpBtn.setText('  💀 죽음 — 다시하기  ').setBackgroundColor('#e0563a').setColor('#160a08');
    } else if (st.phase === 'won') {
      this.levelUpBtn.setText('  🏆 승리! — 다시하기  ').setBackgroundColor('#e7b65a').setColor('#1a1208');
    } else if (this.engine.canLevelUp()) {
      this.levelUpBtn.setText('  ▲ 레벨업 — 풀피 회복  ').setBackgroundColor('#e7b65a').setColor('#1a1208');
    } else {
      this.levelUpBtn.setText(`  레벨업까지 ${Math.max(0, cost - st.vitalityForLevel)}  `).setBackgroundColor('#232a38').setColor('#8b93a6');
    }

    this.goldText.setText(`골드 ${st.gold}`);
    // 남은 가드(쓰면 줄어듦) / 총 가드(아이템 수)
    this.guardText.setText(`가드 ${st.misclickGuards}/${s.misclickGuards}`);

    // 모든 가방 보상 효과는 골드로 통합. (트랙 A 생존은 가방 무관)
    this.synText.setText(
      [
        `골드 환율 +${Math.round(s.goldRateSum * 100)}%   ·   Lv당 골드 +${s.scorePerLvSum.toFixed(1)}`,
        `센 몹 골드 +${Math.round(s.goldLvScaleSum * 100)}%×Lv   ·   여백 골드 +${s.voidScoreFlat}`,
        `격리 골드 +${Math.round(s.isolationBonus * 100)}%`,
        `조형칸 ${st.pendingSculptCells}   ·   남은 구역 ${st.clearedZones.filter((z) => !z).length}`,
      ].join('\n'),
    );
  }

  private redrawShop(): void {
    this.shopContent.removeAll(true);
    const st = this.engine.state;
    const X = LAYOUT.playerPanel.x + 16;
    this.shopContent.add(
      this.add.text(X, 288, `상점   ·   보유 골드 ${st.gold}`, { fontFamily: FONT, fontSize: '15px', color: COLORS.goldText }).setOrigin(0, 0.5),
    );
    let y = 316;
    for (const entry of this.shop) {
      this.shopContent.add(this.makeShopCard(X, y, entry));
      y += 80;
    }
    this.shopContent.add(this.makeExpansionCard(X, y));
    y += 80;
    this.shopContent.add(
      this.add.text(X, y + 4, '아이템 매물은 맵의 🔄 두루마리로만 새로고침. 칸 확장은 언제든 구매 가능.', {
        fontFamily: FONT,
        fontSize: '12px',
        color: COLORS.textFaint,
        wordWrap: { width: 372 },
      }),
    );
  }

  /** 가방 칸 확장 판매 카드(레벨업 자동 지급 대신 상점 구매). */
  private expansionCost(): number {
    const arr = balance.backpack.sculptGoldCost as number[];
    return arr[Math.min(this.cellsPurchased, arr.length - 1)];
  }

  private makeExpansionCard(x: number, y: number): Phaser.GameObjects.Container {
    const w = 372;
    const h = 70;
    const cost = this.expansionCost();
    const affordable = this.engine.state.gold >= cost;
    const c = this.add.container(x, y);
    const box = this.add
      .rectangle(0, 0, w, h, COLORS.bpActive)
      .setOrigin(0, 0)
      .setStrokeStyle(1, affordable ? COLORS.gold : COLORS.border)
      .setInteractive({ useHandCursor: true });
    const name = this.add.text(12, 11, '🔓 가방 칸 확장', { fontFamily: FONT, fontSize: '16px', color: COLORS.text });
    const price = this.add.text(w - 12, 11, `${cost} G`, { fontFamily: FONT, fontSize: '15px', color: affordable ? COLORS.goldText : COLORS.textFaint }).setOrigin(1, 0);
    const desc = this.add.text(12, 36, '잠긴 칸 1개를 열 권리를 얻어요. 구매 후 가방에서 🔓 칸을 클릭하세요.', {
      fontFamily: FONT,
      fontSize: '12px',
      color: COLORS.textDim,
      wordWrap: { width: w - 24 },
      lineSpacing: 2,
    });
    c.add([box, name, price, desc]);
    box.on('pointerover', () => box.setFillStyle(0x252d3c));
    box.on('pointerout', () => box.setFillStyle(COLORS.bpActive));
    box.on('pointerdown', () => this.buyExpansion());
    return c;
  }

  private buyExpansion(): void {
    const st = this.engine.state;
    const cost = this.expansionCost();
    if (st.gold < cost) {
      this.floatText(790, 130, '골드가 부족해요', COLORS.goldText, 18);
      this.cameras.main.shake(60, 0.0015);
      return;
    }
    st.gold -= cost;
    st.pendingSculptCells += 1;
    this.cellsPurchased += 1;
    this.floatText(790, 130, '칸 확장권 +1 — 가방의 🔓 칸을 누르세요', '#e7b65a', 16);
    this.redrawShop();
    this.redrawAll();
  }

  /** 매물 생성 — 새로고침 횟수(shopRolls)를 시드로 사용해 두루마리 사용 시에만 바뀐다. */
  private rollShop(): void {
    const rng = new Rng(((this.shopRolls + 1) * 2654435761) >>> 0 || 0x1234);
    this.shop = rng
      .shuffle([...ITEM_POOL])
      .slice(0, 3)
      .map((item) => ({ item, cost: SHOP_COST[item.category] ?? 30, sold: false }));
  }

  private makeShopCard(x: number, y: number, entry: ShopEntry): Phaser.GameObjects.Container {
    const w = 372;
    const h = 70;
    const c = this.add.container(x, y);

    // 이미 구매한 칸 — 골드 테두리 제거 + 흐리게 + SOLD OUT 표기(구매 불가 명확화).
    if (entry.sold) {
      const box = this.add.rectangle(0, 0, w, h, COLORS.bpInactive).setOrigin(0, 0).setStrokeStyle(1, COLORS.border);
      const name = this.add.text(12, 11, entry.item.name, { fontFamily: FONT, fontSize: '16px', color: COLORS.textFaint });
      const sold = this.add.text(w - 12, 11, 'SOLD OUT', { fontFamily: FONT, fontSize: '14px', color: '#6a7283' }).setOrigin(1, 0);
      const desc = this.add.text(12, 36, entry.item.desc, { fontFamily: FONT, fontSize: '12px', color: COLORS.textFaint, wordWrap: { width: w - 24 }, lineSpacing: 2 }).setAlpha(0.6);
      c.add([box, name, sold, desc]);
      return c;
    }

    const affordable = this.engine.state.gold >= entry.cost;
    const box = this.add.rectangle(0, 0, w, h, COLORS.bpActive).setOrigin(0, 0).setStrokeStyle(1, affordable ? COLORS.gold : COLORS.border).setInteractive({ useHandCursor: true });
    const name = this.add.text(12, 11, entry.item.name, { fontFamily: FONT, fontSize: '16px', color: COLORS.text });
    const cost = this.add.text(w - 12, 11, `${entry.cost} G`, { fontFamily: FONT, fontSize: '15px', color: affordable ? COLORS.goldText : COLORS.textFaint }).setOrigin(1, 0);
    const desc = this.add.text(12, 36, entry.item.desc, { fontFamily: FONT, fontSize: '12px', color: COLORS.textDim, wordWrap: { width: w - 24 }, lineSpacing: 2 });
    c.add([box, name, cost, desc]);
    box.on('pointerover', () => box.setFillStyle(0x252d3c));
    box.on('pointerout', () => box.setFillStyle(COLORS.bpActive));
    box.on('pointerdown', () => this.buyItem(entry));
    return c;
  }

  private redrawCensus(): void {
    this.censusContent.removeAll(true);
    const X = LAYOUT.playerPanel.x + 16;
    const counts = new Map<string, number>();
    for (const cell of this.engine.state.board) {
      if (cell.content === 'monster' && !cell.dead) counts.set(cell.monsterId!, (counts.get(cell.monsterId!) ?? 0) + 1);
    }
    const rows = [...counts.entries()].map(([id, n]) => ({ def: getMonster(id), n })).sort((a, b) => a.def.level - b.def.level);
    const total = rows.reduce((s, r) => s + r.n, 0);

    this.sectionHeader(this.censusContent, X, 288, LAYOUT.playerPanel.w - 32, '남은 몹  ·  D = 데미지');

    // 도감 스타일 2열 — [D{레벨}] [아이콘 슬랩] [×개수]
    const perCol = Math.ceil(rows.length / 2);
    const colX = [X, X + 244];
    const top = 322;
    const rowH = 34;
    rows.forEach((r, idx) => {
      const cx = colX[Math.floor(idx / perCol)];
      const cy = top + (idx % perCol) * rowH;
      const isDragon = r.def.id === 'dragon';

      this.censusContent.add(
        this.add
          .text(cx, cy, `D${r.def.level}`, {
            fontFamily: FONT,
            fontSize: '14px',
            color: isDragon ? '#ff6b78' : COLORS.textDim,
          })
          .setOrigin(0, 0.5),
      );

      const slab = this.add
        .rectangle(cx + 54, cy, 30, 30, COLORS.numbered)
        .setStrokeStyle(1.5, isDragon ? COLORS.ember : COLORS.goldDim)
        .setOrigin(0.5);
      const glyph = this.add.text(cx + 54, cy, r.def.glyph, { fontFamily: FONT, fontSize: '18px', color: COLORS.text }).setOrigin(0.5);
      const cnt = this.add
        .text(cx + 78, cy, `×${r.n}`, { fontFamily: FONT, fontSize: '15px', color: isDragon ? '#ff6b78' : COLORS.text })
        .setOrigin(0, 0.5);
      this.censusContent.add([slab, glyph, cnt]);
    });

    this.censusContent.add(
      this.add
        .text(X, top + perCol * rowH + 6, `남은 몹 합계  ${total}마리`, { fontFamily: FONT, fontSize: '14px', color: COLORS.text })
        .setOrigin(0, 0.5),
    );
  }

  // ----------------------------- 타이머 -----------------------------

  private fmtTime(ms: number): string {
    const s = Math.floor(ms / 1000);
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  update(time: number): void {
    if (!this.timeText) return;
    const phase = this.engine.state.phase as string;
    const ended = phase === 'won' || phase === 'lost';
    if (ended && this.endMs === null) this.endMs = time - this.startMs;
    const elapsed = ended ? (this.endMs ?? 0) : time - this.startMs;
    this.timeText.setText(`⏱ ${this.fmtTime(elapsed)}`);
    if (ended) this.timeText.setColor(phase === 'won' ? COLORS.goldText : '#ff6b78');
  }
}
