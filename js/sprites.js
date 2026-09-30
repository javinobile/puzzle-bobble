import { FALLBACK_RGB, RADIUS } from './config.js';

// Coordenadas medidas sobre assets/sprites.png (hoja "General Sprites" de Puzzle Bobble)
const LEFT_GROUP = ['blue', 'red', 'purple', 'gray'];
const RIGHT_GROUP = ['yellow', 'green', 'orange', 'silver'];

const bubbleRect = (color) => {
  const left = LEFT_GROUP.indexOf(color);
  if (left >= 0) return [18, 1854 + 33 * left, 16, 16];
  const right = RIGHT_GROUP.indexOf(color);
  if (right >= 0) return [572, 1854 + 33 * right, 16, 16];
  return null;
};

// Animación de explosión: celdas de 32×32, columnas 2..6
const POP_FRAMES = [2, 3, 4, 5, 6];
const popRect = (color, frame) => {
  const col = POP_FRAMES[frame];
  const left = LEFT_GROUP.indexOf(color);
  if (left >= 0) return [171 + 33 * col, 1846 + 33 * left, 32, 32];
  const right = RIGHT_GROUP.indexOf(color);
  if (right >= 0) return [725 + 33 * col, 1846 + 33 * right, 32, 32];
  return null;
};

export const POP_FRAME_COUNT = POP_FRAMES.length;
export const ARROW_FRAMES = 64; // de vertical (0) a horizontal derecha (63)
export const GEAR_FRAMES = 12;

const arrowRect = (i) => [1 + 65 * (i % 16), 1545 + 65 * Math.floor(i / 16), 64, 64];
const gearRect = (i) => [1 + 65 * i, 1805, 64, 40];
const bubRect = (i) => [1 + 33 * i, 2012, 32, 32];
const DEAD_BUBBLE = [18, 1978, 16, 16];

export class Sprites {
  constructor(sheet) {
    this.sheet = sheet;
  }

  blit(ctx, rect, dx, dy) {
    const [sx, sy, w, h] = rect;
    ctx.drawImage(this.sheet, sx, sy, w, h, Math.round(dx), Math.round(dy), w, h);
  }

  bubble(ctx, color, x, y) {
    const rect = color === 'dead' ? DEAD_BUBBLE : bubbleRect(color);
    if (this.sheet && rect) return this.blit(ctx, rect, x - RADIUS, y - RADIUS);
    drawFallbackBubble(ctx, color, x, y);
  }

  pop(ctx, color, frame, x, y) {
    const rect = popRect(color, frame);
    if (this.sheet && rect) return this.blit(ctx, rect, x - 16, y - 16);
    ctx.save();
    ctx.globalAlpha = 1 - frame / POP_FRAME_COUNT;
    ctx.strokeStyle = FALLBACK_RGB[color] ?? '#fff';
    ctx.beginPath();
    ctx.arc(x, y, RADIUS + frame * 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // angle en grados: 0 = vertical, negativo = izquierda
  arrow(ctx, angle, x, y) {
    if (!this.sheet) return drawFallbackArrow(ctx, angle, x, y);
    const frame = Math.min(ARROW_FRAMES - 1, Math.round((Math.abs(angle) / 90) * ARROW_FRAMES));
    const [sx, sy, w, h] = arrowRect(frame);
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    if (angle < 0) ctx.scale(-1, 1);
    ctx.drawImage(this.sheet, sx, sy, w, h, -32, -32, w, h);
    ctx.restore();
  }

  gear(ctx, frame, x, y) {
    if (!this.sheet) {
      ctx.fillStyle = '#c07830';
      ctx.beginPath();
      ctx.arc(x, y + 20, 20, Math.PI, 0);
      ctx.fill();
      return;
    }
    this.blit(ctx, gearRect(frame % GEAR_FRAMES), x, y);
  }

  bub(ctx, frame, x, y) {
    if (!this.sheet) return;
    this.blit(ctx, bubRect(frame), x, y);
  }
}

function drawFallbackBubble(ctx, color, x, y) {
  const base = FALLBACK_RGB[color] ?? '#888';
  const g = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, RADIUS);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.3, base);
  g.addColorStop(1, '#000000');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, RADIUS - 0.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawFallbackArrow(ctx, angle, x, y) {
  const rad = (angle * Math.PI) / 180;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rad);
  ctx.strokeStyle = '#f0c080';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 18);
  ctx.lineTo(0, -30);
  ctx.moveTo(-5, -24);
  ctx.lineTo(0, -30);
  ctx.lineTo(5, -24);
  ctx.stroke();
  ctx.restore();
}
