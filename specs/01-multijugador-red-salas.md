# SPEC 01 — Multijugador en red: servidor Node y salas por código

> **Estado:** Implementado
> **Depende de:** —
> **Fecha:** 2026-09-30
> **Objetivo:** Añadir un servidor Node + WebSocket que sirva el juego y empareje a dos jugadores por código de sala, funcionando igual en una WiFi local que detrás de un VPS.

## Por qué existe esta spec

BobbleJS es hoy 100 % estático y no tiene backend. El multijugador versus necesita un servidor, y ese servidor debe servir tanto en LAN (un PC corre `npm start` y el resto entra por su IP) como en un VPS con TLS. Esta spec construye solo la tubería de red. Las reglas del versus (dos tableros, basura, victoria) van en SPEC 02 para no mezclar infraestructura con jugabilidad.

## Alcance

**Entra:**

- `package.json` en la raíz con la dependencia `ws` y los scripts `npm start` y `npm test`.
- Servidor `server/index.js`: sirve los estáticos del proyecto y el WebSocket en la ruta `/ws`, en el mismo puerto (`0.0.0.0`, `PORT` por variable de entorno, por defecto `8080`).
- Lógica pura de salas en `server/rooms.js`, sin dependencias de red, testeable.
- Protocolo JSON versionado (`v: 1`) compartido en `js/net/protocol.js` (lo importan cliente y servidor).
- Salas de 2 jugadores con código de 4 letras; crear, unirse, salir.
- Apodo arcade de 3 caracteres, persistido en `localStorage`.
- Semilla aleatoria generada por el servidor y enviada a ambos al completarse la sala.
- Reconexión con gracia de 10 s mediante token de sesión.
- Heartbeat ping/pong con timeout, expiración de salas vacías, límites anti-abuso y validación de mensajes.
- UI de lobby en `index.html`: opción "Versus online" en el menú, pantalla de apodo + crear/unirse, sala de espera y overlay provisional "Partida lista" con latencia.
- Tests con `node --test` sobre `server/rooms.js` y `js/net/protocol.js`.
- Sección de despliegue en `README.md` (nginx + wss + systemd), solo documentación.

**Fuera de alcance (specs futuras):**

- Jugabilidad versus: dos tableros, snapshots, basura, victoria/derrota, revancha → SPEC 02.
- RNG con semilla en `levels.js` → SPEC 02 (aquí la semilla solo se transmite y se muestra).
- Servidor autoritativo / anti-trampas.
- Más de 2 jugadores, espectadores, lista pública de salas, matchmaking automático.
- Cuentas, ranking online, persistencia en servidor.
- Despliegue real en un VPS (solo se documenta).
- Pausa compartida en online.

## Modelo de datos

### Protocolo (`js/net/protocol.js`)

Todos los mensajes son JSON `{ v: 1, t: '<tipo>', ...campos }`. Mensajes con `v` distinto se rechazan con `error { code: 'bad_version' }`.

```js
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

// Cliente → servidor
// { t: 'create', nick }
// { t: 'join', code, nick }
// { t: 'resume', token }            // reconexión dentro de la gracia
// { t: 'leave' }
// { t: 'ping', ts }                 // medición de latencia del cliente
// { t: 'relay', data }              // reservado para SPEC 02; el servidor lo reenvía al rival

// Servidor → cliente
// { t: 'welcome', token, code, you: 0|1 }
// { t: 'room', code, players: [{ nick, connected }] }
// { t: 'start', seed }              // seed: entero uint32, al llenarse la sala
// { t: 'peer-lost', graceMs }       // el rival perdió conexión
// { t: 'peer-back' }
// { t: 'peer-left', reason: 'left'|'timeout' }  // el rival se fue: fin de sala
// { t: 'pong', ts }
// { t: 'relay', data }
// { t: 'error', code }              // bad_version | bad_message | too_big | room_not_found | room_full | server_full | bad_token

export function validateClientMessage(msg) { /* true/false según esquema anterior */ }
```

### Sala (`server/rooms.js`, en memoria)

```js
// rooms: Map<code, Room>
const room = {
  code: 'KXQM',
  seed: null,            // uint32 al llenarse
  createdAt: 0,
  emptySince: null,      // ms; se borra si supera EMPTY_ROOM_TTL_MS
  players: [             // índice = `you` (0 anfitrión, 1 invitado)
    { nick: 'JAV', token: '<uuid>', connected: true, lostAt: null },
  ],
};
```

`rooms.js` expone funciones puras que reciben `now` y devuelven mensajes a emitir (no toca sockets): `createRoom`, `joinRoom`, `resume`, `leave`, `disconnect`, `tick(now)`. `server/index.js` solo traduce entre sockets y estas funciones.

