# BobbleJS

Homenaje web al arcade **Puzzle Bobble** hecho con HTML5 Canvas, Vanilla JavaScript (ES Modules) y CSS.

## Cómo jugar

Los ES Modules no funcionan abriendo el archivo con doble clic (`file://`), hay que servir la carpeta:

```bash
npx serve .            # http://localhost:3000
# o
python3 -m http.server # http://localhost:8000
```

| Tecla | Acción |
| --- | --- |
| ← → (A / D) | Apuntar |
| Espacio / ↑ | Disparar |
| P / Esc | Pausa |
| M | Sonido on/off |
| Enter | Elegir en menús |

## Modos

- **Arcade**: 10 rondas diseñadas a mano. Bonus por limpiar rápido.
- **Infinito**: tablero aleatorio; cada pocos tiros entra una fila nueva y aparecen más colores con la puntuación.

## Reglas

- Junta 3 o más burbujas del mismo color para explotarlas (10 pts c/u).
- Las burbujas que quedan sin conexión con el techo caen: 10 · 2ⁿ puntos por n burbujas.
- Rebota en las paredes laterales para alcanzar ángulos difíciles.
- Si no disparas en 6 s, el lanzador dispara solo.
- Cada pocos tiros el techo baja una fila (el tablero tiembla como aviso).
- Pierdes si una burbuja cruza la línea inferior.

## Estructura

```
index.html          Canvas y overlays (menú, pausa, fin)
styles.css          Estilos
assets/sprites.png  Hoja de sprites original (fondo eliminado por chroma-key al cargar)
js/
  main.js      Arranque y bucle de juego
  game.js      Estados, reglas y puntuación
  grid.js      Rejilla hexagonal, grupos y burbujas flotantes
  shooter.js   Lanzador, proyectil y rebotes
  levels.js    Niveles Arcade y generador aleatorio
  renderer.js  Dibujo del tablero y HUD
  sprites.js   Coordenadas de la hoja de sprites
  audio.js     Efectos sintetizados con Web Audio
  input.js     Teclado
  storage.js   Récords en localStorage
  config.js    Constantes
```

> Los sprites son propiedad de Taito (extraídos por The Spriters Resource). Proyecto con fines educativos.
