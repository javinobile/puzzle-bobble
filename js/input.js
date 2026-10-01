const ACTIONS = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'fire',
  Space: 'fire',
  KeyW: 'fire',
  Enter: 'confirm',
  KeyP: 'pause',
  Escape: 'pause',
  KeyM: 'mute',
  ArrowDown: 'down',
  KeyS: 'down',
};

// Mientras se escribe en un campo de texto el teclado no controla el juego
const isTyping = (e) => e.target instanceof HTMLElement && e.target.matches('input, textarea, select, [contenteditable]');

export class Input {
  constructor(onFirstInput) {
    this.held = new Set();
    this.pressed = new Set();
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      const action = ACTIONS[e.code];
      if (!action) return;
      e.preventDefault();
      onFirstInput?.();
      if (!e.repeat) this.pressed.add(action);
      this.held.add(action);
    });
    // keyup no se filtra: soltar una tecla siempre la libera, aunque el foco esté en un campo
    window.addEventListener('keyup', (e) => {
      const action = ACTIONS[e.code];
      if (action) this.held.delete(action);
    });
    window.addEventListener('blur', () => this.held.clear());
  }

  isHeld(action) {
    return this.held.has(action);
  }

  // Devuelve true una sola vez por pulsación
  consume(action) {
    return this.pressed.delete(action);
  }

  endFrame() {
    this.pressed.clear();
  }
}
