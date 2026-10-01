import {
  AUTO_FIRE_MS,
  AUTO_FIRE_WARNING_MS,
  COLOR_CODES,
  DROP_BASE_POINTS,
  DROP_MAX_EXP,
  DROP_WARNING_SHOTS,
  ENDLESS_MIN_SHOTS,
  ENDLESS_START_ROWS,
  FIELD_TOP,
  MAX_ROWS,
  POP_POINTS,
  ROW_H,
  SHOTS_PER_DROP,
  VIEW_H,
} from './config.js';
import { Grid } from './grid.js';
import { LEVELS, endlessColors, randomRow } from './levels.js';
import { MAX_GARBAGE, validateRelay } from './net/protocol.js';
import { createRng } from './rng.js';
import { Shooter } from './shooter.js';
import { POP_FRAME_COUNT } from './sprites.js';
import { getHighScore, saveHighScore } from './storage.js';

const POP_FRAME_TIME = 0.06;
const GRAVITY = 700;
const CLEAR_DELAY = 2.2;
const GAME_OVER_DELAY = 1.8;
const COUNTDOWN_SECS = 3;
const VERSUS_COLORS = ['blue', 'red', 'yellow', 'green'];
const VERSUS_REFILL_ROWS = 3;

const AIM_SEND_SECS = 0.1;
const GARBAGE_FREE = 2; // las 2 primeras burbujas caídas no envían basura
const COLOR_LETTERS = Object.fromEntries(Object.entries(COLOR_CODES).map(([letter, color]) => [color, letter]));

const pick = (list, rng = Math.random) => list[Math.floor(rng() * list.length)];

export class Game {
  constructor({ sound, input, onStateChange }) {
    this.sound = sound;
    this.input = input;
    this.onStateChange = onStateChange;
    this.versus = null;
    this.shooter = new Shooter();
    this.grid = new Grid();
    this.effects = [];
    this.falling = [];
    this.time = 0;
    this.setState('menu');
  }

  setState(state, info = {}) {
    this.state = state;
    this.onStateChange?.(state, { ...info, game: this });
  }

  get top() {
    return FIELD_TOP + this.drops * ROW_H;
  }

  get autoFireLeft() {
    return Math.max(0, AUTO_FIRE_MS - this.aimTimer * 1000);
  }

  get shotsUntilDrop() {
    return this.shotsPerDrop - this.shotsSinceDrop;
  }

  // En versus los colores del lanzador salen del generador con semilla del jugador
  get rng() {
    return this.mode === 'versus' ? this.versus.shotRng : Math.random;
  }

  // ---------- Inicio de partida ----------

  start(mode) {
    this.versus = null;
    this.mode = mode;
    this.score = 0;
    this.highScore = getHighScore(mode);
    this.levelIndex = 0;
    this.rowsInserted = 0;
    if (mode === 'arcade') this.loadLevel(0);
    else this.loadEndless();
  }

  resetBoardState() {
    this.drops = 0;
    this.shotsSinceDrop = 0;
    this.aimTimer = 0;
    this.lastTick = null;
    this.projectile = null;
    this.effects = [];
    this.falling = [];
    this.levelTime = 0;
    this.stateTimer = 0;
    this.deadRows = 0;
    this.shooter.angle = 0;
    this.bubShootTimer = 0;
  }

  loadLevel(index) {
    this.levelIndex = index;
    const level = LEVELS[index];
    this.grid = Grid.fromStrings(level.rows);
    this.shotsPerDrop = level.shotsPerDrop ?? SHOTS_PER_DROP;
    this.resetBoardState();
    this.dropFloating(false);
    this.current = this.randomColor();
    this.next = this.randomColor();
    this.setState('playing');
  }

  loadEndless() {
    this.grid = new Grid();
    this.resetBoardState();
    this.shotsPerDrop = SHOTS_PER_DROP;
    const colors = endlessColors(0);
    for (let r = 0; r < ENDLESS_START_ROWS; r++) {
      for (const [c, color] of randomRow(this.grid.cols(r), colors).entries()) this.grid.set(r, c, color);
    }
    this.current = this.randomColor();
    this.next = this.randomColor();
    this.setState('playing');
  }

