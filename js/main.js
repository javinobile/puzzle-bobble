import { loadSpriteSheet } from './assets.js';
import { Sound } from './audio.js';
import { IS_MOBILE } from './device.js';
import { Game } from './game.js';
import { Input } from './input.js';
import { Lobby } from './lobby.js';
import { Renderer } from './renderer.js';
import { Sprites } from './sprites.js';
import { getHighScore } from './storage.js';
import { TouchInput } from './touch.js';

const STEP = 1 / 60;
// Estados en los que se ven los botones táctiles ⏸ y 🔊
const TOUCH_CONTROL_STATES = new Set(['countdown', 'playing', 'frozen']);

const $ = (sel) => document.querySelector(sel);
const overlays = {
  menu: $('#menu'),
  paused: $('#pause'),
  gameover: $('#gameover'),
  victory: $('#victory'),
};

if (IS_MOBILE) document.body.classList.add('mobile');

async function boot() {
  const [sheet] = await Promise.all([
    loadSpriteSheet('assets/sprites.png'),
    document.fonts?.load('8px "Press Start 2P"').catch(() => null),
  ]);

  const sound = new Sound();
  // En móvil solo hay control táctil: el teclado físico no se escucha
  const input = IS_MOBILE ? new TouchInput($('#game'), () => sound.unlock()) : new Input(() => sound.unlock());
  const renderer = new Renderer($('#game'), new Sprites(sheet));
  const menuButtons = [...document.querySelectorAll('#menu .menu-options button')];
  let menuIndex = 0;
  let lobby = null;
  const quitConfirm = $('#quit-confirm');
  const touchControls = $('#touch-controls');
  const muteButton = $('#btn-mute');

  const selectMenu = (i) => {
    menuIndex = (i + menuButtons.length) % menuButtons.length;
    menuButtons.forEach((b, j) => b.classList.toggle('selected', j === menuIndex));
  };

  const game = new Game({
    sound,
    input,
    onStateChange(state, info) {
      if (state === 'mute') {
        muteButton.textContent = info.muted ? '🔇' : '🔊';
        return;
      }
      // Versus: "¿Abandonar?" se abre sobre la partida sin cambiar de estado
      if (state === 'quit-confirm') {
        quitConfirm.hidden = !info.open;
        return;
      }
      quitConfirm.hidden = true;
      touchControls.hidden = !TOUCH_CONTROL_STATES.has(state);
      for (const [name, el] of Object.entries(overlays)) el.hidden = name !== state;
      lobby?.onGameState(state, info);
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

  lobby = new Lobby({ menu: overlays.menu, sound, game, onExit: () => game.setState('menu') });

  const startMode = (mode) => {
    sound.unlock();
    sound.select();
    game.start(mode);
  };
  const chooseMenu = (btn) => {
    if (btn.dataset.action === 'online') {
      sound.unlock();
      sound.select();
      lobby.open();
    } else {
      startMode(btn.dataset.mode);
    }
  };
  menuButtons.forEach((btn, i) => {
    btn.addEventListener('click', () => chooseMenu(btn));
    btn.addEventListener('mouseenter', () => selectMenu(i));
  });
  document.querySelectorAll('[data-action="menu"]').forEach((btn) =>
    btn.addEventListener('click', () => game.setState('menu')),
  );
  $('#resume').addEventListener('click', () => game.setState('playing'));
  $('#quit-yes').addEventListener('click', () => game.quitVersus());
  $('#quit-no').addEventListener('click', () => game.setQuitConfirm(false));

  if (IS_MOBILE) {
    // ⏸ pausa en solitario y abre "¿Abandonar?" en versus (el juego decide por su estado)
    $('#btn-pause').addEventListener('click', () => input.press('pause'));
    $('#btn-mute').addEventListener('click', () => input.press('mute'));
    // iOS solo deja sonar el audio tras un gesto del usuario
    document.addEventListener('pointerdown', () => sound.unlock());
    // Sin menú de pulsación larga ni scroll al arrastrar sobre el juego
    const screen = $('.screen');
    screen.addEventListener('contextmenu', (e) => e.preventDefault());
    screen.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  }

  // Navegación de menús con teclado (el juego solo procesa 'playing' y 'paused')
  const handleMenus = () => {
    if (lobby.active) return; // el lobby gestiona su propio teclado
    if (game.state === 'menu') {
      if (input.consume('down') || input.consume('right')) {
        selectMenu(menuIndex + 1);
        sound.select();
      }
      if (input.consume('fire') || input.consume('left')) {
        selectMenu(menuIndex - 1);
        sound.select();
      }
      if (input.consume('confirm')) chooseMenu(menuButtons[menuIndex]);
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
