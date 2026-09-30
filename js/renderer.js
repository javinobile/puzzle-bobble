import {
  AUTO_FIRE_WARNING_MS,
  FIELD_TOP,
  FIELD_W,
  FIELD_X,
  LAUNCHER_X,
  LAUNCHER_Y,
  LIMIT_Y,
  MAX_ANGLE,
  VIEW_H,
  VIEW_W,
} from './config.js';

const FONT = '"Press Start 2P", monospace';
const WALL = 8;
const FIELD_RIGHT = FIELD_X + FIELD_W;

export class Renderer {
  constructor(canvas, sprites) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sprites = sprites;
    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    this.ctx.imageSmoothingEnabled = false;
    this.background = this.buildBackground();
  }

  // Fondo estático pre-renderizado (patrón de rombos como el arcade)
  buildBackground() {
    const bg = document.createElement('canvas');
    bg.width = VIEW_W;
    bg.height = VIEW_H;
    const ctx = bg.getContext('2d');
    ctx.fillStyle = '#1c3c8c';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = '#2850a8';
    for (let y = 0; y < VIEW_H; y += 16) {
      for (let x = (y / 16) % 2 ? 8 : 0; x < VIEW_W; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x + 8, y);
        ctx.lineTo(x + 16, y + 8);
        ctx.lineTo(x + 8, y + 16);
        ctx.lineTo(x, y + 8);
        ctx.fill();
      }
    }
    // Zona de juego
    const g = ctx.createLinearGradient(0, FIELD_TOP, 0, VIEW_H);
    g.addColorStop(0, '#0c1848');
    g.addColorStop(1, '#183078');
    ctx.fillStyle = g;
    ctx.fillRect(FIELD_X, 0, FIELD_W, VIEW_H);
    // Paredes
    for (const x of [FIELD_X - WALL, FIELD_RIGHT]) {
      ctx.fillStyle = '#8890a8';
      ctx.fillRect(x, FIELD_TOP - WALL, WALL, VIEW_H);
      ctx.fillStyle = '#c8d0e8';
      ctx.fillRect(x + 1, FIELD_TOP - WALL, 2, VIEW_H);
      ctx.fillStyle = '#50586c';
      ctx.fillRect(x + WALL - 2, FIELD_TOP - WALL, 2, VIEW_H);
      ctx.fillStyle = '#e8b030';
      for (let y = FIELD_TOP; y < VIEW_H; y += 24) ctx.fillRect(x + 2, y, 4, 4);
    }
    return bg;
  }

  render(game) {
    const ctx = this.ctx;
    ctx.drawImage(this.background, 0, 0);
    if (game.state === 'menu') return this.drawAttract(game);

    const shake = game.dropWarning && !game.projectile ? Math.round(Math.sin(game.time * 60)) : 0;
    this.drawCeiling(game, shake);
    this.drawLimitLine(game);
    this.drawBoard(game, shake);
    this.drawEffects(game);
    this.drawLauncher(game);
    this.drawHud(game);
    if (game.state === 'clear') this.drawBanner('ROUND CLEAR!', `BONUS ${game.lastBonus ?? ''}`);
  }

  drawCeiling(game, shake) {
    const ctx = this.ctx;
    const top = game.top;
    ctx.fillStyle = '#687088';
    ctx.fillRect(FIELD_X - WALL, 0, FIELD_W + WALL * 2, FIELD_TOP - WALL);
    // Prensa que desciende
    ctx.fillStyle = '#a0a8c0';
    ctx.fillRect(FIELD_X + shake, FIELD_TOP - WALL, FIELD_W, top - FIELD_TOP + WALL);
    ctx.fillStyle = '#7880a0';
    for (let y = FIELD_TOP - WALL + 3; y < top - 1; y += 6) ctx.fillRect(FIELD_X + shake, y, FIELD_W, 2);
    ctx.fillStyle = '#e8b030';
    ctx.fillRect(FIELD_X + shake, top - 2, FIELD_W, 2);
  }

  drawLimitLine(game) {
    const ctx = this.ctx;
    const danger = game.grid.lowestRow() + game.drops >= 10;
    ctx.fillStyle = danger && Math.floor(game.time * 6) % 2 ? '#ff4040' : '#f0e0a0';
    for (let x = FIELD_X; x < FIELD_RIGHT; x += 8) ctx.fillRect(x, LIMIT_Y, 4, 1);
  }

  drawBoard(game, shake) {
    const top = game.top;
    for (const { r, c, color } of game.grid.cells()) {
      const { x, y } = game.grid.center(r, c, top);
      const dead = game.state.startsWith('gameover') && game.grid.rows.length - r <= game.deadRows;
      this.sprites.bubble(this.ctx, dead ? 'dead' : color, x + shake, y);
    }
    if (game.projectile) this.sprites.bubble(this.ctx, game.projectile.color, game.projectile.x, game.projectile.y);
  }

  drawEffects(game) {
    for (const e of game.effects) this.sprites.pop(this.ctx, e.color, game.popFrame(e), e.x, e.y);
    for (const f of game.falling) this.sprites.bubble(this.ctx, f.color, f.x, f.y);
  }

  drawLauncher(game) {
    const ctx = this.ctx;
    const gearFrame = Math.floor(((game.shooter.angle + MAX_ANGLE) / (MAX_ANGLE * 2)) * 11);
    this.sprites.gear(ctx, gearFrame, LAUNCHER_X - 28, VIEW_H - 40);
    this.sprites.arrow(ctx, game.shooter.angle, LAUNCHER_X, LAUNCHER_Y);
    if (!game.projectile && game.state === 'playing') this.sprites.bubble(ctx, game.current, LAUNCHER_X, LAUNCHER_Y);

    // Siguiente burbuja y Bub
    this.text('NEXT', LAUNCHER_X - 56, VIEW_H - 22, '#fff', 6);
    this.sprites.bubble(ctx, game.next, LAUNCHER_X - 44, VIEW_H - 10);
    let bubFrame = Math.floor(game.time * 2) % 3;
    if (game.bubShootTimer > 0) bubFrame = 3 + Math.min(2, Math.floor((0.3 - game.bubShootTimer) / 0.1));
    else if (game.aiming) bubFrame = 6 + (Math.floor(game.time * 8) % 2);
    this.sprites.bub(ctx, bubFrame, LAUNCHER_X + 22, VIEW_H - 34);

    // Cuenta atrás del disparo automático
    if (game.state === 'playing' && !game.projectile && game.autoFireLeft <= AUTO_FIRE_WARNING_MS) {
      const n = Math.ceil(game.autoFireLeft / 1000);
      if (n > 0 && Math.floor(game.time * 4) % 2 === 0) this.text(String(n), LAUNCHER_X - 4, LAUNCHER_Y - 40, '#ff5050', 12);
    }
  }

  drawHud(game) {
    const lx = 8;
    const rx = FIELD_RIGHT + WALL + 6;
    this.text('1UP', lx, 16, '#ff5050');
    this.text(pad(game.score), lx, 28, '#fff');
    this.text('HI', lx, 48, '#50b0ff');
    this.text(pad(game.highScore), lx, 60, '#fff');

    const modeLabel = game.mode === 'arcade' ? 'ARCADE' : 'ENDLESS';
    this.text(modeLabel, rx, 16, '#f0d000');
    if (game.mode === 'arcade') this.text(`ROUND ${game.levelIndex + 1}`, rx, 28, '#fff');
    else this.text(`ROWS ${game.rowsInserted}`, rx, 28, '#fff');

    this.text('DROP IN', rx, 48, '#50b0ff');
    const warn = game.dropWarning && Math.floor(game.time * 6) % 2;
    this.text(`${game.shotsUntilDrop} SHOTS`, rx, 60, warn ? '#ff4040' : '#fff');

    if (game.sound?.muted) this.text('MUTE', rx, 80, '#aaa');

    const help = ['←→ AIM', 'SPACE FIRE', 'P PAUSE', 'M SOUND'];
    help.forEach((line, i) => this.text(line, lx, 170 + i * 12, '#9fb4ff', 6));
  }

  drawBanner(title, subtitle) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(FIELD_X, 90, FIELD_W, 44);
    this.text(title, VIEW_W / 2, 106, '#f0d000', 8, 'center');
    this.text(subtitle, VIEW_W / 2, 122, '#fff', 8, 'center');
  }

  // Pantalla de fondo del menú: burbujas decorativas
  drawAttract(game) {
    const colors = ['blue', 'red', 'yellow', 'green', 'purple', 'orange'];
    for (let i = 0; i < 18; i++) {
      const x = FIELD_X + 8 + ((i * 37) % FIELD_W);
      const y = VIEW_H - ((game.time * (20 + (i % 5) * 8) + i * 40) % (VIEW_H + 32)) + 16;
      this.sprites.bubble(this.ctx, colors[i % colors.length], x, y);
    }
  }

  text(str, x, y, color = '#fff', size = 8, align = 'left') {
    const ctx = this.ctx;
    ctx.font = `${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#000';
    ctx.fillText(str, x + 1, y + 1);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }
}

const pad = (n) => String(n).padStart(8, '0');
