import {
  AUTO_FIRE_MS,
  AUTO_FIRE_WARNING_MS,
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
import { Shooter } from './shooter.js';
import { POP_FRAME_COUNT } from './sprites.js';
import { getHighScore, saveHighScore } from './storage.js';

const POP_FRAME_TIME = 0.06;
const GRAVITY = 700;
const CLEAR_DELAY = 2.2;
const GAME_OVER_DELAY = 1.8;

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export class Game {
  constructor({ sound, input, onStateChange }) {
    this.sound = sound;
    this.input = input;
    this.onStateChange = onStateChange;
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

  // ---------- Inicio de partida ----------

  start(mode) {
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

  // Solo se ofrecen colores que siguen en el tablero
  randomColor() {
    const present = this.grid.colorsPresent();
    if (present.length) return pick(present);
    return pick(this.mode === 'endless' ? endlessColors(this.score) : ['blue', 'red', 'yellow', 'green']);
  }

  refreshQueue() {
    const present = this.grid.colorsPresent();
    if (!present.length) return;
    if (!present.includes(this.current)) this.current = pick(present);
    if (!present.includes(this.next)) this.next = pick(present);
  }

  // ---------- Bucle ----------

  update(dt) {
    this.time += dt;
    if (this.input.consume('mute')) this.onStateChange?.('mute', { muted: this.sound.toggleMute(), game: this });

    switch (this.state) {
      case 'playing':
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
        if (this.stateTimer >= GAME_OVER_DELAY) this.setState('gameover', this.resultInfo());
        break;
      case 'gameover':
      case 'victory':
        this.updateEffects(dt);
        break;
    }
    this.input.endFrame();
  }

  updatePlaying(dt) {
    this.levelTime += dt;
    let direction = 0;
    if (this.input.isHeld('left')) direction -= 1;
    if (this.input.isHeld('right')) direction += 1;
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
      if (this.input.consume('fire') || left <= 0) this.fire();
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

  // La burbuja disparada se pega al tablero y se aplican las reglas
  settle() {
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
      this.dropFloating(true);
    } else {
      this.sound.stick();
    }

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

  dropFloating(scored) {
    const floating = this.grid.findFloating();
    if (!floating.length) return;
    for (const [r, c] of floating) {
      const { x, y } = this.grid.center(r, c, this.top);
      this.falling.push({ x, y, vx: (Math.random() - 0.5) * 60, vy: -60 - Math.random() * 80, color: this.grid.get(r, c) });
      this.grid.remove(r, c);
    }
    if (!scored) return;
    const exp = Math.min(floating.length, DROP_MAX_EXP);
    this.addScore(DROP_BASE_POINTS * 2 ** exp);
    this.sound.drop(floating.length);
  }

  lowerCeiling() {
    if (this.mode === 'arcade') {
      this.drops++;
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

  get dropWarning() {
    return this.state === 'playing' && this.shotsUntilDrop <= DROP_WARNING_SHOTS;
  }
}
