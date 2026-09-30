import { loadSpriteSheet } from './assets.js';
import { Sound } from './audio.js';
import { Game } from './game.js';
import { Input } from './input.js';
import { Renderer } from './renderer.js';
import { Sprites } from './sprites.js';
import { getHighScore } from './storage.js';

const STEP = 1 / 60;

const $ = (sel) => document.querySelector(sel);
const overlays = {
  menu: $('#menu'),
  paused: $('#pause'),
  gameover: $('#gameover'),
  victory: $('#victory'),
};

async function boot() {
  const [sheet] = await Promise.all([
    loadSpriteSheet('assets/sprites.png'),
    document.fonts?.load('8px "Press Start 2P"').catch(() => null),
  ]);

  const sound = new Sound();
  const input = new Input(() => sound.unlock());
  const renderer = new Renderer($('#game'), new Sprites(sheet));
  const menuButtons = [...document.querySelectorAll('#menu [data-mode]')];
  let menuIndex = 0;

  const selectMenu = (i) => {
    menuIndex = (i + menuButtons.length) % menuButtons.length;
    menuButtons.forEach((b, j) => b.classList.toggle('selected', j === menuIndex));
  };

  const game = new Game({
    sound,
    input,
    onStateChange(state, info) {
      if (state === 'mute') return;
      for (const [name, el] of Object.entries(overlays)) el.hidden = name !== state;
      if (state === 'menu') {
        $('#hi-arcade').textContent = getHighScore('arcade');
        $('#hi-endless').textContent = getHighScore('endless');
      }
      if (state === 'gameover' || state === 'victory') {
        const el = overlays[state];
        el.querySelector('.final-score').textContent = info.score;
        el.querySelector('.record').hidden = !info.isRecord;
        const round = el.querySelector('.final-round');
        if (round) round.textContent = info.game.mode === 'arcade' ? `Ronda ${info.round}` : `Modo Infinito`;
      }
    },
  });

  const startMode = (mode) => {
    sound.unlock();
    sound.select();
    game.start(mode);
  };
  menuButtons.forEach((btn, i) => {
    btn.addEventListener('click', () => startMode(btn.dataset.mode));
    btn.addEventListener('mouseenter', () => selectMenu(i));
  });
  document.querySelectorAll('[data-action="menu"]').forEach((btn) =>
    btn.addEventListener('click', () => game.setState('menu')),
  );
  $('#resume').addEventListener('click', () => game.setState('playing'));

  // Navegación de menús con teclado (el juego solo procesa 'playing' y 'paused')
  const handleMenus = () => {
    if (game.state === 'menu') {
      if (input.consume('down') || input.consume('right')) {
        selectMenu(menuIndex + 1);
        sound.select();
      }
      if (input.consume('fire') || input.consume('left')) {
        selectMenu(menuIndex - 1);
        sound.select();
      }
      if (input.consume('confirm')) startMode(menuButtons[menuIndex].dataset.mode);
    } else if (game.state === 'gameover' || game.state === 'victory') {
      if (input.consume('confirm')) game.setState('menu');
    }
  };

  let last = performance.now();
  let acc = 0;
  const frame = (now) => {
    acc += Math.min(0.25, (now - last) / 1000);
    last = now;
    while (acc >= STEP) {
      handleMenus();
      game.update(STEP);
      acc -= STEP;
    }
    renderer.render(game);
    requestAnimationFrame(frame);
  };
  selectMenu(0);
  requestAnimationFrame(frame);
}

boot();
