# SPEC 03 — Soporte móvil: controles táctiles y pantalla vertical

> **Estado:** Implementado
> **Depende de:** SPEC 02
> **Fecha:** 2026-10-01
> **Objetivo:** Cuando el navegador detecta un móvil, sustituir el teclado por controles táctiles y adaptar el juego a una pantalla vertical, sin cambiar nada en escritorio.

## Por qué existe esta spec

BobbleJS hoy solo se juega con teclado y en una vista horizontal de 320×240. En un teléfono no hay forma de apuntar ni de disparar, y la vista horizontal desperdicia la pantalla vertical. Esta spec añade un modo móvil completo para Arcade, Infinito y el versus online de SPEC 02. El escritorio debe quedar idéntico.

## Alcance

**Entra:**

- Detección de móvil al cargar la página en `js/device.js`: `matchMedia('(pointer: coarse)')` y `navigator.maxTouchPoints > 0`.
- Clase `mobile` en `<body>` cuando se detecta móvil. Todo el CSS móvil cuelga de ella.
- Vista lógica de 180×320 (9:16) en móvil, siempre vertical. El tablero se dibuja a tamaño real en la parte de abajo, con una franja de HUD de 80 px arriba.
- Apuntar arrastrando el dedo: el lanzador apunta hacia el dedo y dispara al soltar. Soltar por debajo del lanzador cancela el tiro.
- El disparo automático a los 6 s se mantiene.
- Botones ⏸ (pausa) y 🔊 (sonido) semitransparentes superpuestos al canvas.
- Versus online en móvil: el tablero del rival en miniatura a escala 1/3 en la franja superior. ⏸ abre "¿Abandonar?".
- Overlays HTML actuales (menú, lobby, pausa, fin, resultado versus, abandonar) adaptados a vertical con CSS.
- Pistas de teclado ocultas en móvil.
- Bloqueo de zoom, scroll y menú de pulsación larga sobre el juego.
- Desbloqueo del audio con el primer toque.
- El teclado físico queda desactivado en móvil.
- Tests de la detección y de la geometría táctil (pantalla → coordenadas lógicas, ángulo, zona de cancelación).

**Fuera de alcance (specs futuras):**

- Modo horizontal en móvil.
- Botones en pantalla ◀ ▶ DISPARAR como alternativa al arrastre.
- Pantalla completa (Fullscreen API).
- Vibración háptica.
- PWA, instalación en pantalla de inicio o modo offline.
- Mandos (Gamepad API).
- Rediseño de los menús específico para móvil (solo se adapta el CSS).
- Cambios en el escritorio.

## Modelo de datos

### Detección (`js/device.js`)

```js
// Pura, testeable: recibe el entorno en lugar de leer window
export function detectMobile(env) {
  /* env.matchMedia('(pointer: coarse)').matches && env.maxTouchPoints > 0 */
}
export const IS_MOBILE = typeof window !== 'undefined' && detectMobile({ matchMedia: window.matchMedia.bind(window), maxTouchPoints: navigator.maxTouchPoints });
```

La detección se hace una sola vez al cargar. No cambia en caliente.

### Vista y disposición (`js/config.js`)

```js
export const MOBILE_VIEW_W = 180;
export const MOBILE_VIEW_H = 320;
export const MOBILE_HUD_H = 80;         // franja superior
export const MOBILE_BOARD_DX = -70;     // FIELD_X (96) → 26: tablero + paredes ocupan x 18..162
export const MOBILE_BOARD_DY = 80;      // el tablero empieza bajo la franja de HUD
export const MINI_RIVAL_SCALE = 1 / 3;  // tablero rival ≈ 43×80 px en la franja
```

La geometría lógica del tablero no cambia: `FIELD_X`, `FIELD_TOP`, `LAUNCHER_X/Y` y `LIMIT_Y` siguen siendo los de 320×240. En móvil el renderer dibuja el tablero trasladado (`MOBILE_BOARD_DX`, `MOBILE_BOARD_DY`), igual que el versus de SPEC 02 traslada los tableros. Así `game.js`, `grid.js` y `shooter.js` no conocen el modo móvil.

### Entrada táctil (`js/touch.js`)

```js
// Funciones puras
export function toLogical(clientX, clientY, canvasRect) { /* → { x, y } en coordenadas lógicas del tablero */ }
export function aimAngleToward(x, y) { /* grados respecto a la vertical, recortado a ±MAX_ANGLE */ }
export function isCancelZone(y) { /* true si y está por debajo de LAUNCHER_Y */ }

// Misma interfaz que Input (isHeld, consume, endFrame) + ángulo absoluto
export class TouchInput {
  aimAngle = null;   // grados mientras el dedo está apoyado; null si no hay dedo
  // pointerdown/pointermove → aimAngle; pointerup fuera de la zona de cancelación → acción 'fire'
  // press(action): los botones ⏸ y 🔊 inyectan 'pause' y 'mute'
}
```

