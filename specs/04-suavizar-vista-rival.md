# SPEC 04 — Versus: vista del rival suave

> **Estado:** Implementada
> **Depende de:** SPEC 02, SPEC 03
> **Fecha:** 2026-10-02
> **Objetivo:** Que el tablero del rival en versus se vea fluido, con la flecha girando suave, su burbuja volando y sus explosiones y caídas animadas, sin cambiar quién es autoridad de cada tablero.

## Por qué existe esta spec

Al jugar PC contra móvil, el tablero del rival se ve entrecortado. La causa no es la latencia, que en una WiFi local es de pocos ms. Es cómo SPEC 02 envía y dibuja los datos del rival:

- El ángulo llega como mucho cada 100 ms (`AIM_SEND_SECS`) y `drawRivalBoard` lo pinta tal cual. La flecha avanza a saltos, a unos 10 fps.
- Mientras su burbuja vuela no se envía nada. La burbuja aparece de golpe en el tablero al llegar el `snap`.
- Las explosiones y caídas no se transmiten. En el tablero del rival las burbujas desaparecen de golpe.

Esta spec suaviza las tres cosas. El `snap` sigue siendo la verdad del tablero del rival, como en SPEC 02.

## Alcance

**Entra:**

- Interpolación del ángulo del rival en el cliente: `rival.targetAngle` recibe el `aim` y `rival.angle` se acerca con un lerp exponencial en cada frame.
- Nuevo relay `{ k: 'shot', a, c }` enviado en `fire()` durante el versus.
- Burbuja fantasma en el tablero del rival: un `Projectile` de `js/shooter.js` simulado sobre `rival.grid` hasta el impacto, momento en que desaparece.
- Al recibir `shot`, el lanzador del rival muestra `current ← next` y `next` vacío hasta el siguiente `snap`.
- Campos nuevos `pop` y `fall` en el `snap`: las celdas que explotaron y las que cayeron en ese tiro.
- Efectos de pop y caída en el tablero del rival a partir de `pop` y `fall`, sin sonido.
- Todo lo anterior se dibuja igual en escritorio (tamaño real) y en la miniatura móvil a escala 1/3 de SPEC 03.
- `PROTOCOL_VERSION` sube a `3`.
- Tests en `server/test/versus.test.js` y `server/test/protocol.test.js`.

**Fuera de alcance (specs futuras):**

- Rendimiento del tablero propio en móvil. Si se entrecorta, es rendimiento y no red.
- Animación de las filas que bajan con el techo y de la basura que entra en el tablero del rival. Siguen apareciendo de golpe.
- Sonido de los efectos del rival.
- Predicción, extrapolación o compensación de latencia. No hay rollback.
- Servidor autoritativo o anti-trampas.

## Modelo de datos

### Protocolo (`js/net/protocol.js`)

- `PROTOCOL_VERSION = 3`. Un cliente v2 contra un servidor v3 recibe `bad_version` ("Recarga la página").
- El servidor no cambia: sigue sin validar el contenido de `relay.data`.

Contenido nuevo o ampliado de `relay.data` (lo valida el receptor en `RELAY_SCHEMA`):

```js
{ k: 'shot', a: -32.5, c: 'R' }      // al disparar: ángulo en grados (|a| <= 90) y letra de COLOR_CODES
{ k: 'snap', rows, shift, drops, current, next,
  pop:  [[3, 4], [3, 5], [4, 4]],    // celdas que explotaron en este tiro
  fall: [[5, 2]] }                   // celdas que cayeron por quedar sueltas
```

- `pop` y `fall` son opcionales. Si faltan, equivalen a `[]`. Los snaps que no vienen de un tiro (por ejemplo el de `game.js:406`) no los llevan.
- Cada par `[r, c]` está en coordenadas de la rejilla **anterior al tiro**: antes de aplicar basura y antes de bajar el techo. Es la misma rejilla que el receptor tiene en `rival.grid` desde el `snap` previo.
- Validación: arrays de como máximo 96 pares (12 × 8), con `r` y `c` enteros no negativos y dentro de `MAX_SNAP_ROWS` y del ancho de fila.

### Estado del rival (`js/game.js`)

```js
game.versus.rival = {
  rows: [], shift: 0, drops: 0, current: null, next: null,
  angle: 0,          // ángulo dibujado (interpolado)
  targetAngle: 0,    // último ángulo recibido por 'aim' o 'shot'
  ghost: null,       // Projectile en vuelo o null
  effects: [],       // { x, y, color, t }, mismo formato que game.effects
  falling: [],       // { x, y, vx, vy, color }, mismo formato que game.falling
};
```

