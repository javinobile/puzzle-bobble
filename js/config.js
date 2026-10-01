// Resolución lógica (se escala en CSS con píxeles nítidos)
export const VIEW_W = 320;
export const VIEW_H = 240;

// Tablero hexagonal: filas largas de 8 y filas cortas de 7 desplazadas medio diámetro
export const COLS = 8;
export const BUBBLE = 16;
export const RADIUS = BUBBLE / 2;
export const ROW_H = 14; // ≈ BUBBLE * √3 / 2
export const FIELD_W = COLS * BUBBLE;
export const FIELD_X = (VIEW_W - FIELD_W) / 2;
export const FIELD_TOP = 24;
export const MAX_ROWS = 12; // filas disponibles antes de la línea límite
export const LIMIT_Y = FIELD_TOP + MAX_ROWS * ROW_H + 4;

// Lanzador
export const LAUNCHER_X = VIEW_W / 2;
export const LAUNCHER_Y = 220;
export const MAX_ANGLE = 85; // grados respecto a la vertical
export const AIM_SPEED = 95; // grados por segundo
export const SHOT_SPEED = 330; // px por segundo
export const HIT_DISTANCE = BUBBLE * 0.85;

// Ritmo de juego
export const AUTO_FIRE_MS = 6000;
export const AUTO_FIRE_WARNING_MS = 3000;
export const SHOTS_PER_DROP = 8;
export const DROP_WARNING_SHOTS = 2;
export const ENDLESS_START_ROWS = 5;
export const ENDLESS_MIN_SHOTS = 4;

// Puntuación
export const POP_POINTS = 10;
export const DROP_BASE_POINTS = 10; // 10 · 2^n por n burbujas caídas
export const DROP_MAX_EXP = 17;

// Colores: letra usada en los niveles → nombre
export const COLOR_CODES = {
  B: 'blue',
  R: 'red',
  P: 'purple',
  K: 'gray',
  Y: 'yellow',
  G: 'green',
  O: 'orange',
  W: 'silver',
};
export const ALL_COLORS = Object.values(COLOR_CODES);

// Paleta para el dibujo alternativo (si falta un sprite)
export const FALLBACK_RGB = {
  blue: '#1070f8',
  red: '#e02020',
  purple: '#8830b0',
  gray: '#506060',
  yellow: '#f0d000',
  green: '#00d800',
  orange: '#f0a818',
  silver: '#a8a8d0',
  dead: '#303030',
};

// Móvil (SPEC 03): vista vertical 9:16. La geometría lógica del tablero no cambia;
// el renderer lo dibuja trasladado bajo una franja de HUD.
export const MOBILE_VIEW_W = 180;
export const MOBILE_VIEW_H = 320;
export const MOBILE_HUD_H = 80; // franja superior
export const MOBILE_BOARD_DX = -70; // FIELD_X (96) → 26: tablero + paredes ocupan x 18..162
export const MOBILE_BOARD_DY = 80; // el tablero empieza bajo la franja de HUD
export const MINI_RIVAL_SCALE = 1 / 3; // tablero rival ≈ 43×80 px en la franja
