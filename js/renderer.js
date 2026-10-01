import {
  AUTO_FIRE_WARNING_MS,
  FIELD_TOP,
  FIELD_W,
  FIELD_X,
  LAUNCHER_X,
  LAUNCHER_Y,
  LIMIT_Y,
  MAX_ANGLE,
  MINI_RIVAL_SCALE,
  MOBILE_BOARD_DX,
  MOBILE_BOARD_DY,
  MOBILE_HUD_H,
  MOBILE_VIEW_H,
  MOBILE_VIEW_W,
  ROW_H,
  VIEW_H,
  VIEW_W,
} from './config.js';
import { IS_MOBILE } from './device.js';

const FONT = '"Press Start 2P", monospace';
const WALL = 8;
const FIELD_RIGHT = FIELD_X + FIELD_W;
// Versus (SPEC 02): el tablero lógico sigue centrado y se dibuja desplazado.
// Propio en x = 16, rival en x = 176.
const OWN_DX = 16 - FIELD_X;
const RIVAL_DX = 176 - FIELD_X;
// Móvil (SPEC 03): rival en miniatura a la derecha de la franja de HUD, sin la tapa del techo
const MINI_TOP = FIELD_TOP - WALL;
const MINI_W = (FIELD_W + WALL * 2) * MINI_RIVAL_SCALE;
const MINI_X = MOBILE_VIEW_W - MINI_W - 4;
const MINI_Y = MOBILE_HUD_H - (VIEW_H - MINI_TOP) * MINI_RIVAL_SCALE;

