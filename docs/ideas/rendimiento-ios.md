# Nota para una spec futura: rendimiento en iPhone

## Contexto
Tras SPEC 04, en un iPhone real con Chrome **los dos tableros** (el propio y la miniatura del rival) se ven entrecortados y lentos. En la emulación móvil de Chrome en el PC se ve perfecto.
- Chrome en iOS usa el motor de Safari (WebKit), como todos los navegadores de iOS. La emulación de Chrome en escritorio no reproduce su rendimiento.
- Afecta también al tablero propio, así que no es un problema de red ni de SPEC 04.
- Pendiente de descartar: el modo de bajo consumo de iOS limita el navegador a 30 fps.

## Sospechosos
1. **Coste de dibujo en WebKit.** Cada frame redibuja todo: el texto del HUD con la fuente web (dos `fillText` por texto por la sombra), el `clip` y el `scale` de la miniatura del rival y el escalado CSS del canvas con `image-rendering: pixelated`.
2. **Bucle de paso fijo sin interpolar** en `js/main.js`. Con frames irregulares, o a 30 fps, el juego avanza a tirones.

## Enfoque recomendado
1. **Medir primero.** Contador de fps y de tiempo por frame en pantalla, activable con `?debug` en la URL. En el iPhone no hay consola sin un Mac.
2. Según los números:
   - Pre-renderizar en un canvas aparte lo que no cambia cada frame (fondo, paredes, textos del HUD).
   - Abaratar la miniatura del rival.
   - Dibujar interpolando entre pasos de simulación.

## Verificación
- El contador `?debug` muestra en el iPhone fps y tiempo por frame antes y después.
- Prueba manual en el iPhone: Arcade y versus se ven fluidos.
- El escritorio no cambia.