  // Versus (SPEC 02): mismo tablero inicial para los dos gracias a la semilla de la sala.
  // `send` entrega datos al rival por relay; sin red es un no-op.
  startVersus({ seed, you, nicks, send = () => {} }) {
    this.mode = 'versus';
    this.score = 0;
    this.highScore = 0;
    this.levelIndex = 0;
    this.rowsInserted = 0;
    this.versus = {
      seed,
      you,
      nicks,
      send,
      boardRng: createRng(seed),
      shotRng: createRng((seed + you + 1) >>> 0),
      pendingGarbage: 0,
      rival: { rows: [], shift: 0, drops: 0, current: null, next: null, angle: 0 },
      lostSelf: false,
      result: null, // 'win' | 'lose' | 'draw'
      resultReason: null, // 'line' | 'quit' | 'timeout' | 'left'
      frozen: null, // { self, peer, left: s | null, prev: estado } mientras alguien está desconectado
      confirmingQuit: false,
      aimSentAt: 0,
      aimSent: 0,
    };
    this.grid = new Grid();
    this.resetBoardState();
    this.shotsPerDrop = SHOTS_PER_DROP;
    for (let r = 0; r < ENDLESS_START_ROWS; r++) {
      const row = randomRow(this.grid.cols(r), VERSUS_COLORS, this.versus.boardRng);
      for (const [c, color] of row.entries()) this.grid.set(r, c, color);
    }
    this.current = this.randomColor();
    this.next = this.randomColor();
    // Hasta el primer snapshot, el rival tiene el mismo tablero inicial
    this.versus.rival.grid = gridFromSnapshot(this.snapshotRows(), this.grid.shift);
    this.setState('countdown');
  }

  get countdownLeft() {
    return Math.max(0, COUNTDOWN_SECS - this.stateTimer);
  }

  // Solo se ofrecen colores que siguen en el tablero
  randomColor() {
    const present = this.grid.colorsPresent();
    if (present.length) return pick(present, this.rng);
    const fallback = this.mode === 'endless' ? endlessColors(this.score) : VERSUS_COLORS;
    return pick(fallback, this.rng);
  }

  refreshQueue() {
    const present = this.grid.colorsPresent();
    if (!present.length) return;
    if (!present.includes(this.current)) this.current = pick(present, this.rng);
    if (!present.includes(this.next)) this.next = pick(present, this.rng);
  }

  // ---------- Bucle ----------

  update(dt) {
    this.time += dt;
    if (this.input.consume('mute')) this.onStateChange?.('mute', { muted: this.sound.toggleMute(), game: this });

    switch (this.state) {
      case 'countdown':
        this.stateTimer += dt;
        if (this.stateTimer >= COUNTDOWN_SECS) this.setState('playing');
        break;
      case 'playing':
        if (this.mode === 'versus') {
          this.updateVersusPlaying(dt);
          break;
        }
        if (this.input.consume('pause')) {
          this.setState('paused');
          break;
        }
        this.updatePlaying(dt);
        break;
      case 'paused':
        if (this.input.consume('pause') || this.input.consume('confirm')) this.setState('playing');
        break;
      case 'clear':
        this.updateEffects(dt);
        this.stateTimer += dt;
        if (this.stateTimer >= CLEAR_DELAY) this.nextLevel();
        break;
      case 'gameover-anim':
        this.updateEffects(dt);
        this.stateTimer += dt;
        this.deadRows = Math.floor(this.stateTimer / 0.08);
        if (this.stateTimer >= GAME_OVER_DELAY) {
          if (this.mode === 'versus') this.endVersus();
          else this.setState('gameover', this.resultInfo());
        }
        break;
      case 'frozen':
        if (this.versus.frozen.left !== null) this.versus.frozen.left = Math.max(0, this.versus.frozen.left - dt);
        this.updateEffects(dt);
        break;
      case 'gameover':
      case 'victory':
      case 'versus-end':
        this.updateEffects(dt);
        break;
    }
    this.input.endFrame();
  }

  updatePlaying(dt, acceptInput = true) {
    this.levelTime += dt;
    let direction = 0;
    if (acceptInput && this.input.isHeld('left')) direction -= 1;
    if (acceptInput && this.input.isHeld('right')) direction += 1;
    if (direction) this.shooter.aim(direction, dt);
    this.aiming = direction !== 0;
    this.bubShootTimer = Math.max(0, this.bubShootTimer - dt);

    if (this.projectile) {
      const event = this.projectile.update(dt, this.grid, this.top);
      if (event === 'bounce') this.sound.bounce();
      if (event === 'hit') this.settle();
    } else {
      this.aimTimer += dt;
      const left = this.autoFireLeft;
      if (left <= AUTO_FIRE_WARNING_MS) {
        const second = Math.ceil(left / 1000);
        if (second !== this.lastTick) {
          this.lastTick = second;
          if (second > 0) this.sound.tick();
        }
      }
      if ((acceptInput && this.input.consume('fire')) || left <= 0) this.fire();
    }
    this.updateEffects(dt);
  }