`Game.updatePlaying` usa `input.aimAngle` cuando no es `null` y lo asigna directamente a `shooter.angle`. Con el `Input` de teclado la propiedad no existe y el comportamiento no cambia.

### DOM

- `#touch-controls` con `#btn-pause` (⏸) y `#btn-mute` (🔊). Solo es visible con `body.mobile` y en los estados `countdown`, `playing` y `frozen`.

## Plan de implementación

1. **Detección.** `js/device.js` con `detectMobile(env)` e `IS_MOBILE`. `main.js` añade la clase `mobile` a `<body>` si `IS_MOBILE`. Tests en `server/test/device.test.js`: puntero `coarse` + toques da móvil; puntero `fine`, o 0 toques, da escritorio.
2. **Base CSS y viewport.** En `index.html`, el viewport pasa a `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no`. En `styles.css`, bajo `body.mobile`: `.screen` con proporción 9:16 que ocupa la pantalla (`100dvh`), `touch-action: none`, `user-select: none` y `-webkit-touch-callout: none` sobre el juego. Se ocultan `.hint`, `.controls` y la ayuda de teclado. Prueba manual: el escritorio se ve idéntico.
3. **Renderer móvil en solitario.** Con `IS_MOBILE`, el canvas mide 180×320. Hay un fondo propio y el tablero se dibuja trasladado (`MOBILE_BOARD_DX`, `MOBILE_BOARD_DY`). El HUD de la franja superior muestra puntos, récord, ronda o filas y "DROP IN". El HUD lateral de escritorio y su ayuda de teclado no se dibujan. Prueba manual con el modo dispositivo de las DevTools: Arcade e Infinito se ven completos en vertical.
4. **Geometría táctil.** `toLogical`, `aimAngleToward` e `isCancelZone` en `js/touch.js`. `toLogical` deshace el escalado CSS del canvas y la traslación móvil. Tests en `server/test/touch.test.js`: un toque justo encima del lanzador da 0°, un toque a la izquierda da un ángulo negativo, el ángulo se recorta a ±85° y un toque bajo `LAUNCHER_Y` es zona de cancelación.
5. **`TouchInput`.** Pointer events sobre el canvas con `setPointerCapture`. Al apoyar o mover el dedo se actualiza `aimAngle`. Al soltar fuera de la zona de cancelación se emite `fire` y al soltar dentro solo se borra `aimAngle`. En móvil, `main.js` crea `TouchInput` en lugar de `Input`, así que el teclado físico queda desactivado. `Game.updatePlaying` usa `aimAngle`. Prueba manual: apuntar y disparar en Arcade.
6. **Botones ⏸ y 🔊.** `#touch-controls` en `index.html`, semitransparentes (`opacity` ≈ 0.5) en las esquinas superiores del área del tablero. Pulsar inyecta `pause` o `mute` en `TouchInput`. Visibles solo en `countdown`, `playing` y `frozen`. En solitario, ⏸ abre el overlay de pausa actual.
7. **Versus en móvil.** Tablero propio trasladado como en el paso 3. Rival en miniatura (`MINI_RIVAL_SCALE`) a la derecha de la franja superior, con su apodo encima. A la izquierda de la franja van el apodo propio y la basura pendiente `+N`. Las pantallas de cuenta atrás y congelado se adaptan a 180 px de ancho. ⏸ envía `pause`, que en versus ya abre "¿Abandonar?" (SPEC 02).
8. **Overlays en vertical.** CSS `body.mobile` para menú, lobby, pausa, fin, resultado versus y "¿Abandonar?". Tamaños de letra y botones aptos para el dedo (mínimo 44 px de alto). Los campos de apodo y código abren el teclado nativo. La lista de reglas del menú se mantiene sin la línea de teclas.
9. **Audio y gestos del navegador.** `sound.unlock()` en el primer `pointerdown`. `contextmenu` y `touchmove` con `preventDefault` sobre `.screen`. Doble toque sin zoom.
10. **Documentación.** `README.md`: sección "Jugar en el móvil" (arrastrar para apuntar, soltar para disparar, soltar por debajo del lanzador cancela, ⏸ y 🔊) y nota de que se prueba en escritorio con el modo dispositivo de las DevTools. Actualizar el árbol de estructura.

## Criterios de aceptación

