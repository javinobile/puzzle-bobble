import { LAUNCHER_X, LAUNCHER_Y, MAX_ANGLE, MOBILE_BOARD_DX, MOBILE_BOARD_DY, MOBILE_VIEW_H, MOBILE_VIEW_W } from './config.js';

// Entrada táctil (SPEC 03): arrastrar para apuntar, soltar para disparar.

// Pantalla → coordenadas lógicas del tablero: deshace el escalado CSS del canvas y la traslación móvil
export function toLogical(clientX, clientY, canvasRect) {
  const x = ((clientX - canvasRect.left) * MOBILE_VIEW_W) / canvasRect.width;
  const y = ((clientY - canvasRect.top) * MOBILE_VIEW_H) / canvasRect.height;
  return { x: x - MOBILE_BOARD_DX, y: y - MOBILE_BOARD_DY };
}

// Grados respecto a la vertical hacia el punto (negativo = izquierda), recortado a ±MAX_ANGLE
export function aimAngleToward(x, y) {
  const deg = (Math.atan2(x - LAUNCHER_X, LAUNCHER_Y - y) * 180) / Math.PI;
  return Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, deg));
}

// Soltar por debajo del lanzador cancela el tiro
export function isCancelZone(y) {
  return y > LAUNCHER_Y;
}

// Misma interfaz que Input (isHeld, consume, endFrame) más un ángulo absoluto.
// El teclado físico no se escucha: en móvil solo hay control táctil.
export class TouchInput {
  constructor(canvas, onFirstInput) {
    this.canvas = canvas;
    this.pressed = new Set();
    this.aimAngle = null; // grados mientras el dedo está apoyado; null si no hay dedo
    this.pointerId = null;

    canvas.addEventListener('pointerdown', (e) => {
      if (this.pointerId !== null) return; // solo el primer dedo apunta
      e.preventDefault();
      onFirstInput?.();
      this.pointerId = e.pointerId;
      canvas.setPointerCapture?.(e.pointerId);
      this.track(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.pointerId) this.track(e);
    });
    canvas.addEventListener('pointerup', (e) => {
      if (e.pointerId !== this.pointerId) return;
      const { y } = this.locate(e);
      if (!isCancelZone(y)) this.pressed.add('fire');
      this.release();
    });
    canvas.addEventListener('pointercancel', (e) => {
      if (e.pointerId === this.pointerId) this.release();
    });
  }

  locate(e) {
    return toLogical(e.clientX, e.clientY, this.canvas.getBoundingClientRect());
  }

  track(e) {
    const { x, y } = this.locate(e);
    this.aimAngle = aimAngleToward(x, y);
  }

  release() {
    this.pointerId = null;
    this.aimAngle = null;
  }

  // Los botones ⏸ y 🔊 inyectan 'pause' y 'mute'
  press(action) {
    this.pressed.add(action);
  }

  isHeld() {
    return false;
  }

  consume(action) {
    return this.pressed.delete(action);
  }

  endFrame() {
    this.pressed.clear();
  }
}
