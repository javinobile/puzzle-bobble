import { ALL_COLORS, ENDLESS_START_ROWS } from './config.js';

// Filas pares: 8 huecos. Filas impares: 7 huecos (desplazadas).
// B azul · R rojo · P morado · K gris · Y amarillo · G verde · O naranja · W plata · '.' vacío
export const LEVELS = [
  {
    shotsPerDrop: 8,
    rows: ['RRYYBBGG', 'RRYYBBG', 'BBGGRRYY', 'BGGRRYY'],
  },
  {
    shotsPerDrop: 8,
    rows: ['...RR...', '..RGR..', '..BGGB..', '.BYYYB.', '.OBYYBO.', 'OO..OO'],
  },
  {
    shotsPerDrop: 8,
    rows: ['BBBBBBBB', 'RRRRRRR', 'YYYYYYYY', 'GGGGGGG', 'B......B', 'R.....R'],
  },
  {
    shotsPerDrop: 7,
    rows: ['G.B.R.Y.', 'G.B.R.Y', 'Y.G.B.R.', 'Y.G.B.R', 'R.Y.G.B.', 'R.Y.G.B'],
  },
  {
    shotsPerDrop: 7,
    rows: ['PPOOOOPP', 'P.OYO.P', 'P.OYYO.P', '..OYO..', '...OO...', 'PBBBBBP', '.B....B.'],
  },
  {
    shotsPerDrop: 7,
    rows: ['RRGGBBYY', 'KRGBBYK', 'KKRGBYKK', '.KRGBK.', '..KRBK..', '..KRK..', '...KK...'],
  },
  {
    shotsPerDrop: 6,
    rows: ['YBRGYBRG', 'OPYBRGO', 'GYBRGYBR', 'OPYBRGO', 'RGYBRGYB', 'O.....P', 'OO....PP'],
  },
  {
    shotsPerDrop: 6,
    rows: ['WWWWWWWW', 'W.....W', 'W.RRYY.W', 'W.RYY.W', 'W.GGBB.W', 'W.GBB.W', 'WWWWWWWW', 'PP...OO'],
  },
  {
    shotsPerDrop: 6,
    rows: ['KPKPKPKP', 'OKOKOKO', 'YOYOYOYO', 'GYGYGYG', 'BGBGBGBG', 'RBRBRBR', 'WRWRWRWR'],
  },
  {
    shotsPerDrop: 5,
    rows: [
      'RRBBGGYY',
      'PRBGGYO',
      'PPKBGWOO',
      'PKKBWWO',
      'YYKRRWBB',
      'GYRRPBG',
      'GG.PP.YY',
      '.O.K.W.',
    ],
  },
];

// Modo Infinito: nuevas filas aleatorias
export function randomRow(length, colors) {
  return Array.from({ length }, () => colors[Math.floor(Math.random() * colors.length)]);
}

export function endlessColors(score) {
  const count = Math.min(ALL_COLORS.length, 4 + Math.floor(score / 8000));
  return ALL_COLORS.slice(0, count);
}

export { ENDLESS_START_ROWS };
