# SPEC 02 — Versus online: dos tableros, basura y revancha

> **Estado:** Implementado
> **Depende de:** SPEC 01
> **Fecha:** 2026-10-01
> **Objetivo:** Convertir la sala de SPEC 01 en una partida versus jugable, con dos tableros sincronizados, envío de basura, victoria/derrota y revancha.

## Por qué existe esta spec

SPEC 01 dejó la tubería de red lista: salas por código, semilla compartida, reconexión y un mensaje `relay` reservado. Hoy termina en el overlay provisional "Partida lista". Esta spec sustituye ese overlay por la partida real. Cada cliente es autoridad de su propio tablero y el servidor solo reenvía mensajes, como se decidió en SPEC 01.

## Alcance

**Entra:**

- PRNG con semilla en `js/rng.js` (mulberry32).
- Uso de la semilla en `js/levels.js`: tablero inicial y filas nuevas iguales para los dos jugadores.
- Modo `versus` en `js/game.js`: tablero inicial generado con la semilla, techo que baja con filas sembradas y tablero limpio que se rellena.
- Dos tableros lado a lado a tamaño real en 320×240. El propio va a la izquierda y el del rival a la derecha, solo de visualización.
- Sincronización por `relay`: snapshot de la rejilla tras cada tiro, ángulo del rival cada ~100 ms y eventos de basura, derrota y abandono.
- Basura al estilo arcade: cada burbuja flotante que cae más allá de 2 envía 1 burbuja al rival.
- Fin de partida: pierde quien cruza la línea límite primero. Empate si los dos pierden antes de recibir la derrota del otro.
- Cuenta atrás 3-2-1 al empezar.
- Congelado de ambos tableros durante la gracia de 10 s si el rival se desconecta.
- Abandonar con P/Esc y confirmación.
- Pantalla de Victoria/Derrota/Empate con "Revancha" y "Salir". La revancha requiere que pulsen los dos y usa una semilla nueva del servidor.
- Mensaje nuevo `rematch` en el protocolo y versión del protocolo subida a `2`.
- HUD versus con apodos y basura pendiente, sin puntuación ni récords.
- Tests de `js/rng.js`, de la revancha en `server/rooms.js` y del protocolo v2.

**Fuera de alcance (specs futuras):**

- Servidor autoritativo y anti-trampas.
- Puntuación en versus, ranking online y récords de versus.
- Mejor de 3 o series de partidas.
- Más de 2 jugadores y espectadores.
- Conservar la partida tras recargar la pestaña: recargar en plena partida cuenta como abandono.
- Tablero del rival en miniatura o layouts para pantallas verticales.
- Pausa compartida.

## Modelo de datos

### RNG (`js/rng.js`)

```js
export function createRng(seed) { /* mulberry32 sobre uint32 → () => float en [0, 1) */ }
export function rngPick(rng, list) { /* elemento de list usando rng */ }
```

Dos flujos por jugador en versus:

- `boardRng = createRng(seed)`: tablero inicial, filas que bajan con el techo y rellenos de tablero limpio. Como solo lo consumen esas inserciones, la fila nº k es idéntica en ambos clientes.
- `shotRng = createRng((seed + you + 1) >>> 0)`: colores del lanzador y de la basura recibida. Es distinto para cada jugador porque sus tiros divergen.

Los modos Arcade e Infinito siguen usando `Math.random`. `randomRow(length, colors, rng = Math.random)` acepta el generador como parámetro opcional.

### Protocolo (`js/net/protocol.js`)

- `PROTOCOL_VERSION = 2`. Un cliente v1 contra un servidor v2 recibe `bad_version` ("Recarga la página").
- Nuevo mensaje cliente → servidor: `{ t: 'rematch' }`.
- Servidor → cliente: reutiliza `{ t: 'start', seed }` para cada revancha.

Contenido de `relay.data` (lo valida el cliente que lo recibe; el servidor solo comprueba que exista `data`):