### Cliente

- `localStorage['bobblejs.nickname']` → apodo (string, validado con `NICK_RE`).
- `sessionStorage['bobblejs.session']` → `{ token, code }` para reanudar tras recarga o microcorte.
- URL del WebSocket: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`.

## Plan de implementación

1. **Esqueleto del servidor estático.** `package.json` (`"type": "module"`, dep `ws`, scripts `start` y `test`) y `server/index.js` con `http` + `fs` que sirve `index.html`, `styles.css`, `js/`, `assets/` con MIME correcto y bloquea rutas fuera de la raíz (`..`). Prueba manual: `npm start` y el juego actual carga en `http://localhost:8080` y desde otro dispositivo en `http://<IP-LAN>:8080`.
2. **Protocolo compartido.** `js/net/protocol.js` con constantes y `validateClientMessage`. Tests en `server/test/protocol.test.js`.
3. **Lógica de salas.** `server/rooms.js` con crear/unirse/salir, generación de código sin colisiones, `MAX_ROOMS`, semilla al llenarse. Tests: crear, unirse, sala llena, código inexistente, servidor lleno.
4. **Gracia, reconexión y expiración.** `disconnect`, `resume` y `tick(now)` en `rooms.js`: gracia de `RECONNECT_GRACE_MS` → `peer-left { reason: 'timeout' }`; salas vacías borradas tras `EMPTY_ROOM_TTL_MS`. Tests con `now` inyectado.
5. **WebSocket en el servidor.** `WebSocketServer({ noServer: true })` en `/ws` sobre el mismo `http.Server`; límite `maxPayload: MAX_MESSAGE_BYTES`; parseo + validación; heartbeat `ws.ping()` cada `HEARTBEAT_MS` y cierre si no hay pong en `HEARTBEAT_TIMEOUT_MS`; `setInterval` que llama a `rooms.tick`; reenvío de `relay` al rival; respuesta a `ping` con `pong`. Log de una línea por conexión/sala.
6. **Cliente de red.** `js/net/client.js` con clase `NetClient` (conectar, enviar, `on(tipo, fn)`, reintento automático con `resume` mientras haya sesión en `sessionStorage`, medición de ping cada 2 s). Sin UI todavía; prueba manual desde la consola del navegador.
7. **Input compatible con formularios.** En `js/input.js`, ignorar `keydown`/`keyup` cuyo `target` sea `input`/`textarea`, para poder escribir apodo y código (hoy `A`, `D`, `W`, `S`, espacio hacen `preventDefault`).
8. **Lobby en el menú.** En `index.html`: botón "Versus online" (`data-action="online"`, no `data-mode`) y overlays `#online` (apodo + "Crear sala" + campo código + "Unirse"), `#room` (código grande, jugadores, "Esperando rival…", Salir) y `#match-ready` (código, apodos, semilla, ping en ms, avisos de rival desconectado con cuenta atrás, Salir). Controlador en `js/lobby.js`; `main.js` solo lo instancia y le cede el menú. El `Game` sigue en estado `menu` mientras dura el lobby. Estilos en `styles.css`.
9. **Estados de error y desconexión en UI.** Mensajes legibles para cada `error.code`, "Sin conexión con el servidor" si el socket no abre (p. ej. abierto con `npx serve`), cuenta atrás de 10 s en `peer-lost`, vuelta a `#online` con aviso en `peer-left`.
10. **Documentación.** `README.md`: sección "Multijugador" (jugar en LAN: `npm install && npm start`, entrar por `http://<IP>:8080`) y "Despliegue en VPS" (unidad systemd, bloque nginx con `proxy_pass`, cabeceras `Upgrade`/`Connection` y TLS). Actualizar el árbol de estructura.

## Criterios de aceptación

