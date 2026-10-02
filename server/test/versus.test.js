import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COLOR_CODES } from '../../js/config.js';
import { Grid } from '../../js/grid.js';
import { Game } from '../../js/game.js';
import { validateRelay } from '../../js/net/protocol.js';

// Game sin navegador: sonido mudo y teclado vacío
const sound = new Proxy({}, { get: () => () => {} });
const input = { isHeld: () => false, consume: () => false, endFrame: () => {} };

function versusGame({ seed = 42, you = 0 } = {}) {
  const sent = [];
  const game = new Game({ sound, input });
  game.startVersus({ seed, you, nicks: ['JAV', 'ANA'], send: (data) => sent.push(data) });
  return { game, sent };
}

const snapshot = (game) => game.grid.rows.map((row) => row.join(','));

test('los dos jugadores empiezan con el mismo tablero', () => {
  const a = versusGame({ seed: 1234, you: 0 }).game;
  const b = versusGame({ seed: 1234, you: 1 }).game;
  assert.deepEqual(snapshot(a), snapshot(b));
  assert.ok(a.grid.count() > 0);
  assert.notDeepEqual(snapshot(a), snapshot(versusGame({ seed: 1235 }).game));
});

test('la fila nº k que baja con el techo es igual en ambos aunque disparen distinto', () => {
  const a = versusGame({ seed: 99, you: 0 }).game;
  const b = versusGame({ seed: 99, you: 1 }).game;
  // b consume su generador de tiros más veces que a: no debe afectar al tablero
  for (let i = 0; i < 7; i++) b.randomColor();
  a.lowerCeiling();
  b.lowerCeiling();
  a.lowerCeiling();
  b.lowerCeiling();
  assert.deepEqual(a.grid.rows.slice(0, 2), b.grid.rows.slice(0, 2));
});

test('startVersus arranca con cuenta atrás de 3 s y luego juega', () => {
  const { game } = versusGame();
  assert.equal(game.state, 'countdown');
  for (let i = 0; i < 179; i++) game.update(1 / 60);
  assert.equal(game.state, 'countdown');
  game.update(2 / 60);
  assert.equal(game.state, 'playing');
});

test('hacer caer 5 burbujas envía 3 de basura; 2 o menos no envían nada', () => {
  const { game, sent } = versusGame();
  game.sendGarbage(5);
  game.sendGarbage(2);
  game.sendGarbage(0);
  assert.deepEqual(sent, [{ k: 'garbage', n: 3 }]);
});

test('la basura recibida se aplica en huecos con soporte al asentar el siguiente tiro', () => {
  const { game } = versusGame();
  const before = game.grid.count();
  game.versus.pendingGarbage = 3;
  game.applyGarbage();
  assert.equal(game.grid.count(), before + 3);
  assert.equal(game.versus.pendingGarbage, 0);
  assert.deepEqual(game.grid.findFloating(), []);
});

test('el snapshot enviado es un relay válido', () => {
  const { game, sent } = versusGame();
  game.sendSnapshot();
  assert.equal(sent[0].k, 'snap');
  assert.ok(validateRelay(sent[0]));
});

test('perder en versus envía snap + lost y termina en Derrota sin guardar récord', () => {
  const { game, sent } = versusGame();
  game.setState('playing');
  game.gameOver();
  assert.deepEqual(
    sent.map((d) => d.k),
    ['snap', 'lost'],
  );
  for (let i = 0; i < 200; i++) game.update(1 / 60);
  assert.equal(game.state, 'versus-end');
  assert.equal(game.versus.result, 'lose');
});

test('limpiar el tablero en versus rellena filas y sigue jugando', () => {
  const { game } = versusGame();
  game.setState('playing');
  game.grid.rows = [];
  game.boardCleared();
  assert.equal(game.state, 'playing');
  assert.ok(game.grid.count() > 0);
});