```js
{ k: 'snap', rows: ['RRYY..BG', ...], shift: 0, drops: 2, current: 'R', next: 'B' } // tras asentar cada tiro
{ k: 'aim', a: -32.5 }        // ángulo en grados, como máximo cada 100 ms
{ k: 'garbage', n: 3 }        // burbujas enviadas al rival
{ k: 'lost' }                 // mi burbuja cruzó la línea
{ k: 'quit' }                 // abandono (P/Esc confirmado o recarga en plena partida)
```

`rows` usa las letras de `COLOR_CODES` y `.` para vacío. 12 filas × 8 letras caben de sobra en `MAX_MESSAGE_BYTES`.

### Sala (`server/rooms.js`)

```js
room.rematch = [false, false]; // se pone a true con { t: 'rematch' }
// Cuando los dos son true: nueva seed, rematch = [false, false], broadcast start { seed }.
// Si un jugador se va o caduca su gracia, la sala se cierra como en SPEC 01.
```

### Estado del juego en versus (`js/game.js`)

```js
game.mode = 'versus';
game.versus = {
  you: 0,                 // índice en la sala
  nicks: ['JAV', 'ANA'],
  boardRng, shotRng,
  pendingGarbage: 0,      // recibida y aún no aplicada
  rival: { rows: [], shift: 0, drops: 0, current: null, next: null, angle: 0 },
  result: null,           // 'win' | 'lose' | 'draw' | null
  resultReason: null,     // 'line' | 'quit' | 'timeout'
};
```

Estados nuevos de `Game`: `countdown` (3 s), `frozen` (rival desconectado) y `versus-end` (pantalla de resultado). `playing` y `gameover-anim` se reutilizan.

### Basura

- Al asentar un tiro, si caen `n` burbujas flotantes con `n > 2`, se envía `{ k: 'garbage', n: n - 2 }`.
- El receptor la acumula en `pendingGarbage` y la aplica al asentar su siguiente tiro, antes de comprobar la línea límite.
- Cada burbuja de basura ocupa el primer hueco libre con soporte, recorriendo desde la fila superior y de izquierda a derecha. El color sale de `shotRng` entre los colores presentes en el tablero.

## Plan de implementación

1. **PRNG con semilla.** `js/rng.js` con `createRng` y `rngPick`. Tests en `server/test/rng.test.js`: la misma semilla produce la misma secuencia, semillas distintas producen secuencias distintas y los valores están en [0, 1).
2. **Semilla en `levels.js`.** `randomRow` acepta `rng` opcional. Arcade e Infinito siguen igual (prueba manual).
3. **Protocolo v2 y revancha en el servidor.** `PROTOCOL_VERSION = 2`, mensaje `rematch` en `validateClientMessage`, `room.rematch` en `rooms.js` y el caso `rematch` en `server/index.js`. Tests: revancha con un solo voto no emite `start`; con dos votos emite `start` con una semilla nueva y reinicia los votos.
4. **Modo versus en `Game` sin red.** `game.startVersus({ seed, you, nicks })` genera el tablero inicial con `boardRng`, usa `shotRng` en el lanzador, baja el techo con filas sembradas y rellena el tablero limpio con 3 filas sembradas. La derrota local lleva a `gameover-anim` → `versus-end`. Prueba manual: una entrada temporal de depuración arranca un versus local con semilla fija.
5. **Renderer con desplazamiento horizontal.** `Renderer` dibuja un tablero con un `offsetX`: el propio en `x = 16` y el rival en `x = 176`, con la misma rejilla de 128 px. Se ajustan el lanzador y la línea límite. Arcade e Infinito siguen centrados. Prueba manual: dos tableros visibles, el derecho vacío.
6. **Tablero del rival.** `drawRivalBoard(game.versus.rival)` pinta la rejilla, el techo según `drops`, el lanzador con `angle` y las burbujas `current`/`next`. Prueba manual alimentando `rival` a mano desde la consola.
7. **Conexión `Lobby` ↔ `Game`.** Al recibir `start`, el lobby cierra `#match-ready`, llama a `game.startVersus` y pasa a estado `countdown` (3-2-1 en el canvas). Se elimina el overlay provisional "Partida lista". El lobby escucha `relay` y lo entrega a `game.onRelay(data)`, y `Game` envía por `onSend(data)`.
8. **Snapshots y ángulo.** Tras asentar cada tiro se envía `snap`. Mientras se apunta se envía `aim` como máximo cada 100 ms y solo si el ángulo cambió. Al recibirlos se actualiza `versus.rival`. Los datos con formato inválido se descartan.
9. **Basura.** Envío al asentar (`n - 2` burbujas si `n > 2`), acumulación en `pendingGarbage`, aplicación en el siguiente asentamiento y contador "+N" en el HUD.
10. **Fin de partida.** Al perder se envía `lost`. Recibir `lost` estando vivo → `win`. Recibirlo tras haber perdido → `draw`. La pantalla `versus-end` muestra "¡Victoria!", "Derrota" o "Empate" con los botones "Revancha" y "Salir".
11. **Revancha y salida.** "Revancha" envía `rematch` y muestra "Esperando al rival…". El siguiente `start` reinicia la partida con la nueva semilla y vuelve a `countdown`. "Salir" envía `leave` y vuelve al menú.
12. **Desconexión y abandono.** `peer-lost` → estado `frozen` con la cuenta atrás de 10 s sobre ambos tableros. `peer-back` → vuelta al estado anterior. `peer-left` en plena partida → `win` con motivo "el rival se fue". P/Esc → confirmación "¿Abandonar?". Confirmar envía `quit` y da `lose` local, y el rival ve "Ganaste: el rival abandonó". Un `resume` tras recargar con la partida en curso envía `quit`.
13. **HUD y documentación.** HUD versus: apodos encima de cada tablero, basura pendiente y sin puntuación. No se llama a `saveHighScore` en versus. `README.md`: el modo Versus online describe las reglas de basura, victoria y revancha.

