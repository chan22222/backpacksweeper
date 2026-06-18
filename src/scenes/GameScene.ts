import Phaser from 'phaser';
import { BOARD_ORIGIN, BP_CELL, BP_ORIGIN, COLORS, FONT, TILE, VIEW } from '../config';
import { Game, type ClickResult } from '../core/game';
import { absoluteCells, bpCell, canPlace } from '../core/backpack';
import type { SynergyResult } from '../core/backpack';
import { getItem, getMonster, ITEM_POOL } from '../data';
import { Rng } from '../core/rng';
import type { ItemDef } from '../core/types';

interface ShopEntry {
  item: ItemDef;
  cost: number;
  sold: boolean;
}

const SHOP_COST: Record<string, number> = {
  weapon: 30,
  relic: 40,
  defense: 25,
  special: 35,
};


export class GameScene extends Phaser.Scene {
  private engine!: Game;

  private cellRects: Phaser.GameObjects.Rectangle[] = [];
  private cellText: Phaser.GameObjects.Text[] = [];
  private cellIcon: Phaser.GameObjects.Text[] = [];

  private bpRects: Phaser.GameObjects.Rectangle[] = [];
  private itemLayer!: Phaser.GameObjects.Container;
  private fxLayer!: Phaser.GameObjects.Container;
  private campLayer!: Phaser.GameObjects.Container;

  private hpBarFill!: Phaser.GameObjects.Rectangle;
  private vitBarFill!: Phaser.GameObjects.Rectangle;
  private hpText!: Phaser.GameObjects.Text;
  private vitText!: Phaser.GameObjects.Text;
  private goldText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private guardText!: Phaser.GameObjects.Text;
  private synText!: Phaser.GameObjects.Text;
  private campHintText!: Phaser.GameObjects.Text;
  private levelUpBtn!: Phaser.GameObjects.Text;
  private censusBtn!: Phaser.GameObjects.Text;
  private censusModal?: Phaser.GameObjects.Container;
  private notePopup?: Phaser.GameObjects.Container;

  private selectedItem: number | null = null;
  private shop: ShopEntry[] = [];
  private campOpen = false;
  private lastClick = { x: 0, y: 0 };

  constructor() {
    super('GameScene');
  }

