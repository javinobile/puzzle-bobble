// Protocolo de red compartido por el navegador y el servidor (SPEC 01).
// Todos los mensajes son JSON { v, t, ...campos }.

export const PROTOCOL_VERSION = 1;
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
};

export function validateClientMessage(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return false;
  if (msg.v !== PROTOCOL_VERSION) return false;
  const check = Object.hasOwn(CLIENT_SCHEMA, msg.t) ? CLIENT_SCHEMA[msg.t] : null;
  return Boolean(check?.(msg));
}

// Construye un mensaje con la versión actual
export function message(t, fields = {}) {
  return { v: PROTOCOL_VERSION, t, ...fields };
}
