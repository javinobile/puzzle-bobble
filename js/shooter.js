import {
  AIM_SPEED,
  FIELD_W,
  FIELD_X,
  HIT_DISTANCE,
  LAUNCHER_X,
  LAUNCHER_Y,
  MAX_ANGLE,
  RADIUS,
  SHOT_SPEED,
} from './config.js';

export class Shooter {
  constructor() {
    this.angle = 0; // grados: 0 = arriba, negativo = izquierda
  }

  aim(direction, dt) {
    this.angle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, this.angle + direction * AIM_SPEED * dt));
  }

  fire(color) {
    return new Projectile(color, this.angle);
  }
}

export class Projectile {
  constructor(color, angle) {
    const rad = (angle * Math.PI) / 180;
    this.color = color;
    this.x = LAUNCHER_X;
    this.y = LAUNCHER_Y;
    this.vx = Math.sin(rad) * SHOT_SPEED;
    this.vy = -Math.cos(rad) * SHOT_SPEED;
  }

  // Avanza en pequeños pasos; devuelve 'bounce', 'hit' o null
  update(dt, grid, top) {
    const steps = Math.ceil((SHOT_SPEED * dt) / 2);
    let event = null;
    for (let i = 0; i < steps; i++) {
      this.x += (this.vx * dt) / steps;
      this.y += (this.vy * dt) / steps;

      const minX = FIELD_X + RADIUS;
      const maxX = FIELD_X + FIELD_W - RADIUS;
      if (this.x < minX) {
        this.x = 2 * minX - this.x;
        this.vx = Math.abs(this.vx);
        event = 'bounce';
      } else if (this.x > maxX) {
        this.x = 2 * maxX - this.x;
        this.vx = -Math.abs(this.vx);
        event = 'bounce';
      }

      if (this.y - RADIUS <= top || this.collides(grid, top)) return 'hit';
    }
    return event;
  }

  collides(grid, top) {
    for (const { r, c } of grid.cells()) {
      const p = grid.center(r, c, top);
      if ((p.x - this.x) ** 2 + (p.y - this.y) ** 2 < HIT_DISTANCE ** 2) return true;
    }
    return false;
  }
}
