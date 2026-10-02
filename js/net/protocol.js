// Protocolo de red compartido por el navegador y el servidor (SPEC 01, v2 en SPEC 02, v3 en SPEC 04).
// Todos los mensajes son JSON { v, t, ...campos }.

export const PROTOCOL_VERSION = 3;
export const MAX_MESSAGE_BYTES = 4096;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin I ni O
export const ROOM_CODE_LENGTH = 4;
export const NICK_RE = /^[A-Z0-9]{1,3}$/;
export const RECONNECT_GRACE_MS = 10_000;
export const HEARTBEAT_MS = 5_000;
export const HEARTBEAT_TIMEOUT_MS = 15_000;
export const EMPTY_ROOM_TTL_MS = 60_000;
export const MAX_ROOMS = 200;

export const ERROR_CODES = [
  'bad_version',
  'bad_message',
  'too_big',
  'room_not_found',
  'room_full',
  'server_full',
  'bad_token',
];

const ROOM_CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
const TOKEN_RE = /^[A-Za-z0-9-]{8,64}$/;

const isNick = (value) => typeof value === 'string' && NICK_RE.test(value);
const isRoomCode = (value) => typeof value === 'string' && ROOM_CODE_RE.test(value);

// Campos obligatorios de cada mensaje cliente → servidor
const CLIENT_SCHEMA = {
  create: (m) => isNick(m.nick),
  join: (m) => isRoomCode(m.code) && isNick(m.nick),
  resume: (m) => typeof m.token === 'string' && TOKEN_RE.test(m.token),
  leave: () => true,
  ping: (m) => Number.isFinite(m.ts),
  relay: (m) => 'data' in m,
  rematch: () => true,
};

export function validateClientMessage(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return false;
  if (msg.v !== PROTOCOL_VERSION) return false;
  const check = Object.hasOwn(CLIENT_SCHEMA, msg.t) ? CLIENT_SCHEMA[msg.t] : null;
  return Boolean(check?.(msg));
}

// ---------- Contenido de relay (SPEC 02) ----------
// El servidor reenvía `data` sin mirarlo; lo valida el cliente que lo recibe.
//   { k: 'snap', rows: ['RRYY..BG', …], shift, drops, current, next, pop?, fall? }  tras asentar cada tiro
//                          pop/fall (SPEC 04): pares [r, c] en la rejilla anterior al tiro
//   { k: 'aim', a }        ángulo del lanzador en grados
//   { k: 'shot', a, c }    disparo (SPEC 04): ángulo y letra del color
//   { k: 'garbage', n }    burbujas de basura enviadas al rival
//   { k: 'lost' }          mi burbuja cruzó la línea
//   { k: 'quit' }          abandono

export const MAX_GARBAGE = 20;
const SNAP_ROW_RE = /^[BRPKYGOW.]{0,8}$/;
const COLOR_LETTER_RE = /^[BRPKYGOW]$/;
const MAX_SNAP_ROWS = 20;
const SNAP_COLS = 8;
const MAX_CELL_PAIRS = 96; // 12 filas × 8

const isAngle = (value) => Number.isFinite(value) && Math.abs(value) <= 90;
// Opcional: ausente equivale a []
const isCellList = (value) =>
  value === undefined ||
  (Array.isArray(value) &&
    value.length <= MAX_CELL_PAIRS &&
    value.every(
      (pair) =>
        Array.isArray(pair) &&
        pair.length === 2 &&
        Number.isInteger(pair[0]) &&
        pair[0] >= 0 &&
        pair[0] < MAX_SNAP_ROWS &&
        Number.isInteger(pair[1]) &&
        pair[1] >= 0 &&
        pair[1] < SNAP_COLS,
    ));

const isColorLetter = (value) => value === null || (typeof value === 'string' && COLOR_LETTER_RE.test(value));
const isSmallInt = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;

const RELAY_SCHEMA = {
  snap: (d) =>
    Array.isArray(d.rows) &&
    d.rows.length <= MAX_SNAP_ROWS &&
    d.rows.every((row) => typeof row === 'string' && SNAP_ROW_RE.test(row)) &&
    (d.shift === 0 || d.shift === 1) &&
    isSmallInt(d.drops, MAX_SNAP_ROWS) &&
    isColorLetter(d.current) &&
    isColorLetter(d.next) &&
    isCellList(d.pop) &&
    isCellList(d.fall),
  aim: (d) => isAngle(d.a),
  shot: (d) => isAngle(d.a) && typeof d.c === 'string' && COLOR_LETTER_RE.test(d.c),
  garbage: (d) => Number.isInteger(d.n) && d.n >= 1 && d.n <= MAX_GARBAGE,
  lost: () => true,
  quit: () => true,
};

export function validateRelay(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const check = Object.hasOwn(RELAY_SCHEMA, data.k) ? RELAY_SCHEMA[data.k] : null;
  return Boolean(check?.(data));
}

// Construye un mensaje con la versión actual
export function message(t, fields = {}) {
  return { v: PROTOCOL_VERSION, t, ...fields };
}
