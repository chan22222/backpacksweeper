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

// 우클릭(깃발)을 위해 캔버스 컨텍스트 메뉴 비활성화
window.addEventListener('contextmenu', (e) => e.preventDefault());

new Phaser.Game(config);
