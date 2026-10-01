# BobbleJS

Homenaje web al arcade **Puzzle Bobble** hecho con HTML5 Canvas, Vanilla JavaScript (ES Modules) y CSS.

## Cómo jugar

Los ES Modules no funcionan abriendo el archivo con doble clic (`file://`), hay que servir la carpeta. Lo más completo es el servidor incluido (necesita Node 22 o superior), que además habilita el versus online:

```bash
npm install
npm start              # http://localhost:8080  (PORT=9000 npm start para otro puerto)
```

Para jugar solo también vale cualquier servidor estático (sin versus online):

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
- **Versus online**: dos jugadores en red, emparejados con un código de sala de 4 letras. Tableros lado a lado y basura al rival.

## Multijugador

### Jugar en la misma WiFi

1. En un ordenador de la red: `npm install && npm start`. La consola muestra la dirección local, por ejemplo `En tu red local: http://192.168.1.15:8080`.
2. Los dos jugadores abren esa dirección (puede ser el mismo ordenador y otro dispositivo).
3. **Versus online** → escribe un apodo de 3 caracteres → **Crear sala**. Aparece un código de 4 letras.
4. El otro jugador escribe el código y pulsa **Unirse**.

Si el otro dispositivo no carga la página, permite Node en el cortafuegos (macOS: *Ajustes del Sistema → Red → Cortafuegos*; Windows lo pregunta la primera vez que arranca el servidor).

Si un jugador pierde la conexión, los dos tableros se congelan y tiene 10 s para volver. Si no vuelve, gana el otro. Recargar la pestaña en plena partida cuenta como abandono. Si se desconectan los dos, la sala se cierra.

### Reglas del versus

- Los dos empiezan con el mismo tablero (semilla de la sala) tras una cuenta atrás 3-2-1. Tu tablero va a la izquierda y el del rival a la derecha.
- Las filas que bajan con el techo también son las mismas para los dos.
- **Basura:** si haces caer n burbujas sueltas con n > 2, el rival recibe n − 2 burbujas. Le entran al asentar su siguiente tiro, y mientras tanto su marcador muestra `+N`.
- Limpiar el tablero no gana: entran 3 filas nuevas y se sigue.
- Pierde quien cruce la línea primero. Si los dos la cruzan casi a la vez, es empate.
- **P / Esc** pide confirmación para abandonar (abandonar es perder). No hay pausa en online.
- Al terminar, **Revancha** empieza otra partida con un tablero nuevo cuando la pulsan los dos.
- En versus no hay puntuación ni récords.

### Desplegar en un VPS

El mismo proceso sirve el juego y el WebSocket (`/ws`) en un único puerto, y el cliente deduce la URL de la página (`wss://` cuando la página va por HTTPS). Basta con ponerlo detrás de un proxy inverso con TLS.

Unidad systemd (`/etc/systemd/system/bobblejs.service`):

```ini
[Unit]
Description=BobbleJS
After=network.target

[Service]
WorkingDirectory=/opt/bobblejs
ExecStart=/usr/bin/node server/index.js
Environment=PORT=8080
Restart=on-failure
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now bobblejs
journalctl -u bobblejs -f   # log de conexiones y salas
```

nginx (certificado con `certbot --nginx`, por ejemplo):

```nginx
server {
    listen 443 ssl;
    server_name bobble.example.com;

    ssl_certificate     /etc/letsencrypt/live/bobble.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bobble.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 60s;   # el servidor envía heartbeat cada 5 s
    }
}

server {
    listen 80;
    server_name bobble.example.com;
    return 301 https://$host$request_uri;
}
```

Las salas viven en memoria: reiniciar el proceso cierra las partidas en curso.

### Tests

```bash
npm test   # salas, protocolo, RNG con semilla y reglas del versus (node --test)
```

## Reglas

- Junta 3 o más burbujas del mismo color para explotarlas (10 pts c/u).
- Las burbujas que quedan sin conexión con el techo caen: 10 · 2ⁿ puntos por n burbujas.
- Rebota en las paredes laterales para alcanzar ángulos difíciles.
- Si no disparas en 6 s, el lanzador dispara solo.
- Cada pocos tiros el techo baja una fila (el tablero tiembla como aviso).
- Pierdes si una burbuja cruza la línea inferior.

## Estructura

```
index.html          Canvas y overlays (menú, lobby online, pausa, fin, resultado versus)
styles.css          Estilos
package.json        Dependencia ws y scripts start/test
assets/sprites.png  Hoja de sprites original (fondo eliminado por chroma-key al cargar)
server/
  index.js     Servidor HTTP estático + WebSocket en /ws
  rooms.js     Salas en memoria (crear, unirse, gracia, caducidad, revancha)
  test/        Tests con node --test
specs/         Especificaciones del proyecto
js/
  main.js      Arranque y bucle de juego
  lobby.js     Pantallas del versus online y flujo de partida/revancha
  game.js      Estados, reglas, puntuación y modo versus
  grid.js      Rejilla hexagonal, grupos y burbujas flotantes
  shooter.js   Lanzador, proyectil y rebotes
  levels.js    Niveles Arcade y generador aleatorio
  rng.js       Generador con semilla (mulberry32) para el versus
  renderer.js  Dibujo del tablero y HUD (uno o dos tableros)
  sprites.js   Coordenadas de la hoja de sprites
  audio.js     Efectos sintetizados con Web Audio
  input.js     Teclado
  storage.js   Récords en localStorage
  config.js    Constantes
  net/
    protocol.js  Protocolo compartido cliente/servidor
    client.js    Cliente WebSocket con reconexión
```

> Los sprites son propiedad de Taito (extraídos por The Spriters Resource). Proyecto con fines educativos.