  fire() {
    this.projectile = this.shooter.fire(this.current);
    this.current = this.next;
    this.next = this.randomColor();
    this.aimTimer = 0;
    this.lastTick = null;
    this.bubShootTimer = 0.3;
    this.sound.shoot();
  }

  settle() {
    this.settleProjectile();
    if (this.mode === 'versus' && !this.versus.lostSelf) this.sendSnapshot();
  }

  // La burbuja disparada se pega al tablero y se aplican las reglas
  settleProjectile() {
    const p = this.projectile;
    this.projectile = null;
    const cell = this.grid.nearestFreeCell(p.x, p.y, this.top);
    if (!cell) return this.gameOver();
    this.grid.set(cell.r, cell.c, p.color);

    const group = this.grid.floodFill(cell.r, cell.c);
    if (group.length >= 3) {
      for (const [r, c] of group) {
        const { x, y } = this.grid.center(r, c, this.top);
        this.effects.push({ x, y, color: this.grid.get(r, c), t: 0 });
        this.grid.remove(r, c);
      }
      this.addScore(group.length * POP_POINTS);
      this.sound.pop(group.length);
      const dropped = this.dropFloating(true);
      if (this.mode === 'versus') this.sendGarbage(dropped);
    } else {
      this.sound.stick();
    }

    if (this.mode === 'versus') this.applyGarbage();
    if (this.grid.count() === 0) return this.boardCleared();
    if (this.checkLimit()) return;

    this.shotsSinceDrop++;
    if (this.shotsSinceDrop >= this.shotsPerDrop) {
      this.shotsSinceDrop = 0;
      this.lowerCeiling();
      if (this.checkLimit()) return;
    }
    this.refreshQueue();
  }

  // Devuelve cuántas burbujas cayeron
  dropFloating(scored) {
    const floating = this.grid.findFloating();
    if (!floating.length) return 0;
    for (const [r, c] of floating) {
      const { x, y } = this.grid.center(r, c, this.top);
      this.falling.push({ x, y, vx: (Math.random() - 0.5) * 60, vy: -60 - Math.random() * 80, color: this.grid.get(r, c) });
      this.grid.remove(r, c);
    }
    if (!scored) return floating.length;
    const exp = Math.min(floating.length, DROP_MAX_EXP);
    this.addScore(DROP_BASE_POINTS * 2 ** exp);
    this.sound.drop(floating.length);
    return floating.length;
  }

  lowerCeiling() {
    if (this.mode === 'arcade') {
      this.drops++;
    } else if (this.mode === 'versus') {
      // La fila nº k es igual en los dos clientes: solo las inserciones consumen boardRng
      this.grid.insertTop(randomRow(this.grid.cols(0), VERSUS_COLORS, this.versus.boardRng));
      this.rowsInserted++;
    } else {
      this.grid.insertTop(randomRow(this.grid.cols(0), endlessColors(this.score)));
      this.rowsInserted++;
      this.shotsPerDrop = Math.max(ENDLESS_MIN_SHOTS, SHOTS_PER_DROP - Math.floor(this.rowsInserted / 5));
    }
    this.sound.ceiling();
  }

  checkLimit() {
    if (this.grid.lowestRow() + this.drops >= MAX_ROWS) {
      this.gameOver();
      return true;
    }
    return false;
  }

  boardCleared() {
    if (this.mode === 'versus') {
      // En versus limpiar no gana: entran filas nuevas sembradas y se sigue
      for (let i = 0; i < VERSUS_REFILL_ROWS; i++) {
        this.grid.insertTop(randomRow(this.grid.cols(0), VERSUS_COLORS, this.versus.boardRng));
      }
      this.rowsInserted += VERSUS_REFILL_ROWS;
      this.sound.levelClear();
      this.refreshQueue();
      return;
    }
    if (this.mode === 'endless') {
      // En Infinito el tablero se rellena y se sigue jugando
      const colors = endlessColors(this.score);
      this.addScore(5000);
      for (let i = 0; i < 3; i++) this.grid.insertTop(randomRow(this.grid.cols(0), colors));
      this.rowsInserted += 3;
      this.sound.levelClear();
      this.refreshQueue();
      return;
    }
    const secs = this.levelTime;
    const bonus = secs <= 5 ? 50000 : Math.max(0, Math.round((50000 * (1 - (secs - 5) / 55)) / 10) * 10);
    this.lastBonus = bonus;
    this.addScore(bonus);
    this.sound.levelClear();
    this.stateTimer = 0;
    this.setState('clear', { bonus, seconds: Math.round(secs), round: this.levelIndex + 1 });
  }

