import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  HEARTBEAT_MS,
  HEARTBEAT_TIMEOUT_MS,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  message,
  validateClientMessage,
} from '../js/net/protocol.js';
import { Rooms } from './rooms.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT) || 8080;
const HOST = '0.0.0.0';
const WS_PATH = '/ws';
const TICK_MS = 1000;
// Tope duro del socket: por encima se corta la conexión. Entre MAX_MESSAGE_BYTES
// y este tope se responde `too_big` sin desconectar.
const HARD_PAYLOAD_BYTES = MAX_MESSAGE_BYTES * 4;

// Solo se sirve lo que forma parte del juego (nunca server/, package.json, .git…)
const PUBLIC_FILES = new Set(['index.html', 'styles.css']);
const PUBLIC_DIRS = new Set(['js', 'assets']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Devuelve la ruta absoluta del archivo pedido o null si no es público
function resolvePublic(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const rel = normalize(decoded === '/' ? '/index.html' : decoded).replace(/^[/\\]+/, '');
  const full = resolve(ROOT, rel);
  if (!full.startsWith(ROOT + sep)) return null;
  const [top] = rel.split(/[/\\]/);
  const isPublic = PUBLIC_FILES.has(rel) || (PUBLIC_DIRS.has(top) && rel.length > top.length);
  return isPublic ? full : null;
}

async function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const { pathname } = new URL(req.url, 'http://localhost');
  const file = resolvePublic(pathname);
  const info = file && (await stat(file).catch(() => null));
  if (!info?.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 No encontrado');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}

const server = createServer((req, res) => {
  serveStatic(req, res).catch((err) => {
    console.error('[http] error', err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

// ---------- WebSocket ----------

const rooms = new Rooms();
const sockets = new Map(); // token → ws
const wss = new WebSocketServer({ noServer: true, maxPayload: HARD_PAYLOAD_BYTES });

const log = (...args) => console.log(new Date().toISOString(), ...args);

function send(ws, msg) {
  if (ws?.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function dispatch({ out }) {
  for (const { to, msg } of out) send(sockets.get(to), msg);
}

// Olvida los sockets cuyo token ya no pertenece a ninguna sala
function prune() {
  for (const [token, ws] of sockets) {
    if (rooms.find(token)) continue;
    sockets.delete(token);
    if (ws.token === token) ws.token = null;
  }
}

function bind(ws, token) {
  const previous = sockets.get(token);
  sockets.set(token, ws);
  ws.token = token;
  // Otra pestaña/socket con el mismo token queda desplazada
  if (previous && previous !== ws) {
    previous.token = null;
    previous.close(4000, 'replaced');
  }
}

function roomOf(token) {
  return rooms.find(token)?.room.code ?? '-';
}

function handle(ws, msg) {
  const now = Date.now();
  // Crear, unirse o reanudar desde otra sala implica abandonar la anterior
  if (['create', 'join', 'resume'].includes(msg.t) && ws.token && msg.token !== ws.token) {
    log(`[sala ${roomOf(ws.token)}] ${ws.id} sale para cambiar de sala`);
    dispatch(rooms.leave(ws.token));
    prune();
  }

  switch (msg.t) {
    case 'create':
    case 'join':
    case 'resume': {
      const result =
        msg.t === 'create'
          ? rooms.createRoom(msg.nick, now)
          : msg.t === 'join'
            ? rooms.joinRoom(msg.code, msg.nick, now)
            : rooms.resume(msg.token, now);
      if (result.error) {
        log(`${ws.id} ${msg.t} rechazado: ${result.error}`);
        return send(ws, message('error', { code: result.error }));
      }
      bind(ws, result.token);
      log(`[sala ${roomOf(result.token)}] ${ws.id} ${msg.t}${msg.nick ? ` (${msg.nick})` : ''}`);
      return dispatch(result);
    }
    case 'leave': {
      if (!ws.token) return;
      log(`[sala ${roomOf(ws.token)}] ${ws.id} leave`);
      dispatch(rooms.leave(ws.token));
      return prune();
    }
    case 'ping':
      return send(ws, message('pong', { ts: msg.ts }));
    case 'relay': {
      if (!ws.token) return;
      const relay = message('relay', { data: msg.data });
      for (const to of rooms.peersOf(ws.token)) send(sockets.get(to), relay);
      return;
    }
  }
}

function onMessage(ws, raw, isBinary) {
  if (isBinary) return send(ws, message('error', { code: 'bad_message' }));
  if (raw.length > MAX_MESSAGE_BYTES) return send(ws, message('error', { code: 'too_big' }));
  let msg;
  try {
    msg = JSON.parse(raw.toString('utf8'));
  } catch {
    return send(ws, message('error', { code: 'bad_message' }));
  }
  if (msg?.v !== PROTOCOL_VERSION) return send(ws, message('error', { code: 'bad_version' }));
  if (!validateClientMessage(msg)) return send(ws, message('error', { code: 'bad_message' }));
  handle(ws, msg);
}

let nextId = 1;
wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  ws.id = `c${nextId++}`;
  ws.token = null;
  ws.lastSeen = Date.now();
  log(`${ws.id} conectado desde ${ip}`);

  ws.on('pong', () => (ws.lastSeen = Date.now()));
  ws.on('message', (raw, isBinary) => {
    ws.lastSeen = Date.now();
    try {
      onMessage(ws, raw, isBinary);
    } catch (err) {
      console.error(`[ws] error procesando mensaje de ${ws.id}`, err);
    }
  });
  ws.on('error', (err) => log(`${ws.id} error: ${err.message}`));
  ws.on('close', (code) => {
    log(`${ws.id} desconectado (${code})`);
    if (!ws.token || sockets.get(ws.token) !== ws) return;
    const token = ws.token;
    const room = roomOf(token);
    dispatch(rooms.disconnect(token, Date.now()));
    sockets.delete(token);
    prune();
    log(`[sala ${room}] ${ws.id} en gracia de reconexión`);
  });
});

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname !== WS_PATH) {
    socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

// Heartbeat: detecta sockets zombis (NAT, proxy, WiFi caída)
setInterval(() => {
  const now = Date.now();
  for (const ws of wss.clients) {
    if (now - ws.lastSeen > HEARTBEAT_TIMEOUT_MS) {
      log(`${ws.id} sin respuesta al heartbeat, se corta`);
      ws.terminate();
    } else {
      ws.ping();
    }
  }
}, HEARTBEAT_MS).unref();

// Caducidad de gracias y salas vacías
setInterval(() => {
  const before = rooms.size;
  dispatch(rooms.tick(Date.now()));
  prune();
  if (rooms.size < before) log(`${before - rooms.size} sala(s) cerrada(s) por tiempo; activas: ${rooms.size}`);
}, TICK_MS).unref();

server.listen(PORT, HOST, () => {
  console.log(`BobbleJS en http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  En tu red local: http://${ip}:${PORT}`);
  console.log(`  WebSocket en ${WS_PATH} (protocolo v${PROTOCOL_VERSION})`);
});
