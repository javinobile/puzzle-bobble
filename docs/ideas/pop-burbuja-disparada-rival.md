# Nota para una spec futura: explosión de la burbuja disparada por el rival

## Contexto
SPEC 04 anima las explosiones del rival a partir de los pares `pop` del `snap`. El receptor toma el color y la posición de cada par de su `rival.grid` anterior al tiro, y descarta los pares que apuntan a una celda vacía.
- La burbuja que dispara el rival ocupa una celda que **estaba vacía** en esa rejilla anterior. Por eso su par de `pop` se descarta.
- Resultado visible: el fantasma desaparece al impactar y solo explotan sus compañeras de grupo. Si el grupo es de 3, se ven 2 explosiones.
- El test `el snap de un tiro genera pop y caída en el rival; pares vacíos se ignoran` de `server/test/versus.test.js` documenta este comportamiento: espera 2 efectos, no 3.

## Opciones
1. **Recordar el color del último `shot` (recomendada).** Guardar `rival.lastShotColor` al recibir `shot`. Al procesar `pop`, si un par apunta a una celda vacía, usar ese color. Solo cliente, sin cambio de protocolo.
2. **Color en cada par: `[r, c, letra]`.** Exacto e independiente de la rejilla previa, pero cambia el formato de `pop`/`fall` y obliga a subir `PROTOCOL_VERSION` a 4. SPEC 04 lo descartó por ocupar más.

Cualquiera de las dos obliga a actualizar la decisión correspondiente de SPEC 04.

## Verificación
- Ajustar el test citado para que espere 3 efectos.
- Prueba manual: al hacer explotar un grupo, el rival ve explotar también la burbuja que acaba de impactar.