  nextLevel() {
    if (this.levelIndex + 1 >= LEVELS.length) {
      this.setState('victory', this.resultInfo());
      return;
    }
    this.loadLevel(this.levelIndex + 1);
  }

  gameOver() {
    this.projectile = null;
    this.stateTimer = 0;
    this.sound.gameOver();
    if (this.mode === 'versus') {
      this.versus.lostSelf = true;
      this.versus.confirmingQuit = false;
      this.versus.result ??= 'lose';
      this.versus.resultReason ??= 'line';
      this.sendSnapshot();
      this.versus.send({ k: 'lost' });
    }
    this.setState('gameover-anim');
  }

  resultInfo() {
    const isRecord = saveHighScore(this.mode, this.score);
    this.highScore = getHighScore(this.mode);
    return { score: this.score, isRecord, round: this.levelIndex + 1 };
  }

  addScore(points) {
    this.score += points;
    if (this.score > this.highScore) this.highScore = this.score;
  }

  updateEffects(dt) {
    for (const e of this.effects) e.t += dt;
    this.effects = this.effects.filter((e) => e.t < POP_FRAME_COUNT * POP_FRAME_TIME);
    for (const f of this.falling) {
      f.vy += GRAVITY * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
    }
    this.falling = this.falling.filter((f) => f.y < VIEW_H + 16);
  }

  popFrame(effect) {
    return Math.min(POP_FRAME_COUNT - 1, Math.floor(effect.t / POP_FRAME_TIME));
  }

  // ---------- Versus (SPEC 02) ----------

  // P/Esc no pausa: pide confirmación para abandonar mientras el tablero sigue vivo
  updateVersusPlaying(dt) {
    const v = this.versus;
    if (v.confirmingQuit) {
      if (this.input.consume('confirm')) return this.quitVersus();
      if (this.input.consume('pause')) this.setQuitConfirm(false);
    } else if (this.input.consume('pause')) {
      this.setQuitConfirm(true);
    }
    this.updatePlaying(dt, !v.confirmingQuit);
    this.sendAim();
  }

  // Ángulo al rival como máximo cada 100 ms y solo si cambió
  sendAim() {
    const v = this.versus;
    const angle = Math.round(this.shooter.angle * 10) / 10;
    if (angle === v.aimSent || this.time - v.aimSentAt < AIM_SEND_SECS) return;
    v.aimSent = angle;
    v.aimSentAt = this.time;
    v.send({ k: 'aim', a: angle });
  }

  // Datos del rival recibidos por relay; lo malformado se descarta
  onRelay(data) {
    const v = this.versus;
    if (!v || !validateRelay(data)) return;
    switch (data.k) {
      case 'snap':
        v.rival.grid = gridFromSnapshot(data.rows, data.shift);
        v.rival.rows = data.rows;
        v.rival.shift = data.shift;
        v.rival.drops = data.drops;
        v.rival.current = COLOR_CODES[data.current] ?? null;
        v.rival.next = COLOR_CODES[data.next] ?? null;
        break;
      case 'aim':
        v.rival.angle = data.a;
        break;
      case 'garbage':
        if (!v.result) v.pendingGarbage = Math.min(MAX_GARBAGE, v.pendingGarbage + data.n);
        break;
      case 'lost':
        this.rivalLost();
        break;
      case 'quit':
        if (v.result) return;
        v.result = 'win';
        v.resultReason = 'quit';
        this.endVersus();
        break;
    }
  }

  // Si yo ya había perdido por la línea antes de enterarme, es empate
  rivalLost() {
    const v = this.versus;
    if (v.lostSelf) {
      if (v.resultReason !== 'line' || v.result === 'draw') return;
      v.result = 'draw';
      if (this.state === 'versus-end') this.setState('versus-end', { result: v.result, reason: v.resultReason });
      return;
    }
    if (v.result) return;
    v.result = 'win';
    v.resultReason = 'line';
    this.endVersus();
  }

