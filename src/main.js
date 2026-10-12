import { WIDTH, HEIGHT, GRAVITY } from './config.js';
import BootScene from './scenes/Boot.js';
import TitleScene from './scenes/Title.js';
import GameScene from './scenes/Game.js';
import HUDScene from './scenes/HUD.js';
import PauseScene from './scenes/Pause.js';
import GameOverScene from './scenes/GameOver.js';
import VictoryScene from './scenes/Victory.js';

const config = {
  type: Phaser.AUTO,
  parent: 'game',
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: '#05060a',
  antialias: true,
  render: { maxLights: 16 },
  pixelArt: false,
  roundPixels: false,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: GRAVITY },
      debug: false,
    },
  },
  input: {
    gamepad: false, // handled by src/input/Input.js directly
  },
  scene: [BootScene, TitleScene, GameScene, HUDScene, PauseScene, GameOverScene, VictoryScene],
};

window.addEventListener('load', () => {
  const game = new Phaser.Game(config);
  window.__game = game; // exposed for the smoke test
});
