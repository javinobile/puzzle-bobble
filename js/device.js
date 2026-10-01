// Detección de móvil (SPEC 03): por capacidades, una sola vez al cargar.
// Puntero principal táctil (coarse) y pantalla con toques. El User-Agent no se usa.

// Pura y testeable: recibe el entorno en lugar de leer window
export function detectMobile(env) {
  const coarse = Boolean(env?.matchMedia?.('(pointer: coarse)')?.matches);
  return coarse && (env.maxTouchPoints ?? 0) > 0;
}

export const IS_MOBILE =
  typeof window !== 'undefined' &&
  detectMobile({ matchMedia: window.matchMedia?.bind(window), maxTouchPoints: navigator.maxTouchPoints });