- Constante nueva `RIVAL_AIM_TAU = 0.05` (s) en `js/game.js`. Cada frame: `angle += (targetAngle - angle) * (1 - Math.exp(-dt / RIVAL_AIM_TAU))`.
- Las coordenadas de `ghost`, `effects` y `falling` son las del tablero lógico, sin desplazamiento. `drawRivalBoard` ya dibuja dentro de la traslación del rival (escritorio) o de la escala de la miniatura (móvil).

## Plan de implementación

1. **Protocolo v3.** `PROTOCOL_VERSION = 3`. `shot` en `RELAY_SCHEMA` y campos opcionales `pop`/`fall` en `snap`. Tests en `protocol.test.js`: la versión es 3, `shot` válido pasa, `shot` con ángulo > 90, color desconocido o sin campos se rechaza, `snap` sin `pop`/`fall` sigue siendo válido, `pop` con pares malformados o más de 96 pares se rechaza. Se actualiza el test "la versión del protocolo es 2".
2. **Interpolación del ángulo.** `onRelay('aim')` escribe `rival.targetAngle`. `rival.angle` se acerca con el lerp exponencial en la actualización del versus, salvo en `frozen`. `drawRivalBoard` no cambia: ya dibuja `rival.angle`. Test: tras un `aim` de 40°, `angle` no salta en el primer frame y está a menos de 0,5° del objetivo tras 0,3 s simulados.
3. **Envío de `shot`.** En `fire()`, si `mode === 'versus'` y el jugador no ha perdido, se envía `{ k: 'shot', a, c }` con el ángulo redondeado a 0,1° y la letra del color disparado. Test: llamar a `fire()` en versus añade exactamente un `shot` a `sent`.
4. **Burbuja fantasma.** Al recibir `shot`: `targetAngle` y `angle` pasan a `a`, `ghost = new Projectile(color, a)`, `current ← next` y `next ← null`. El fantasma avanza con `ghost.update(dt, rival.grid, top)` usando el `top` del rival. Al devolver `'hit'` se pone a `null`. Un `snap` nuevo también lo borra. `drawRivalBoard` dibuja el fantasma si existe. Tests: un `shot` crea el fantasma, se borra al impactar en una rejilla simulada y se borra al llegar un `snap`. Prueba manual: se ve volar la burbuja del rival.
5. **`pop` y `fall` en el emisor.** `settleProjectile` guarda las celdas del grupo que explota y `dropFloating` las que caen, ambas antes de basura y techo. `sendSnapshot` las incluye. Test: un tiro que hace explotar 3 y caer 1 envía un `snap` con 3 pares en `pop` y 1 en `fall`.
6. **Efectos en el receptor.** Al recibir un `snap`, antes de sustituir `rival.grid`, cada par de `pop` genera un efecto en `rival.effects` y cada par de `fall` una caída en `rival.falling`. El color y la posición salen de la rejilla anterior con su `top`. Los pares que apuntan a una celda vacía se ignoran. Se reutiliza la lógica de `updateEffects` para avanzar los efectos del rival, y `drawRivalBoard` los dibuja con los mismos sprites. No suena nada. Tests: un `snap` con `pop` de 3 celdas añade 3 entradas a `rival.effects`, uno con `fall` añade entradas a `rival.falling` y un par sobre una celda vacía no añade nada.
7. **Limpieza de estado.** `ghost`, `effects` y `falling` del rival se vacían en `startVersus`, en la revancha y al entrar en `versus-end`. En `frozen` no avanzan.
8. **Documentación.** `README.md`: nota en "Reglas del versus" de que el tablero del rival se anima (flecha, tiro, explosiones) y de que el protocolo es v3.

## Criterios de aceptación

