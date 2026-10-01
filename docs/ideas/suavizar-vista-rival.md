# Nota para una spec futura: suavizar la vista del rival en versus

## Contexto
Al jugar PC contra móvil, el tablero del rival se ve entrecortado. No es por la latencia de red, que en una WiFi local es de pocos ms. Es por cómo SPEC 02 envía y dibuja los datos del rival:
- **Ángulo:** llega como mucho cada 100 ms (`AIM_SEND_SECS` en `js/game.js`, `sendAim`). `drawRivalBoard` en `js/renderer.js` lo pinta tal cual, sin interpolar, así que la flecha avanza a saltos (unos 10 fps).
- **Tiros:** el rival no envía nada mientras su burbuja vuela. Solo llega un `snap` cuando la burbuja se asienta (`settle` → `sendSnapshot`). La burbuja "aparece" de golpe en el tablero sin verse viajar.
- **Explosiones y caídas:** no se transmiten, así que en el tablero del rival las burbujas desaparecen de golpe.
- El tablero propio es local y no depende de la red. Si ese se entrecorta en el móvil, es rendimiento, no red.

## Enfoque recomendado (como SPEC 04, si se quiere)
1. **Interpolar el ángulo del rival.** Guardar un `rival.targetAngle` y acercar `rival.angle` en cada `update` (p. ej. lerp hacia el objetivo a ~AIM_SPEED). Solo cliente, sin cambio de protocolo.
2. **Nuevo relay `{ k: 'shot', a, c }` al disparar** (en `fire()` de `js/game.js`). El receptor crea un proyectil "fantasma" con el `Projectile` existente de `js/shooter.js` y lo simula sobre `rival.grid` hasta el impacto. El `snap` posterior sigue siendo la verdad. Hay que añadir `shot` a `RELAY_SCHEMA` en `js/net/protocol.js` y subir `PROTOCOL_VERSION` a 3.
3. **Efectos de pop y caída en el rival.** Al recibir un `snap`, comparar con el `rival.grid` anterior y lanzar los efectos de pop y caída (`effects` y `falling`) para las celdas que desaparecen. Todo en cliente.

## Verificación
- Tests en `server/test/versus.test.js` para la interpolación, el relay `shot` válido e inválido, y que un `snap` con celdas eliminadas genera efectos.
- Prueba manual con dos navegadores (PC y móvil emulado): la flecha del rival gira suave y se ve volar su burbuja.