- [ ] `npm install && npm start` arranca en el puerto 8080 y `PORT=9000 npm start` en el 9000.
- [ ] El juego en solitario (Arcade e Infinito) funciona igual servido por `npm start` que con `npx serve .`.
- [ ] Una petición a `/../package.json` o similar no devuelve archivos fuera de la raíz del proyecto.
- [ ] Un segundo dispositivo en la misma WiFi abre `http://<IP-LAN>:8080` y ve el menú.
- [ ] Se pueden teclear letras A, D, W, S y espacio en los campos de apodo y código.
- [ ] El apodo se limita a 3 caracteres A–Z/0–9 y persiste tras recargar.
- [ ] "Crear sala" muestra un código de 4 letras sin I ni O.
- [ ] Unirse con ese código desde otro navegador lleva a ambos a "Partida lista" con la misma semilla y el apodo del rival.
- [ ] Un tercer jugador que usa el mismo código recibe el mensaje de sala llena.
- [ ] Un código inexistente muestra el mensaje de sala no encontrada.
- [ ] "Partida lista" muestra un ping en ms que se actualiza al menos cada 2 s.
- [ ] Recargar la pestaña de un jugador en "Partida lista" lo devuelve a la misma sala en menos de 10 s y el rival ve el aviso y luego la recuperación.
- [ ] Cerrar la pestaña de un jugador hace que el rival, tras 10 s, vuelva al lobby con aviso de que el rival se fue.
- [ ] Un mensaje mayor de 4 KB o con JSON inválido no tumba el servidor.
- [ ] Una sala vacía desaparece del servidor en 60 s (verificado por test).
- [ ] Abrir el juego con `npx serve .` y pulsar "Versus online" muestra "Sin conexión con el servidor" sin errores no capturados.
- [ ] `npm test` pasa en verde.
- [ ] El README documenta cómo jugar en LAN y un ejemplo nginx + systemd para VPS.

## Decisiones

- **Sí:** servidor Node + `ws`. Mismo proceso en LAN y VPS; solo cambia quién lo ejecuta.
- **No:** WebRTC P2P. Añade señalización + STUN/TURN para un 1v1 que no lo necesita.
- **No:** host en el navegador. Un navegador no puede abrir un servidor WebSocket.
- **Sí:** estáticos y WebSocket en el mismo puerto y origen. El cliente deriva la URL de `location`, sin configuración y sin CORS.
- **Sí:** servidor estático propio con `http` + `fs`. **No:** Express. Una única dependencia (`ws`).
- **Sí:** código de sala de 4 letras. Funciona igual en LAN y en Internet. **No:** lista pública de salas (expone salas a desconocidos en VPS). **No:** matchmaking automático.
- **Sí:** solo 2 jugadores. Encaja con dos tableros en 320×240. 2–4 jugadores en otra spec si llega.
- **Sí:** cada cliente es autoridad de su tablero (se aplicará en SPEC 02); el servidor solo reenvía `relay`. Aceptable entre amigos. **No:** servidor autoritativo por ahora.
- **Sí:** semilla generada por el servidor al llenarse la sala. Ambos clientes arrancarán igual en SPEC 02.
- **Sí:** partida única con revancha en SPEC 02. **No:** mejor de 3.
- **Sí:** gracia de 10 s con token de reconexión en `sessionStorage`. **No:** victoria inmediata (castiga microcortes de WiFi).
- **Sí:** si los dos jugadores quedan desconectados a la vez, la sala se cierra al momento. La gracia de 10 s solo aplica mientras queda alguien conectado o el anfitrión espera solo.
- **Sí:** sin pausa en online; P/Esc abrirá "Abandonar" en SPEC 02.
- **Sí:** protocolo con campo `v`. Permite detectar clientes desactualizados tras un despliegue.
- **Sí:** `rooms.js` puro con `now` inyectado, testeado con `node --test`. **No:** frameworks de test.
- **Sí:** SPEC 01 termina en un overlay provisional "Partida lista". Valida la tubería de red completa sin tocar `game.js`.
- **Sí:** dividir el multijugador en dos specs (red → versus). El feature completo tocaba cuatro áreas.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Firewall de macOS/Windows bloquea el puerto 8080 en LAN | README indica permitir Node en el firewall. El servidor escucha en `0.0.0.0` y muestra la IP LAN al arrancar. |
| Proxy inverso cierra WebSockets inactivos | Heartbeat cada 5 s. El README incluye `proxy_read_timeout` en nginx. |
| Contenido mixto: página por HTTPS e intento de `ws://` | La URL se deriva de `location.protocol` (`wss` en HTTPS). |
| Cliente y servidor en versiones distintas tras desplegar | Campo `v` y error `bad_version` con mensaje "Recarga la página". |
| Fuga de memoria por salas abandonadas en un proceso de larga vida | `tick` borra salas vacías tras 60 s y `MAX_ROOMS = 200`. |
| Los atajos de teclado del juego se comen las teclas al escribir | Paso 7: `Input` ignora eventos cuyo target es un campo de texto. |
| Recorrido de rutas en el servidor estático | Normalizar la ruta y rechazar la que salga de la raíz. Criterio de aceptación dedicado. |

## Lo que **no** entra en esta spec

- Jugabilidad versus: dos tableros, basura, victoria, revancha (SPEC 02).
- RNG con semilla en la generación de tableros (SPEC 02).
- Servidor autoritativo o anti-trampas.
- Más de 2 jugadores, espectadores, lista de salas, matchmaking.
- Cuentas, ranking online, persistencia en servidor.
- Despliegue real en un VPS.

Cada uno de estos, si llega, va en su propia spec.