## Criterios de aceptación

- [ ] `npm test` pasa en verde, con tests de `rng.js`, de la revancha en `rooms.js` y del protocolo v2.
- [ ] `createRng(123)` devuelve la misma secuencia en dos llamadas y `createRng(124)` una distinta (verificado por test).
- [ ] Arcade e Infinito funcionan igual que antes, centrados y con récords.
- [ ] Al unirse el segundo jugador, ambos ven una cuenta atrás 3-2-1 y luego dos tableros lado a lado: el propio a la izquierda.
- [ ] Los dos jugadores empiezan con el mismo tablero inicial.
- [ ] La n-ésima fila que baja con el techo es igual en ambos tableros.
- [ ] El tablero derecho refleja el del rival tras cada tiro suyo, y su lanzador gira mientras apunta.
- [ ] Hacer caer 5 burbujas flotantes añade exactamente 3 burbujas al tablero del rival en su siguiente tiro, y su HUD muestra "+3" mientras tanto.
- [ ] Hacer caer 2 o menos burbujas flotantes no envía basura.
- [ ] Cuando un jugador cruza la línea, él ve "Derrota" y el rival "¡Victoria!".
- [ ] Limpiar el propio tablero en versus añade filas nuevas y la partida continúa.
- [ ] En versus el HUD no muestra puntuación y no se guarda ningún récord en `localStorage`.
- [ ] "Revancha" pulsado por un solo jugador muestra "Esperando al rival…" y no reinicia.
- [ ] "Revancha" pulsado por los dos reinicia la partida con una semilla distinta de la anterior.
- [ ] Desconectar el WiFi de un jugador congela ambos tableros con la cuenta atrás de 10 s. Si vuelve antes, la partida sigue donde estaba.
- [ ] Si el jugador desconectado no vuelve en 10 s, el que queda ve "¡Victoria!" con el motivo de que el rival se fue.
- [ ] P/Esc en versus pide confirmación. Al confirmar, el que abandona ve "Derrota" y el rival "Ganaste: el rival abandonó".
- [ ] Recargar la pestaña en plena partida cuenta como abandono para quien recarga.
- [ ] Un cliente con protocolo v1 contra el servidor nuevo ve "Recarga la página".
- [ ] Un `relay` con datos malformados no lanza errores no capturados en el receptor.

## Decisiones