- [ ] `npm test` pasa en verde, con los tests nuevos de `versus.test.js` y `protocol.test.js`.
- [ ] `PROTOCOL_VERSION` es 3 y un cliente v2 contra el servidor nuevo ve "Recarga la página".
- [ ] Tras recibir un `aim`, `rival.angle` no salta al valor recibido en el primer frame y está a menos de 0,5° de él tras 0,3 s (verificado por test).
- [ ] Con dos navegadores (PC y móvil emulado), la flecha del rival gira sin saltos visibles, también cuando el rival apunta con el dedo.
- [ ] Al disparar el rival, su burbuja se ve salir del lanzador, rebotar en las paredes y llegar al tablero.
- [ ] Mientras vuela el fantasma, el lanzador del rival no muestra la burbuja disparada y su `next` está vacío.
- [ ] Al asentarse el tiro del rival, las burbujas que explotan muestran la animación de pop y las que caen se ven caer.
- [ ] Los efectos del rival no suenan.
- [ ] En móvil, la miniatura del rival muestra la flecha suave, el fantasma y los efectos.
- [ ] Un `relay` `shot` o `snap` con `pop`/`fall` malformado no lanza errores no capturados en el receptor.
- [ ] Un `snap` sin `pop` ni `fall` se acepta y no genera efectos.
- [ ] Durante `frozen` el fantasma y los efectos del rival no avanzan.
- [ ] Tras una revancha, el tablero del rival empieza sin fantasma ni efectos.
- [ ] Arcade e Infinito funcionan igual que antes.

## Decisiones

- **Sí:** lerp exponencial del ángulo con constante de tiempo de 50 ms. Alcanza el objetivo antes del siguiente `aim` y sigue a un rival táctil. **No:** girar a `AIM_SPEED` (95°/s), porque con el dedo el ángulo salta y la flecha se quedaría cientos de ms atrás. **No:** interpolar entre los dos últimos `aim` con un buffer, porque añade 100 ms de retraso visual y más código.
- **Sí:** relay `shot` con ángulo y color, y el receptor simula la trayectoria con el `Projectile` existente. **No:** retransmitir la trayectoria del proyectil (más tráfico sin cambiar el resultado, decisión de SPEC 02).
- **Sí:** el fantasma desaparece al impactar y espera al `snap`. El `snap` sale en el mismo frame de asentamiento del emisor, así que el hueco es mínimo. **No:** pegarlo en la celda libre más cercana (duplica reglas y puede no coincidir si entra basura).
- **Sí:** al recibir `shot`, `current ← next` y `next` vacío. Así la burbuja no se ve a la vez en el lanzador y volando.
- **Sí:** el emisor envía `pop` y `fall` en el `snap`. Es exacto y barato. **No:** deducirlos por diff en el receptor (falla con el techo que baja, el relleno de tablero limpio y la basura). **No:** tratar todo como pop (menos fiel).
- **Sí:** pares `[r, c]` en la rejilla previa al tiro, de la que el receptor toma color y posición. **No:** triples con color (ocupan más y el receptor ya tiene el color). **No:** píxeles (acopla el protocolo a la geometría de dibujo).
- **Sí:** `pop` y `fall` opcionales en `snap`. Los snaps que no vienen de un tiro no los necesitan.
- **Sí:** `PROTOCOL_VERSION` sube a 3. `shot` es nuevo y un cliente v2 no lo entendería.
- **Sí:** mismos efectos en escritorio y en la miniatura móvil. `drawRivalBoard` es el mismo en los dos casos.
- **Sí:** sin sonido para el rival. Ensuciaría el audio del tablero propio.
- **Sí:** el `snap` sigue siendo la verdad. El fantasma y los efectos son solo decorado y no cambian `rival.grid`.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| El fantasma impacta en otro sitio que el tiro real porque `rival.grid` está desfasado (basura recién aplicada, techo) | El fantasma es solo visual y desaparece al impactar. El `snap` corrige el tablero en el mismo instante. |
| `pop`/`fall` apuntan a celdas que no existen en la rejilla previa del receptor | Los pares sobre celdas vacías o fuera de rango se ignoran. |
| Más mensajes por el `relay` | Un `shot` por tiro. Es despreciable frente al `aim` de 10 por segundo. |
| Coste de dibujo extra en la miniatura móvil | Son los mismos sprites y efectos que el tablero propio, a escala 1/3. Se verifica en la prueba manual con móvil. |
| Romper Arcade e Infinito al tocar `fire`, `settleProjectile` y `dropFloating` | El envío de `shot` y de `pop`/`fall` solo ocurre con `mode === 'versus'`. Criterio de aceptación dedicado. |

## Lo que **no** entra en esta spec

- Rendimiento del tablero propio en móvil.
- Animación del techo y de la basura del rival.
- Sonido de los efectos del rival.
- Predicción o compensación de latencia.
- Servidor autoritativo o anti-trampas.

Cada uno de estos, si llega, va en su propia spec.