test('abandonar envía quit y da derrota', () => {
  const { game, sent } = versusGame();
  game.setState('playing');
  game.quitVersus();
  assert.deepEqual(sent, [{ k: 'quit' }]);
  assert.equal(game.state, 'versus-end');
  assert.equal(game.versus.result, 'lose');
  assert.equal(game.versus.resultReason, 'quit');
});

test('congelar y descongelar vuelve al estado anterior', () => {
  const { game } = versusGame();
  game.setState('playing');
  game.freeze('peer', 10_000);
  assert.equal(game.state, 'frozen');
  game.update(1);
  assert.equal(game.versus.frozen.left, 9);
  game.freeze('self');
  game.unfreeze('peer');
  assert.equal(game.state, 'frozen');
  game.unfreeze('self');
  assert.equal(game.state, 'playing');
});

// ---------- Datos del rival por relay ----------

test('recibir lost estando vivo da victoria', () => {
  const { game } = versusGame();
  game.setState('playing');
  game.onRelay({ k: 'lost' });
  assert.equal(game.state, 'versus-end');
  assert.equal(game.versus.result, 'win');
  assert.equal(game.versus.resultReason, 'line');
});

test('recibir lost después de haber perdido da empate', () => {
  const { game } = versusGame();
  game.setState('playing');
  game.gameOver();
  game.onRelay({ k: 'lost' });
  for (let i = 0; i < 200; i++) game.update(1 / 60);
  assert.equal(game.state, 'versus-end');
  assert.equal(game.versus.result, 'draw');
});

test('recibir quit da victoria por abandono', () => {
  const { game } = versusGame();
  game.setState('playing');
  game.onRelay({ k: 'quit' });
  assert.equal(game.versus.result, 'win');
  assert.equal(game.versus.resultReason, 'quit');
});

test('la basura recibida se acumula con tope', () => {
  const { game } = versusGame();
  game.onRelay({ k: 'garbage', n: 3 });
  game.onRelay({ k: 'garbage', n: 2 });
  assert.equal(game.versus.pendingGarbage, 5);
  game.onRelay({ k: 'garbage', n: 20 });
  assert.equal(game.versus.pendingGarbage, 20);
});

test('snap y aim actualizan el tablero del rival', () => {
  const a = versusGame({ seed: 5, you: 0 });
  const b = versusGame({ seed: 5, you: 1 });
  a.game.lowerCeiling();
  a.game.sendSnapshot();
  b.game.onRelay(a.sent.at(-1));
  b.game.onRelay({ k: 'aim', a: -30 });
  const rival = b.game.versus.rival;
  assert.deepEqual(snapshot({ grid: rival.grid }), snapshot(a.game));
  assert.equal(rival.grid.shift, a.game.grid.shift);
  assert.equal(rival.targetAngle, -30); // SPEC 04: el ángulo dibujado se interpola
  assert.equal(rival.current, a.game.current);
});

test('un relay malformado no lanza ni cambia el estado', () => {
  const { game } = versusGame();
  game.setState('playing');
  for (const data of [null, 'x', { k: 'snap', rows: 5 }, { k: 'garbage', n: -1 }, { k: 'aim', a: 'x' }, { k: 'nope' }]) {
    assert.doesNotThrow(() => game.onRelay(data));
  }
  assert.equal(game.state, 'playing');
  assert.equal(game.versus.pendingGarbage, 0);
});

test('el ángulo se envía como mucho cada 100 ms y solo si cambia', () => {
  const held = new Set(['left']);
  const sent = [];
  const game = new Game({ sound, input: { ...input, isHeld: (a) => held.has(a) } });
  game.startVersus({ seed: 1, you: 0, nicks: ['A', 'B'], send: (d) => sent.push(d) });
  game.setState('playing');
  for (let i = 0; i < 60; i++) game.update(1 / 60); // 1 s apuntando
  const aims = sent.filter((d) => d.k === 'aim').length;
  assert.ok(aims >= 8 && aims <= 10, `${aims} mensajes aim en 1 s`);
  held.clear();
  sent.length = 0;
  for (let i = 0; i < 60; i++) game.update(1 / 60);
  assert.equal(sent.filter((d) => d.k === 'aim').length, 0);
});

