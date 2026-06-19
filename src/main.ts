import Phaser from 'phaser';
import { VIEW, COLORS } from './config';
import { GameScene } from './scenes/GameScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: VIEW.width,
  height: VIEW.height,
  backgroundColor: COLORS.bg,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [GameScene],
};

// 우클릭(깃발/메모)을 위해 캔버스 컨텍스트 메뉴 비활성화
window.addEventListener('contextmenu', (e) => e.preventDefault());

// Do Hyeon 웹폰트가 준비된 뒤 시작(캔버스 텍스트가 폴백으로 그려지지 않게). 오프라인이면 즉시 진행.
async function start(): Promise<void> {
  try {
    await Promise.race([
      (async () => {
        await document.fonts.load('20px "Do Hyeon"');
        await document.fonts.ready;
      })(),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch {
    /* 폰트 로드 실패 시 폴백 폰트로 진행 */
  }
  new Phaser.Game(config);
}

void start();