  create(data?: { seed?: number }): void {
    this.input.enabled = true;
    const seed = (data?.seed ?? (Date.now() & 0x7fffffff)) || 0xc0ffee;
    this.engine = new Game(seed);
    this.cellRects = [];
    this.cellText = [];
    this.cellIcon = [];
    this.bpRects = [];
    this.selectedItem = null;
    this.campOpen = false;
    this.censusModal = undefined;
    this.notePopup = undefined;

    this.input.mouse?.disableContextMenu();

    this.add.rectangle(VIEW.width / 2, VIEW.height / 2, VIEW.width, VIEW.height, COLORS.bg);

    this.buildBoard();
    this.buildBackpack();
    this.buildHud();

    this.fxLayer = this.add.container(0, 0);
    this.campLayer = this.add.container(0, 0).setDepth(50).setVisible(false);

    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.keyboard?.on('keydown-R', () => this.rotateSelected());
    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.campOpen) this.closeCamp();
    });

    this.redrawAll();
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
        rect.on('pointerdown', (pointer: Phaser.Input.Pointer) =>
          this.onCellPointer(x, y, pointer.rightButtonDown()),
        );
        rect.on('pointerover', () => {
          const cc = this.engine.cellAt(x, y);
          if (this.engine.state.phase === 'playing' && !cc.revealed && !(cc.gem && !cc.gemUsed)) {
            rect.setFillStyle(COLORS.hiddenHover);
          }
        });
        rect.on('pointerout', () => this.redrawCell(x, y));
        this.cellRects.push(rect);

        this.cellText.push(
          this.add.text(sx, sy, '', { fontFamily: FONT, fontSize: '20px', color: COLORS.text }).setOrigin(0.5),
        );
        this.cellIcon.push(
          this.add.text(sx, sy - 7, '', { fontFamily: FONT, fontSize: '18px', color: COLORS.text }).setOrigin(0.5),
        );
      }
    }
  }

  private buildBackpack(): void {
    const bp = this.engine.state.backpack;
    this.add.text(BP_ORIGIN.x, BP_ORIGIN.y - 34, '가방 (캠프에서 편집)', {
      fontFamily: FONT,
      fontSize: '18px',
      color: COLORS.textDim,
    });

    for (let y = 0; y < bp.height; y++) {
      for (let x = 0; x < bp.width; x++) {
        const sx = BP_ORIGIN.x + x * BP_CELL + BP_CELL / 2;
        const sy = BP_ORIGIN.y + y * BP_CELL + BP_CELL / 2;
        const rect = this.add.rectangle(sx, sy, BP_CELL - 4, BP_CELL - 4, COLORS.bpActive).setStrokeStyle(1, COLORS.border);
        this.bpRects.push(rect);
      }
    }
    this.itemLayer = this.add.container(0, 0);
  }

  private buildHud(): void {
    const X = 500;
    let y = 30;
    this.add.text(X, y, '자원', { fontFamily: FONT, fontSize: '16px', color: COLORS.textDim });
    y += 26;

    // HP bar
    this.add.text(X, y, 'HP', { fontFamily: FONT, fontSize: '14px', color: '#ff9aa2' });
    this.add.rectangle(X + 40, y + 9, 260, 16, 0x2a2f3a).setOrigin(0, 0.5);
    this.hpBarFill = this.add.rectangle(X + 40, y + 9, 260, 16, COLORS.hp).setOrigin(0, 0.5);
    this.hpText = this.add.text(X + 310, y, '', { fontFamily: FONT, fontSize: '14px', color: COLORS.text });
    y += 30;

    // Vitality bar (성장 — 레벨업 비용까지 누적)
    this.add.text(X, y, '성장', { fontFamily: FONT, fontSize: '14px', color: '#9be7b4' });
    this.add.rectangle(X + 40, y + 9, 260, 16, 0x2a2f3a).setOrigin(0, 0.5);
    this.vitBarFill = this.add.rectangle(X + 40, y + 9, 0, 16, COLORS.vitality).setOrigin(0, 0.5);
    this.vitText = this.add.text(X + 310, y, '', { fontFamily: FONT, fontSize: '14px', color: COLORS.text });
    y += 32;

    // 레벨업 버튼 — 자동이 아니라 유저가 직접(HP를 쓰다가 원할 때 풀피 회복 + 최대HP↑)
    this.levelUpBtn = this.add
      .text(X, y, '', {
        fontFamily: FONT,
        fontSize: '16px',
        color: '#0b0b12',
        backgroundColor: '#2a2f3a',
        padding: { x: 14, y: 7 },
        fontStyle: 'bold',
      })
      .setInteractive({ useHandCursor: true });
    this.levelUpBtn.on('pointerdown', () => this.tryLevelUp());
    y += 42;

    this.goldText = this.add.text(X, y, '', { fontFamily: FONT, fontSize: '16px', color: '#f4c430' });
    this.scoreText = this.add.text(X + 150, y, '', { fontFamily: FONT, fontSize: '16px', color: '#6cb6ff' });
    y += 24;
    this.guardText = this.add.text(X, y, '', { fontFamily: FONT, fontSize: '16px', color: '#9aa7ff' });
    y += 30;

    this.add.text(X, y, '가방 효과', { fontFamily: FONT, fontSize: '14px', color: COLORS.textDim });
    y += 22;
    this.synText = this.add.text(X, y, '', {
      fontFamily: FONT,
      fontSize: '13px',
      color: '#c8cee0',
      lineSpacing: 4,
      wordWrap: { width: 560 },
    });
    y += 70;

    // 남은 몹 census 모달 버튼
    this.censusBtn = this.add
      .text(X, y, '  📖 남은 몹 보기  ', {
        fontFamily: FONT,
        fontSize: '15px',
        color: '#0b0b12',
        backgroundColor: '#9b5de5',
        padding: { x: 12, y: 6 },
        fontStyle: 'bold',
      })
      .setInteractive({ useHandCursor: true });
    this.censusBtn.on('pointerdown', () => this.toggleCensus());

    this.campHintText = this.add
      .text(VIEW.width - 20, VIEW.height - 16, '', { fontFamily: FONT, fontSize: '13px', color: '#5a6172' })
      .setOrigin(1, 1);
  }

  // ----------------------------- input -----------------------------

  /** 보드 셀 입력(셀별 핸들러 — topOnly 라 팝업/모달이 위에 있으면 가려져 발동 안 함). */
  private onCellPointer(x: number, y: number, right: boolean): void {
    if (this.engine.state.phase !== 'playing') return;
    if (right) {
      this.openNotePopup(x, y);
      return;
    }
    this.lastClick = { x, y };
    this.handleResult(this.engine.click(x, y));
  }

  /** 씬 레벨 입력 — 캠프 중 가방 편집만 담당. */
  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.campOpen) return;
    const st = this.engine.state;
    const gx = Math.floor((pointer.x - BP_ORIGIN.x) / BP_CELL);
    const gy = Math.floor((pointer.y - BP_ORIGIN.y) / BP_CELL);
    if (gx >= 0 && gy >= 0 && gx < st.backpack.width && gy < st.backpack.height) {
      this.onCampCellClick(gx, gy, pointer.rightButtonDown());
    }
  }

  // ----------------------------- result/FX -----------------------------

  private handleResult(res: ClickResult): void {
    const st = this.engine.state;
    switch (res.kind) {
      case 'revealed':
        this.redrawAll();
        this.animateReveal(res.cells);
        break;
      case 'guarded': {
        const c = this.cellScreen(res.pos.x, res.pos.y);
        this.floatText(c.x, c.y, '가드! 입력 취소', '#9aa7ff');
        this.cameras.main.shake(90, 0.002);
        this.redrawAll();
        break;
      }
      case 'defeat': {
        const c = this.cellScreen(res.pos.x, res.pos.y);
        this.cameras.main.shake(120, res.hpCost > 0 ? 0.003 : 0.0015);
        this.floatText(c.x, c.y - 4, `-${res.hpCost}`, '#ff5a5a');
        if (res.zoneCleared !== null) {
          this.floatText(VIEW.width / 2, 100, `구역 ${res.zoneCleared + 1} 클리어 — 풀 캠프!`, '#ffd166', 34);
        }
        if (st.phase === 'won' || st.phase === 'lost') {
          // 모달 없이 전체 맵만 공개 — 레벨업 버튼이 '다시하기'로 바뀐다.
          if (st.phase === 'lost') this.cameras.main.shake(260, 0.009);
          this.engine.revealAll();
          this.redrawAll();
        } else if (st.phase === 'full-camp') {
          this.redrawAll();
          this.time.delayedCall(250, () => this.openCamp());
        } else {
          this.redrawAll();
        }
        break;
      }
      case 'collect': {
        const c = this.cellScreen(res.pos.x, res.pos.y);
        this.floatText(c.x - 14, c.y - 4, `+${res.vitality} EXP`, '#9be7b4', 22);
        if (res.gold > 0) this.floatText(c.x + 20, c.y - 4, `+${res.gold}G`, '#f4c430', 20);
        if (res.score > 0) this.floatText(c.x + 20, c.y + 16, `+${res.score}`, '#6cb6ff', 20);
        this.redrawAll();
        break;
      }
      default:
        break;
    }
  }

  private floatText(x: number, y: number, str: string, color: string, size = 22): void {
    const t = this.add
      .text(x, y, str, { fontFamily: FONT, fontSize: `${size}px`, color, fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(60);
    this.fxLayer.add(t);
    this.tweens.add({
      targets: t,
      y: y - 42,
      alpha: 0,
      duration: 850,
      ease: 'Cubic.out',
      onComplete: () => t.destroy(),
    });
  }

  private flashScreen(): void {
    const f = this.add.rectangle(VIEW.width / 2, VIEW.height / 2, VIEW.width, VIEW.height, 0xffffff).setDepth(55);
    this.tweens.add({ targets: f, alpha: 0, duration: 320, onComplete: () => f.destroy() });
  }

  /** 공개된 칸들을 클릭 지점에서 거리순으로 펼쳐지게(오브 정찰 연출). */
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

  /** 레벨업 버튼: 진행 중엔 레벨업, 게임 끝(승/패)엔 다시하기. */
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
    this.floatText(bx, by, `LEVEL UP!  Lv${r.level}  ·  HP ${r.maxHp} 완전회복`, '#52b788', 30);
    if (r.burstGold > 0) this.floatText(bx, by + 30, `버스트 +${r.burstGold}G`, '#f4c430', 24);
    this.redrawAll();
  }

  // ----------------------------- 우클릭 숫자 메모 -----------------------------

  private openNotePopup(x: number, y: number): void {
    this.closeNotePopup();
    this.closeCensus();
    if (this.engine.cellAt(x, y).revealed) return;

    const c = this.add.container(0, 0).setDepth(90);
    const blocker = this.add
      .rectangle(VIEW.width / 2, VIEW.height / 2, VIEW.width, VIEW.height, 0x000000, 0.001)
      .setInteractive();
    blocker.on('pointerdown', () => this.closeNotePopup());
    c.add(blocker);

    const opts: Array<number | null> = [0, 1, 4, 5, 8, 11, 15, null];
    const cols = 4;
    const bw = 42;
    const bh = 34;
    const pad = 6;
    const rows = Math.ceil(opts.length / cols);
    const panelW = cols * bw + (cols + 1) * pad;
    const panelH = rows * bh + (rows + 1) * pad + 22;
    let px = BOARD_ORIGIN.x + x * TILE + TILE / 2;
    let py = BOARD_ORIGIN.y + y * TILE - panelH / 2;
    px = Phaser.Math.Clamp(px, panelW / 2 + 8, VIEW.width - panelW / 2 - 8);
    py = Phaser.Math.Clamp(py, panelH / 2 + 8, VIEW.height - panelH / 2 - 8);

    const panel = this.add.rectangle(px, py, panelW, panelH, COLORS.panel, 0.98).setStrokeStyle(2, 0x3a4150);
    const title = this.add
      .text(px, py - panelH / 2 + 12, '메모: 숫자 지정', { fontFamily: FONT, fontSize: '12px', color: '#8a90a0' })
      .setOrigin(0.5);
    c.add([panel, title]);

    const x0 = px - panelW / 2 + pad + bw / 2;
    const y0 = py - panelH / 2 + 22 + pad + bh / 2;
    opts.forEach((v, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const bxp = x0 + col * (bw + pad);
      const byp = y0 + row * (bh + pad);
      const clear = v === null;
      const btn = this.add
        .rectangle(bxp, byp, bw, bh, clear ? 0x4a2030 : 0x222732)
        .setStrokeStyle(1, COLORS.border)
        .setInteractive({ useHandCursor: true });
      const lab = this.add
        .text(bxp, byp, clear ? '지움' : String(v), {
          fontFamily: FONT,
          fontSize: '15px',
          color: clear ? '#ff9aa2' : '#e8eaf0',
        })
        .setOrigin(0.5);
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

  // ----------------------------- 남은 몹 census 모달 -----------------------------

  private toggleCensus(): void {
    if (this.censusModal) this.closeCensus();
    else this.openCensus();
  }

  private openCensus(): void {
    this.closeNotePopup();
    this.closeCensus();
    const counts = new Map<string, number>();
    for (const cell of this.engine.state.board) {
      if (cell.content === 'monster' && !cell.dead) {
        counts.set(cell.monsterId!, (counts.get(cell.monsterId!) ?? 0) + 1);
      }
    }
    const rows = [...counts.entries()]
      .map(([id, n]) => ({ def: getMonster(id), n }))
      .sort((a, b) => a.def.level - b.def.level);

    const c = this.add.container(0, 0).setDepth(95);
    const blocker = this.add
      .rectangle(VIEW.width / 2, VIEW.height / 2, VIEW.width, VIEW.height, 0x05060a, 0.55)
      .setInteractive();
    blocker.on('pointerdown', () => this.closeCensus());
    c.add(blocker);

    const cx = VIEW.width / 2;
    const cy = VIEW.height / 2;
    const w = 380;
    const h = 92 + rows.length * 30;
    const panel = this.add.rectangle(cx, cy, w, h, COLORS.panel, 0.99).setStrokeStyle(2, 0x9b5de5);
    const title = this.add
      .text(cx, cy - h / 2 + 24, '맵에 남은 몹', { fontFamily: FONT, fontSize: '22px', color: '#cdb4db', fontStyle: 'bold' })
      .setOrigin(0.5);
    c.add([panel, title]);

    let ry = cy - h / 2 + 60;
    for (const r of rows) {
      const line = this.add
        .text(cx, ry, `${r.def.glyph}  ${r.def.name}  (Lv${r.def.level})      × ${r.n}`, {
          fontFamily: FONT,
          fontSize: '17px',
          color: r.def.id === 'dragon' ? '#ff6b78' : COLORS.text,
        })
        .setOrigin(0.5);
      c.add(line);
      ry += 30;
    }
    c.add(
      this.add
        .text(cx, cy + h / 2 - 16, '아무 곳이나 클릭하면 닫힘', { fontFamily: FONT, fontSize: '12px', color: '#5a6172' })
        .setOrigin(0.5),
    );
    this.censusModal = c;
  }

  private closeCensus(): void {
    if (this.censusModal) {
      this.censusModal.destroy(true);
      this.censusModal = undefined;
    }
  }

  // ----------------------------- camp -----------------------------

  private openCamp(): void {
    const st = this.engine.state;
    this.campOpen = true;
    this.selectedItem = null;
    this.campLayer.removeAll(true);
    this.campLayer.setVisible(true);

    // 보드 흐리게
    const dim = this.add.rectangle(
      BOARD_ORIGIN.x - 8,
      BOARD_ORIGIN.y - 8,
      st.width * TILE + 12,
      st.height * TILE + 12,
      0x000000,
      0.45,
    ).setOrigin(0, 0);
    this.campLayer.add(dim);

    const isFull = st.phase === 'full-camp';
    const X = 1018;
    let y = 150;
    const title = this.add.text(X, y, isFull ? '풀 캠프 — 정비' : '미니 캠프 — 정비', {
      fontFamily: FONT,
      fontSize: '22px',
      color: '#ffd166',
      fontStyle: 'bold',
    });
    this.campLayer.add(title);
    y += 36;

    const instr = this.add.text(
      X,
      y,
      ['아이템 클릭 → 선택/이동', '우클릭/R → 회전', '비활성칸 클릭 → 조형'].join('\n'),
      { fontFamily: FONT, fontSize: '14px', color: '#c8cee0', lineSpacing: 6 },
    );
    this.campLayer.add(instr);
    y += 90;

    if (isFull) {
      const label = this.add.text(X, y, '상점', { fontFamily: FONT, fontSize: '16px', color: COLORS.textDim });
      this.campLayer.add(label);
      y += 26;
      this.rollShop();
      for (const entry of this.shop) {
        const btn = this.makeShopButton(X, y, entry);
        this.campLayer.add(btn);
        y += 64;
      }
      y += 6;
    }

    const cont = this.add
      .text(X, y + 10, '  계속 ▶  ', {
        fontFamily: FONT,
        fontSize: '24px',
        color: '#0b0b12',
        backgroundColor: '#52b788',
        padding: { x: 18, y: 10 },
        fontStyle: 'bold',
      })
      .setInteractive({ useHandCursor: true });
    cont.on('pointerover', () => cont.setScale(1.05));
    cont.on('pointerout', () => cont.setScale(1));
    cont.on('pointerdown', () => this.closeCamp());
    this.campLayer.add(cont);

    this.redrawAll();
  }

  private rollShop(): void {
    const rng = new Rng((this.engine.state.turn * 2654435761) >>> 0);
    const pool = rng.shuffle([...ITEM_POOL]);
    this.shop = pool.slice(0, 3).map((item) => ({
      item,
      cost: SHOP_COST[item.category] ?? 30,
      sold: false,
    }));
  }

  private makeShopButton(x: number, y: number, entry: ShopEntry): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const box = this.add.rectangle(0, 0, 250, 56, COLORS.panel).setOrigin(0, 0).setStrokeStyle(1, COLORS.border);
    const name = this.add.text(8, 6, `${entry.item.name}`, { fontFamily: FONT, fontSize: '15px', color: COLORS.text });
    const cost = this.add.text(242, 6, `${entry.cost}G`, { fontFamily: FONT, fontSize: '15px', color: '#f4c430' }).setOrigin(1, 0);
    const desc = this.add.text(8, 28, entry.item.desc, {
      fontFamily: FONT,
      fontSize: '11px',
      color: '#8a90a0',
      wordWrap: { width: 236 },
    });
    c.add([box, name, cost, desc]);
    box.setInteractive({ useHandCursor: true });
    box.on('pointerdown', () => this.buyItem(entry, box, name));
    return c;
  }

  private buyItem(entry: ShopEntry, box: Phaser.GameObjects.Rectangle, name: Phaser.GameObjects.Text): void {
    const st = this.engine.state;
    if (entry.sold || st.gold < entry.cost) {
      this.cameras.main.shake(60, 0.0015);
      return;
    }
    // 빈 자리에 자동 배치
    const placed = this.tryAutoPlace(entry.item);
    if (!placed) {
      this.floatText(VIEW.width / 2, 120, '가방에 공간이 없다', '#ff9f5a', 26);
      return;
    }
    st.gold -= entry.cost;
    entry.sold = true;
    box.setFillStyle(0x0e1016);
    name.setText(`${entry.item.name} (구매됨)`).setColor('#5a6172');
    this.engine.refreshGuards();
    this.redrawAll();
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

  private closeCamp(): void {
    this.engine.closeCamp();
    this.campOpen = false;
    this.selectedItem = null;
    this.campLayer.removeAll(true);
    this.campLayer.setVisible(false);
    this.redrawAll();
  }

  private onCampCellClick(gx: number, gy: number, right: boolean): void {
    const bp = this.engine.state.backpack;
    const cell = bpCell(bp, gx, gy);
    if (!cell) return;
    const itemIdx = bp.items.findIndex((pl) =>
      absoluteCells(bp, pl, getItem).some((p) => p.x === gx && p.y === gy),
    );

    if (right) {
      if (itemIdx >= 0) this.rotateItem(itemIdx);
      this.redrawAll();
      return;
    }

    if (this.selectedItem === null) {
      if (itemIdx >= 0) {
        this.selectedItem = itemIdx;
      } else if (!cell.active) {
        this.trySculpt(gx, gy);
      }
    } else {
      const pl = bp.items[this.selectedItem];
      const def = getItem(pl.itemId);
      if (def.fixed) {
        // 저주 등 이동 불가
        this.selectedItem = null;
      } else if (cell.active && canPlace(bp, def, { x: gx, y: gy }, pl.rotation, getItem, this.selectedItem)) {
        pl.origin = { x: gx, y: gy };
        this.selectedItem = null;
        this.engine.refreshGuards();
      } else if (itemIdx >= 0 && itemIdx !== this.selectedItem) {
        this.selectedItem = itemIdx;
      } else if (!cell.active) {
        this.trySculpt(gx, gy);
        this.selectedItem = null;
      } else {
        this.selectedItem = null;
      }
    }
    this.redrawAll();
  }

  private rotateSelected(): void {
    if (!this.campOpen || this.selectedItem === null) return;
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
    const bp = st.backpack;
    const cell = bpCell(bp, gx, gy);
    if (!cell || cell.active || st.pendingSculptCells <= 0) return;
    const adj = [
      bpCell(bp, gx, gy - 1),
      bpCell(bp, gx, gy + 1),
      bpCell(bp, gx - 1, gy),
      bpCell(bp, gx + 1, gy),
    ];
    if (adj.some((a) => a?.active)) {
      cell.active = true;
      st.pendingSculptCells--;
    }
  }

  // ----------------------------- redraw -----------------------------

  private cellScreen(x: number, y: number): { x: number; y: number } {
    return { x: BOARD_ORIGIN.x + x * TILE + TILE / 2, y: BOARD_ORIGIN.y + y * TILE + TILE / 2 };
  }

  private syn!: SynergyResult;

  private redrawAll(): void {
    this.syn = this.engine.getSynergy();
    const st = this.engine.state;
    for (let y = 0; y < st.height; y++) {
      for (let x = 0; x < st.width; x++) this.redrawCell(x, y);
    }
    this.redrawBackpack();
    this.redrawHud();
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
    icon.setText('').setAlpha(1).setPosition(sx, sy - 7);

    // 미사용 보석: 발견(revealed)된 것만 보석(특수 오브)으로 보인다. 미발견은 일반 타일.
    if (cell.gem && !cell.gemUsed) {
      if (cell.revealed) {
        rect.setFillStyle(0x123047);
        rect.setStrokeStyle(2, 0x6cf0ff);
        icon.setText('◆').setColor('#6cf0ff').setFontSize(22).setPosition(sx, sy);
      } else {
        rect.setFillStyle(COLORS.hidden);
        rect.setStrokeStyle(1, COLORS.border);
        if (cell.note !== undefined) icon.setText(String(cell.note)).setColor('#f4a261').setFontSize(16).setPosition(sx, sy);
      }
      return;
    }

    // 미공개(활성) 칸 — 일반 타일 (우클릭 메모가 있으면 표시)
    if (!cell.revealed) {
      rect.setFillStyle(COLORS.hidden);
      rect.setStrokeStyle(1, COLORS.border);
      if (cell.note !== undefined) icon.setText(String(cell.note)).setColor('#f4a261').setFontSize(16).setPosition(sx, sy);
      return;
    }

    if (cell.content === 'monster') {
      const def = getMonster(cell.monsterId!);
      const isDragon = cell.monsterId === 'dragon';
      const alive = isDragon ? st.phase !== 'won' : !cell.dead;
      if (alive) {
        // 살아있는 몹(공격 대상) — 일반 타일 + 아이콘 + 레벨(=데미지). 드래곤도 일반 테두리.
        rect.setFillStyle(COLORS.hidden);
        rect.setStrokeStyle(isDragon ? 2 : 1, COLORS.border);
        icon.setText(def.glyph).setFontSize(isDragon ? 24 : 20).setPosition(sx, sy - 7);
        text.setText(String(def.level)).setColor('#ffd166').setFontSize(13).setPosition(sx, sy + 13);
        return;
      }
      if (!cell.collected) {
        // 처치됨·미수확 = 시신: 아이콘+레벨 보임. 보통 초록(수확 가능), 나를 죽인 몹은 빨강.
        rect.setFillStyle(0x191512);
        rect.setStrokeStyle(2, cell.killer ? COLORS.danger : 0x52b788);
        icon.setText(def.glyph).setFontSize(18).setAlpha(0.55).setPosition(sx, sy - 7);
        text.setText(String(def.level)).setColor('#7a8290').setFontSize(12).setPosition(sx, sy + 13);
        return;
      }
      // 수확 완료 → 아래 숫자 타일로(주변에 남은 몹 수 표시)
    }

    // 숫자 타일(공개된 빈 칸 / 처치된 몹 / 보석 사용 자리) — 비활성처럼 흐리게 + 단일 색.
    // 주변 몹 0마리면 숫자를 표시하지 않는다(빈 흐린 타일).
    rect.setFillStyle(COLORS.numbered);
    rect.setStrokeStyle(1, COLORS.numberedBorder);
    if (cell.adjacencySum > 0) {
      text.setText(String(cell.adjacencySum)).setColor(COLORS.numberText).setFontSize(18);
    }
  }

  private redrawBackpack(): void {
    const bp = this.engine.state.backpack;
    for (let y = 0; y < bp.height; y++) {
      for (let x = 0; x < bp.width; x++) {
        const c = bp.cells[y * bp.width + x];
        const rect = this.bpRects[y * bp.width + x];
        rect.setFillStyle(c.active ? (c.protruding ? COLORS.bpProtruding : COLORS.bpActive) : COLORS.bpInactive);
        rect.setStrokeStyle(1, COLORS.border);
        if (this.campOpen && !c.active && this.engine.state.pendingSculptCells > 0) {
          rect.setStrokeStyle(1, 0x52b788);
        }
      }
    }

    this.itemLayer.removeAll(true);
    bp.items.forEach((pl, idx) => {
      const def = getItem(pl.itemId);
      const cells = absoluteCells(bp, pl, getItem);
      const selected = this.campOpen && this.selectedItem === idx;
      for (const cc of cells) {
        const sx = BP_ORIGIN.x + cc.x * BP_CELL + BP_CELL / 2;
        const sy = BP_ORIGIN.y + cc.y * BP_CELL + BP_CELL / 2;
        const r = this.add
          .rectangle(sx, sy, BP_CELL - 8, BP_CELL - 8, def.color, selected ? 1 : 0.85)
          .setStrokeStyle(selected ? 3 : 1, selected ? 0xffffff : 0x000000);
        this.itemLayer.add(r);
      }
      const head = cells[0];
      const hx = BP_ORIGIN.x + head.x * BP_CELL + BP_CELL / 2;
      const hy = BP_ORIGIN.y + head.y * BP_CELL + BP_CELL / 2;
      this.itemLayer.add(
        this.add.text(hx, hy, def.glyph, { fontFamily: FONT, fontSize: '18px', color: '#0b0b12', fontStyle: 'bold' }).setOrigin(0.5),
      );
    });
  }

  private redrawHud(): void {
    const st = this.engine.state;
    const s = this.syn ?? this.engine.getSynergy();

    this.hpBarFill.setSize(260 * Math.max(0, st.hp) / Math.max(1, st.maxHp), 16);
    this.hpText.setText(`${st.hp} / ${st.maxHp}`);
    const cost = this.engine.levelUpCostNow();
    this.vitBarFill.setSize((260 * Math.min(st.vitalityForLevel, cost)) / cost, 16);
    this.vitText.setText(`Lv${st.level} · 다음 ${Math.max(0, cost - st.vitalityForLevel)}`);

    // 레벨업 버튼 — 승/패 시 '다시하기'로 변신
    if (st.phase === 'lost') {
      this.levelUpBtn.setText('  💀 죽음 — 다시하기  ').setBackgroundColor('#e63946').setColor('#0b0b12');
    } else if (st.phase === 'won') {
      this.levelUpBtn.setText('  🏆 승리! — 다시하기  ').setBackgroundColor('#52b788').setColor('#0b0b12');
    } else if (this.engine.canLevelUp()) {
      this.levelUpBtn.setText('  ▲ 레벨업 — 풀피 회복 + 최대HP↑  ').setBackgroundColor('#52b788').setColor('#0b0b12');
    } else {
      this.levelUpBtn
        .setText(`  레벨업까지 성장 ${Math.max(0, cost - st.vitalityForLevel)} 더 필요  `)
        .setBackgroundColor('#222732')
        .setColor('#8a90a0');
    }

    this.goldText.setText(`골드 ${st.gold}`);
    this.scoreText.setText(`점수 ${st.score}`);
    this.guardText.setText(`실수 가드 ${st.misclickGuards} · 조형칸 ${st.pendingSculptCells}`);

    const lines = [
      `골드 환율 +${Math.round(s.goldRateSum * 100)}%  ·  Lv당 골드 +${s.goldLvScaleSum.toFixed(2)}`,
      `점수/Lv +${s.scorePerLvSum.toFixed(1)}  ·  여백점수 +${s.voidScoreFlat}  ·  격리 ${Math.round(s.isolationBonus * 100)}%`,
      `실수 가드 ${st.misclickGuards}  ·  남은 구역 ${st.clearedZones.filter((z) => !z).length}  ·  목표: 중앙 Lv15 드래곤`,
    ];
    this.synText.setText(lines.join('\n'));
    this.campHintText.setText(this.campOpen ? '캠프: 아이템 이동/회전(R)/조형 · 계속 ▶ 으로 재개' : '');
  }
}