test('perder en versus no guarda récord', () => {
  const writes = [];
  globalThis.localStorage = { getItem: () => null, setItem: (k, v) => writes.push([k, v]) };
  try {
    const { game } = versusGame();
    game.setState('playing');
    game.addScore(999999);
    game.gameOver();
    for (let i = 0; i < 200; i++) game.update(1 / 60);
    assert.equal(game.state, 'versus-end');
    assert.deepEqual(writes, []);
  } finally {
    delete globalThis.localStorage;
  }
});

// ---------- SPEC 04: vista del rival suave ----------

const step = (game, secs) => {
  for (let i = 0; i < Math.round(secs * 60); i++) game.update(1 / 60);
};

function playingGame(opts) {
  const ctx = versusGame(opts);
  ctx.game.setState('playing');
  return ctx;
}

// Tablero con R R . B B B B B arriba y una Y colgando de las R: un tiro R en (0, 2)
// hace explotar 3 y caer 1
function popAndFallGame() {
  const ctx = playingGame();
  const { game } = ctx;
  game.grid = new Grid();
  ['red', 'red', null, 'blue', 'blue', 'blue', 'blue', 'blue'].forEach((color, c) => color && game.grid.set(0, c, color));
  const [[r, c]] = game.grid.neighbors(0, 0).filter(([nr]) => nr === 1);
  game.grid.set(r, c, 'yellow');
  const target = game.grid.center(0, 2, game.top);
  game.projectile = { x: target.x, y: target.y, color: 'red' };
  return ctx;
}

test('el ángulo del rival se interpola: no salta y converge en 0,3 s', () => {
  const { game } = playingGame();
  game.onRelay({ k: 'aim', a: 40 });
  assert.equal(game.versus.rival.angle, 0);
  game.update(1 / 60);
  const first = game.versus.rival.angle;
  assert.ok(first > 0 && first < 40, `primer frame: ${first}`);
  step(game, 0.3 - 1 / 60);
  assert.ok(Math.abs(game.versus.rival.angle - 40) < 0.5, `tras 0,3 s: ${game.versus.rival.angle}`);
});

test('fire() en versus envía exactamente un shot válido', () => {
  const { game, sent } = playingGame();
  game.shooter.angle = -12.34;
  const color = game.current;
  game.fire();
  const shots = sent.filter((d) => d.k === 'shot');
  assert.equal(shots.length, 1);
  assert.ok(validateRelay(shots[0]));
  assert.equal(shots[0].a, -12.3);
  assert.equal(COLOR_CODES[shots[0].c], color);
});

test('shot crea el fantasma, avanza el lanzador del rival y el fantasma se borra al impactar', () => {
  const { game } = playingGame();
  const rival = game.versus.rival;
  rival.current = 'blue';
  rival.next = 'green';
  game.onRelay({ k: 'shot', a: 20, c: 'R' });
  assert.ok(rival.ghost);
  assert.equal(rival.ghost.color, 'red');
  assert.equal(rival.angle, 20);
  assert.equal(rival.current, 'green');
  assert.equal(rival.next, null);
  game.update(1 / 60);
  assert.ok(rival.ghost, 'sigue volando tras un frame');
  step(game, 2);
  assert.equal(rival.ghost, null, 'se borra al impactar con el tablero');
});

test('un snap borra el fantasma', () => {
  const a = playingGame({ seed: 7, you: 0 });
  const b = playingGame({ seed: 7, you: 1 });
  b.game.onRelay({ k: 'shot', a: 0, c: 'B' });
  a.game.sendSnapshot();
  b.game.onRelay(a.sent.at(-1));
  assert.equal(b.game.versus.rival.ghost, null);
});