- **Sí:** dos tableros a tamaño real lado a lado. Cada uno mide 128 px y caben en 320 px. **No:** rival en miniatura (las burbujas de 16 px quedarían ilegibles).
- **Sí:** tablero inicial generado con la semilla, al estilo del modo Infinito. **No:** nivel fijo del Arcade (siempre la misma partida).
- **Sí:** dos flujos de RNG: `boardRng` compartido para el tablero y `shotRng` por jugador para el lanzador y la basura. **No:** un único RNG compartido (se desincroniza en cuanto los jugadores disparan a ritmos distintos).
- **Sí:** mulberry32. Es pequeño, rápido y sin dependencias. **No:** librerías de PRNG.
- **Sí:** los modos en solitario siguen con `Math.random`. No hay motivo para cambiar su comportamiento.
- **Sí:** basura al estilo arcade (`n - 2` por burbujas flotantes caídas). **No:** filas completas por combo (castiga demasiado en una rejilla de 8 columnas).
- **Sí:** la basura se aplica en el siguiente tiro del receptor. Así nunca aparece a mitad de una trayectoria.
- **Sí:** snapshot tras cada tiro + ángulo cada ~100 ms + eventos. **No:** solo snapshots (el tablero del rival parecería muerto mientras apunta). **No:** retransmitir la trayectoria del proyectil (más tráfico sin cambiar el resultado).
- **Sí:** cada cliente decide su propia derrota y la comunica con `lost`. Coherente con "cada cliente es autoridad de su tablero" de SPEC 01.
- **Sí:** empate si un cliente recibe `lost` después de haber perdido él mismo. Es simétrico sin necesidad de reloj compartido.
- **Sí:** limpiar el tablero rellena 3 filas sembradas y la partida sigue. **No:** limpiar = ganar (acortaría las partidas a una carrera de limpieza).
- **Sí:** congelar ambos tableros durante la gracia de 10 s. **No:** que el que queda siga jugando solo (ventaja injusta por un microcorte).
- **Sí:** recargar en plena partida = abandono. **No:** reconstruir la partida tras recargar (necesitaría guardar el estado completo; no compensa ahora).
- **Sí:** P/Esc pide confirmación antes de abandonar. Evita derrotas por pulsar Esc sin querer.
- **Sí:** revancha cuando los dos la piden, con semilla nueva del servidor. **No:** misma semilla (repetiría el mismo tablero).
- **Sí:** protocolo `v: 2`. El mensaje `rematch` es nuevo y un cliente desactualizado debe enterarse.
- **Sí:** el servidor no valida el contenido de `relay.data`; lo valida el receptor. Mantiene el servidor como simple reenviador.
- **Sí:** sin puntuación ni récords en versus. Lo que importa es ganar. **No:** puntos informativos (ruido en un HUD ya apretado).

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| La refactorización del renderer rompe Arcade/Infinito | Paso 5 con `offsetX` por defecto centrado. Criterio de aceptación dedicado. |
| Desincronización del tablero sembrado si algo más consume `boardRng` | Solo las inserciones de filas usan `boardRng`. Todo lo demás (lanzador, basura, efectos) usa `shotRng` o `Math.random`. |
| Un rival modificado envía basura falsa o snapshots trucados | Aceptado entre amigos (decisión de SPEC 01). El receptor limita `n` a 1–20 por mensaje. |
| Inundar el `relay` con mensajes `aim` | Como máximo 10 por segundo y solo si el ángulo cambia. |
| Empates o resultados inconsistentes por latencia | Regla de empate simétrica. Cada lado decide su resultado con lo que recibió. |
| Ambos clientes congelados indefinidamente | `frozen` termina siempre con `peer-back` o `peer-left`, y el servidor garantiza este último a los 10 s. |

## Lo que **no** entra en esta spec

- Servidor autoritativo o anti-trampas.
- Puntuación, ranking o récords en versus.
- Mejor de 3 o series.
- Más de 2 jugadores o espectadores.
- Recuperar la partida tras recargar la pestaña.
- Tablero del rival en miniatura o layout vertical para móvil.
- Pausa compartida.

Cada uno de estos, si llega, va en su propia spec.