export class Renderer {
  constructor(canvas, sprites) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sprites = sprites;
    this.mobile = IS_MOBILE;
    canvas.width = this.mobile ? MOBILE_VIEW_W : VIEW_W;
    canvas.height = this.mobile ? MOBILE_VIEW_H : VIEW_H;
    this.ctx.imageSmoothingEnabled = false;
    if (this.mobile) {
      this.background = this.buildBackground([MOBILE_BOARD_DX], MOBILE_VIEW_W, MOBILE_VIEW_H, MOBILE_BOARD_DY);
    } else {
      this.background = this.buildBackground([0]);
      this.versusBackground = this.buildBackground([OWN_DX, RIVAL_DX]);
    }
  }

  // Fondo estático pre-renderizado (patrón de rombos como el arcade), con una zona de juego por desplazamiento
  buildBackground(offsets, width = VIEW_W, height = VIEW_H, dy = 0) {
    const bg = document.createElement('canvas');
    bg.width = width;
    bg.height = height;
    const ctx = bg.getContext('2d');
    ctx.fillStyle = '#1c3c8c';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#2850a8';
    for (let y = 0; y < height; y += 16) {
      for (let x = (y / 16) % 2 ? 8 : 0; x < width; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x + 8, y);
        ctx.lineTo(x + 16, y + 8);
        ctx.lineTo(x + 8, y + 16);
        ctx.lineTo(x, y + 8);
        ctx.fill();
      }
    }
    // Móvil: franja de HUD oscurecida
    if (dy) {
      ctx.fillStyle = 'rgba(8, 16, 56, 0.55)';
      ctx.fillRect(0, 0, width, dy);
    }
    ctx.translate(0, dy);
    for (const dx of offsets) this.drawField(ctx, dx);
    return bg;
  }

  // Zona de juego y paredes de un tablero (coordenadas lógicas, desplazado dx)
  drawField(ctx, dx) {
    const g = ctx.createLinearGradient(0, FIELD_TOP, 0, VIEW_H);
    g.addColorStop(0, '#0c1848');
    g.addColorStop(1, '#183078');
    ctx.fillStyle = g;
    ctx.fillRect(FIELD_X + dx, 0, FIELD_W, VIEW_H);
    for (const x of [FIELD_X - WALL + dx, FIELD_RIGHT + dx]) {
      ctx.fillStyle = '#8890a8';
      ctx.fillRect(x, FIELD_TOP - WALL, WALL, VIEW_H);
      ctx.fillStyle = '#c8d0e8';
      ctx.fillRect(x + 1, FIELD_TOP - WALL, 2, VIEW_H);
      ctx.fillStyle = '#50586c';
      ctx.fillRect(x + WALL - 2, FIELD_TOP - WALL, 2, VIEW_H);
      ctx.fillStyle = '#e8b030';
      for (let y = FIELD_TOP; y < VIEW_H; y += 24) ctx.fillRect(x + 2, y, 4, 4);
    }
  }

  render(game) {
    const ctx = this.ctx;
    ctx.drawImage(this.background, 0, 0);
    if (this.mobile) return this.renderMobile(game);
    if (game.state === 'menu') return this.drawAttract(game);
    if (game.mode === 'versus') return this.renderVersus(game);

    const shake = game.dropWarning && !game.projectile ? Math.round(Math.sin(game.time * 60)) : 0;
    this.drawCeiling(game.top, shake);
    this.drawLimitLine(game.grid.lowestRow() + game.drops, game.time);
    this.drawBoard(game, shake);
    this.drawEffects(game);
    this.drawLauncher(game);
    this.drawHud(game);
    if (game.state === 'clear') this.drawBanner('ROUND CLEAR!', `BONUS ${game.lastBonus ?? ''}`);
  }

  drawCeiling(top, shake) {
    const ctx = this.ctx;
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

  // `depth`: fila más baja ocupada contando lo que bajó el techo
  drawLimitLine(depth, time) {
    const ctx = this.ctx;
    const danger = depth >= 10;
    ctx.fillStyle = danger && Math.floor(time * 6) % 2 ? '#ff4040' : '#f0e0a0';
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

  // Tablero propio (solitario o versus), en coordenadas lógicas
  drawOwnBoard(game) {
    const shake = game.dropWarning && !game.projectile ? Math.round(Math.sin(game.time * 60)) : 0;
    this.drawCeiling(game.top, shake);
    this.drawLimitLine(game.grid.lowestRow() + game.drops, game.time);
    this.drawBoard(game, shake);
    this.drawEffects(game);
    this.drawLauncher(game);
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

  // ---------- Versus (SPEC 02) ----------

  renderVersus(game) {
    const ctx = this.ctx;
    const v = game.versus;
    ctx.drawImage(this.versusBackground, 0, 0);

    // Tablero propio (izquierda): el mismo dibujo que en solitario, desplazado
    ctx.save();
    ctx.translate(OWN_DX, 0);
    this.drawOwnBoard(game);
    ctx.restore();

    // Tablero del rival (derecha), solo visualización
    ctx.save();
    ctx.translate(RIVAL_DX, 0);
    this.drawRivalBoard(v.rival, game.time);
    ctx.restore();

    this.drawVersusHud(game);
    this.drawVersusBanners(game);
  }

  drawRivalBoard(rival, time) {
    const ctx = this.ctx;
    const top = FIELD_TOP + rival.drops * ROW_H;
    this.drawCeiling(top, 0);
    const grid = rival.grid;
    this.drawLimitLine(grid ? grid.lowestRow() + rival.drops : 0, time);
    if (grid) {
      for (const { r, c, color } of grid.cells()) {
        const { x, y } = grid.center(r, c, top);
        this.sprites.bubble(ctx, color, x, y);
      }
    }
    const gearFrame = Math.floor(((rival.angle + MAX_ANGLE) / (MAX_ANGLE * 2)) * 11);
    this.sprites.gear(ctx, gearFrame, LAUNCHER_X - 28, VIEW_H - 40);
    this.sprites.arrow(ctx, rival.angle, LAUNCHER_X, LAUNCHER_Y);
    if (rival.current) this.sprites.bubble(ctx, rival.current, LAUNCHER_X, LAUNCHER_Y);
    if (rival.next) this.sprites.bubble(ctx, rival.next, LAUNCHER_X - 44, VIEW_H - 10);
  }

  drawVersusHud(game) {
    const v = game.versus;
    const own = FIELD_X + OWN_DX;
    const rival = FIELD_X + RIVAL_DX;
    const nick = (i) => v.nicks[i] ?? '???';
    this.text(nick(v.you), own + 2, 4, '#ff5050');
    this.text(nick(1 - v.you), rival + 2, 4, '#50b0ff');
    if (v.pendingGarbage > 0 && Math.floor(game.time * 4) % 2 === 0) {
      this.text(`+${v.pendingGarbage}`, own + FIELD_W - 2, 4, '#f0d000', 8, 'right');
    }
    if (game.sound?.muted) this.text('MUTE', VIEW_W / 2, VIEW_H - 10, '#aaa', 6, 'center');
  }

  drawVersusBanners(game) {
    const ownCenter = FIELD_X + OWN_DX + FIELD_W / 2;
    if (game.state === 'countdown') {
      this.boardBanner(ownCenter, countdownLabel(game), 'VERSUS');
      this.boardBanner(FIELD_X + RIVAL_DX + FIELD_W / 2, countdownLabel(game), 'VERSUS');
    } else if (game.state === 'frozen') {
      this.drawFrozen(game.versus, VIEW_W, VIEW_H, 100);
    }
  }

  // Pantalla oscurecida de pausa de red. En móvil el texto largo se parte en dos líneas.
  drawFrozen(v, width, height, y) {
    const left = v.frozen?.left;
    const lines = v.frozen?.peer && left !== null ? ['RIVAL DESCONECTADO', `${Math.ceil(left)} S`] : ['RECONECTANDO...'];
    if (!this.mobile && lines.length > 1) lines.splice(0, 2, lines.join(' '));
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    this.ctx.fillRect(0, 0, width, height);
    const size = this.mobile ? 6 : 8;
    this.text('PAUSA DE RED', width / 2, y, '#f0d000', 8, 'center');
    lines.forEach((line, i) => this.text(line, width / 2, y + 16 + i * 12, '#fff', size, 'center'));
  }

  // ---------- Móvil (SPEC 03): vista vertical 180×320 ----------

  renderMobile(game) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(MOBILE_BOARD_DX, MOBILE_BOARD_DY);
    if (game.state === 'menu') {
      this.drawAttract(game);
      ctx.restore();
      return;
    }
    this.drawOwnBoard(game);
    if (game.state === 'clear') this.drawBanner('ROUND CLEAR!', `BONUS ${game.lastBonus ?? ''}`);
    if (game.mode === 'versus' && game.state === 'countdown') {
      this.boardBanner(FIELD_X + FIELD_W / 2, countdownLabel(game), 'VERSUS');
    }
    ctx.restore();

    if (game.mode === 'versus') {
      this.drawMiniRival(game);
      this.drawMobileVersusHud(game);
      if (game.state === 'frozen') this.drawFrozen(game.versus, MOBILE_VIEW_W, MOBILE_VIEW_H, 150);
    } else {
      this.drawMobileHud(game);
    }
  }

  // Franja superior en solitario: puntos y récord a la izquierda, modo y techo a la derecha
  drawMobileHud(game) {
    const lx = 6;
    const rx = 100;
    this.text('1UP', lx, 6, '#ff5050');
    this.text(pad(game.score), lx, 18, '#fff');
    this.text('HI', lx, 38, '#50b0ff');
    this.text(pad(game.highScore), lx, 50, '#fff');

    this.text(game.mode === 'arcade' ? 'ARCADE' : 'ENDLESS', rx, 6, '#f0d000');
    const progress = game.mode === 'arcade' ? `ROUND ${game.levelIndex + 1}` : `ROWS ${game.rowsInserted}`;
    this.text(progress, rx, 18, '#fff', 6);
    this.text('DROP IN', rx, 38, '#50b0ff');
    const warn = game.dropWarning && Math.floor(game.time * 6) % 2;
    this.text(`${game.shotsUntilDrop} SHOTS`, rx, 50, warn ? '#ff4040' : '#fff', 6);
    if (game.sound?.muted) this.text('MUTE', rx, 66, '#aaa', 6);
  }

  // Tablero del rival a escala 1/3 a la derecha de la franja, con su apodo encima
  drawMiniRival(game) {
    const ctx = this.ctx;
    const v = game.versus;
    this.text(v.nicks[1 - v.you] ?? '???', MINI_X + MINI_W / 2, 0, '#50b0ff', 6, 'center');
    ctx.save();
    ctx.beginPath();
    ctx.rect(MINI_X, MINI_Y, MINI_W, MOBILE_HUD_H - MINI_Y);
    ctx.clip();
    ctx.translate(MINI_X, MINI_Y);
    ctx.scale(MINI_RIVAL_SCALE, MINI_RIVAL_SCALE);
    ctx.translate(-(FIELD_X - WALL), -MINI_TOP);
    this.drawField(ctx, 0);
    this.drawRivalBoard(v.rival, game.time);
    ctx.restore();
  }

  // Izquierda de la franja en versus: apodo propio, basura pendiente y sonido
  drawMobileVersusHud(game) {
    const v = game.versus;
    this.text('VERSUS', 6, 6, '#f0d000');
    this.text(v.nicks[v.you] ?? '???', 6, 22, '#ff5050');
    this.text('VS', 6, 36, '#fff', 6);
    this.text(v.nicks[1 - v.you] ?? '???', 26, 36, '#50b0ff', 6);
    if (v.pendingGarbage > 0 && Math.floor(game.time * 4) % 2 === 0) {
      this.text(`+${v.pendingGarbage}`, 6, 52, '#f0d000');
    }
    if (game.sound?.muted) this.text('MUTE', 6, 68, '#aaa', 6);
  }

  // Cartel centrado sobre un tablero
  boardBanner(cx, title, subtitle) {
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    this.ctx.fillRect(cx - FIELD_W / 2, 90, FIELD_W, 44);
    this.text(title, cx, 104, '#f0d000', 12, 'center');
    this.text(subtitle, cx, 122, '#fff', 6, 'center');
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
const countdownLabel = (game) => {
  const n = Math.ceil(game.countdownLeft);
  return n > 0 ? String(n) : 'GO!';
};