test('un tiro que hace explotar 3 y caer 1 envía snap con 3 pares en pop y 1 en fall', () => {
  const { game, sent } = popAndFallGame();
  game.settle();
  const snap = sent.find((d) => d.k === 'snap');
  assert.ok(validateRelay(snap));
  assert.equal(snap.pop.length, 3);
  assert.equal(snap.fall.length, 1);
  assert.deepEqual([...snap.pop].sort(), [[0, 0], [0, 1], [0, 2]]);
});

test('el snap de un tiro genera pop y caída en el rival; pares vacíos se ignoran', () => {
  const a = popAndFallGame();
  const b = playingGame({ seed: 42, you: 1 });
  // b ve la rejilla de a antes del tiro
  a.game.sendSnapshot();
  b.game.onRelay(a.sent.at(-1));
  a.game.settle();
  b.game.onRelay(a.sent.at(-1));
  const rival = b.game.versus.rival;
  // (0, 2) era el hueco donde entró el tiro: está vacío en la rejilla previa
  assert.equal(rival.effects.length, 2);
  assert.equal(rival.falling.length, 1);
  assert.equal(rival.falling[0].color, 'yellow');
});

test('snap con pop sobre 3 celdas ocupadas añade 3 efectos; sin pop/fall no añade nada', () => {
  const { game } = playingGame();
  const rival = game.versus.rival;
  const rows = rival.grid.rows.map((row) => row.map(() => '.').join(''));
  const base = { k: 'snap', rows, shift: rival.grid.shift, drops: 0, current: 'R', next: 'B' };
  game.onRelay(base);
  assert.equal(rival.effects.length + rival.falling.length, 0);
  const full = playingGame().game;
  full.onRelay({ ...base, pop: [[0, 0], [0, 1], [0, 2]], fall: [[1, 0], [15, 0]] });
  assert.equal(full.versus.rival.effects.length, 3);
  assert.equal(full.versus.rival.falling.length, 1);
});

test('shot o snap con pop/fall malformado no lanza', () => {
  const { game } = playingGame();
  for (const data of [{ k: 'shot', a: 999, c: 'R' }, { k: 'shot', a: 0, c: 'Z' }, { k: 'snap', rows: [], shift: 0, drops: 0, current: null, next: null, pop: [[0]] }]) {
    assert.doesNotThrow(() => game.onRelay(data));
  }
  assert.equal(game.versus.rival.ghost, null);
  assert.equal(game.versus.rival.effects.length, 0);
});

test('en frozen el fantasma y los efectos del rival no avanzan', () => {
  const { game } = playingGame();
  const rival = game.versus.rival;
  game.onRelay({ k: 'shot', a: 0, c: 'R' });
  game.onRelay({ k: 'aim', a: 30 });
  rival.effects.push({ x: 0, y: 0, color: 'red', t: 0 });
  game.freeze('peer', 10_000);
  const y = rival.ghost.y;
  step(game, 1);
  assert.equal(rival.ghost.y, y);
  assert.equal(rival.effects[0].t, 0);
  assert.equal(rival.angle, 0);
});

test('al terminar y en la revancha el rival empieza sin fantasma ni efectos', () => {
  const { game } = playingGame();
  game.onRelay({ k: 'shot', a: 0, c: 'R' });
  game.versus.rival.effects.push({ x: 0, y: 0, color: 'red', t: 0 });
  game.onRelay({ k: 'quit' });
  assert.equal(game.state, 'versus-end');
  assert.equal(game.versus.rival.ghost, null);
  assert.equal(game.versus.rival.effects.length, 0);
  game.startVersus({ seed: 9, you: 0, nicks: ['JAV', 'ANA'] });
  const rival = game.versus.rival;
  assert.equal(rival.ghost, null);
  assert.deepEqual([rival.effects, rival.falling], [[], []]);
});