- [ ] `npm test` pasa en verde, con los tests de `device.js` y `touch.js`.
- [ ] En escritorio (ratón y teclado) el juego se ve y se controla exactamente igual que antes: 320×240, HUD lateral y pistas de teclado.
- [ ] En un teléfono (o en el modo dispositivo de las DevTools con un móvil), `<body>` tiene la clase `mobile` y el canvas es vertical de 180×320.
- [ ] En móvil no aparece ninguna pista de teclado en el menú, el HUD ni los overlays.
- [ ] Arrastrar el dedo sobre el tablero gira el lanzador hacia el dedo.
- [ ] Soltar por encima del lanzador dispara en la dirección apuntada.
- [ ] Soltar por debajo del lanzador no dispara.
- [ ] Sin tocar la pantalla, el lanzador dispara solo a los 6 s.
- [ ] ⏸ pausa en Arcade/Infinito y abre "¿Abandonar?" en versus. 🔊 alterna el sonido.
- [ ] ⏸ y 🔊 se ven semitransparentes y no tapan el lanzador.
- [ ] En versus móvil, el tablero del rival se ve en miniatura en la franja superior y se actualiza tras cada tiro suyo.
- [ ] En versus móvil se ven los dos apodos y la basura pendiente `+N`.
- [ ] Un móvil y un escritorio pueden jugar un versus entre ellos.
- [ ] Todos los botones de menú, lobby, pausa, fin y revancha se pueden pulsar con el dedo sin hacer zoom.
- [ ] El doble toque y el pellizco no hacen zoom, y la página no hace scroll al arrastrar sobre el juego.
- [ ] La pulsación larga sobre el juego no abre el menú contextual del navegador.
- [ ] El sonido funciona tras el primer toque en iOS Safari.
- [ ] Con un teclado físico conectado a un móvil, las teclas no controlan el juego.

## Decisiones

- **Sí:** detección por capacidades (`pointer: coarse` + `maxTouchPoints`). **No:** User-Agent (frágil; los iPad modernos se identifican como Mac). **No:** cambiar en caliente al primer toque (los portátiles táctiles cambiarían de diseño a mitad de partida).
- **Sí:** detección una sola vez al cargar. Recargar es el único modo de cambiar.
- **Sí:** siempre vertical. Es la forma natural de sujetar el teléfono para este juego. **No:** horizontal en móvil. Si el teléfono se gira, la vista 9:16 se muestra entera, centrada con bandas.
- **Sí:** vista lógica de 180×320 (9:16). El tablero de 144 px con paredes cabe a tamaño real y quedan 80 px para el HUD.
- **Sí:** misma geometría lógica del tablero, trasladada al dibujar. **No:** parametrizar `FIELD_X`/`LAUNCHER_Y` por dispositivo (tocaría `game.js`, `grid.js` y `shooter.js` y arriesgaría el escritorio).
- **Sí:** arrastrar para apuntar y soltar para disparar. Es preciso y se hace con un solo dedo. **No:** botones ◀ ▶ DISPARAR (apuntar a pulsos es lento en táctil).
- **Sí:** soltar por debajo del lanzador cancela el tiro. Permite corregir sin malgastar burbuja.
- **Sí:** se mantiene el disparo automático a los 6 s. Las reglas son las mismas en todas las plataformas, y en versus importa la igualdad.
- **Sí:** botones ⏸ y 🔊 semitransparentes. **No:** gestos para pausar (poco descubribles).
- **Sí:** el rival en miniatura a escala 1/3 solo en móvil. En escritorio se mantiene a tamaño real (decisión de SPEC 02). En vertical no caben dos tableros de 144 px.
- **Sí:** se reutilizan los overlays HTML con CSS. **No:** rediseñar los menús para móvil (otra spec si llega).
- **Sí:** teclado físico desactivado en móvil. En móvil el control es táctil y no hay doble vía de entrada.
- **Sí:** sin pantalla completa forzada. **No:** Fullscreen API (no funciona en iPhone Safari).
- **Sí:** se prueba en escritorio con el modo dispositivo de las DevTools, que emula `pointer: coarse` y toques. **No:** un parámetro de URL para forzar el modo móvil.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Romper el escritorio al tocar renderer, CSS e input | Todo el código móvil depende de `IS_MOBILE` o de `body.mobile`. Criterio de aceptación dedicado. |
| La barra de direcciones de iOS cambia el alto visible | `.screen` usa `100dvh` y mantiene la proporción 9:16 dentro del espacio visible. |
| Portátiles táctiles detectados como móvil | `pointer: coarse` solo es verdadero si el puntero principal es táctil. Con ratón o trackpad es `fine`. |
| El dedo tapa el tablero al apuntar | El ángulo se toma de la posición del dedo, que puede estar en cualquier punto del tablero, también cerca de los lados o arriba. |
| iOS bloquea el audio hasta un gesto del usuario | `sound.unlock()` en el primer `pointerdown`. |
| Los botones ⏸ y 🔊 tapan burbujas | Van en las esquinas superiores, semitransparentes y pequeños (≈ 28 px). |
| Escalado no entero del canvas en pantallas raras | Se mantiene `image-rendering: pixelated`. Un escalado no entero es aceptable en móvil. |

## Lo que **no** entra en esta spec

- Modo horizontal en móvil.
- Botones ◀ ▶ DISPARAR.
- Pantalla completa.
- Vibración.
- PWA u offline.
- Mandos.
- Rediseño de menús para móvil.
- Cambios en escritorio.

Cada uno de estos, si llega, va en su propia spec.