  setQuitConfirm(on) {
    if (this.mode !== 'versus' || this.state !== 'playing') return;
    this.versus.confirmingQuit = on;
    this.onStateChange?.('quit-confirm', { open: on, game: this });
  }

  // Abandono propio: derrota inmediata, el rival gana
  quitVersus() {
    const v = this.versus;
    if (!v || v.result) return;
    v.confirmingQuit = false;
    v.lostSelf = true;
    v.result = 'lose';
    v.resultReason = 'quit';
    v.send({ k: 'quit' });
    this.projectile = null;
    this.sound.gameOver();
    this.endVersus();
  }

  // El rival se fue de la sala (peer-left) en plena partida
  peerGone(reason) {
    const v = this.versus;
    if (!v || v.result) return;
    v.result = 'win';
    v.resultReason = reason === 'timeout' ? 'timeout' : 'left';
    this.endVersus();
  }

  endVersus() {
    const v = this.versus;
    v.frozen = null;
    v.confirmingQuit = false;
    this.projectile = null;
    if (v.result === 'win') this.sound.levelClear();
    this.setState('versus-end', { result: v.result, reason: v.resultReason });
  }

  // Desconexión de cualquiera de los dos: ambos tableros quietos.
  // who: 'peer' (el rival, con su plazo de gracia) o 'self' (yo me reconecto, plazo desconocido)
  freeze(who, graceMs = null) {
    const v = this.versus;
    if (!v || v.result) return;
    if (!v.frozen) {
      if (!['countdown', 'playing'].includes(this.state)) return;
      v.frozen = { self: false, peer: false, left: null, prev: this.state };
      this.setState('frozen');
    }
    v.frozen[who] = true;
    if (who === 'peer') v.frozen.left = graceMs / 1000;
  }

  unfreeze(who) {
    const v = this.versus;
    if (!v?.frozen) return;
    v.frozen[who] = false;
    if (who === 'peer') v.frozen.left = null;
    if (v.frozen.self || v.frozen.peer) return;
    const prev = v.frozen.prev;
    v.frozen = null;
    if (this.state === 'frozen') this.setState(prev);
  }

  sendSnapshot() {
    const v = this.versus;
    v.send({
      k: 'snap',
      rows: this.snapshotRows(),
      shift: this.grid.shift,
      drops: this.drops,
      current: COLOR_LETTERS[this.current] ?? null,
      next: COLOR_LETTERS[this.next] ?? null,
    });
  }

  snapshotRows() {
    return this.grid.rows.map((row) => row.map((color) => COLOR_LETTERS[color] ?? '.').join(''));
  }

  // Basura al estilo arcade: cada burbuja caída más allá de 2 va al rival
  sendGarbage(dropped) {
    if (dropped > GARBAGE_FREE) this.versus.send({ k: 'garbage', n: Math.min(MAX_GARBAGE, dropped - GARBAGE_FREE) });
  }

  // La basura recibida entra al asentar el siguiente tiro: primer hueco libre con soporte,
  // de arriba abajo y de izquierda a derecha
  applyGarbage() {
    const v = this.versus;
    let n = v.pendingGarbage;
    v.pendingGarbage = 0;
    const colors = this.grid.colorsPresent();
    const palette = colors.length ? colors : VERSUS_COLORS;
    while (n > 0) {
      const cell = this.firstGarbageCell();
      if (!cell) break;
      this.grid.set(cell.r, cell.c, pick(palette, v.shotRng));
      n--;
    }
  }

  firstGarbageCell() {
    for (let r = 0; r <= this.grid.rows.length; r++) {
      for (let c = 0; c < this.grid.cols(r); c++) {
        if (this.grid.get(r, c)) continue;
        if (r === 0 || this.grid.neighbors(r, c).some(([nr, nc]) => this.grid.get(nr, nc))) return { r, c };
      }
    }
    return null;
  }

  get dropWarning() {
    return this.state === 'playing' && this.shotsUntilDrop <= DROP_WARNING_SHOTS;
  }
}

function gridFromSnapshot(rows, shift) {
  const grid = new Grid();
  grid.shift = shift;
  rows.forEach((line, r) => {
    for (let c = 0; c < Math.min(line.length, grid.cols(r)); c++) {
      const color = COLOR_CODES[line[c]];
      if (color) grid.set(r, c, color);
    }
  });
  return grid;
}
