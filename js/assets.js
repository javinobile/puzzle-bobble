// Colores de fondo de la hoja de sprites que se vuelven transparentes
const KEY_COLORS = [
  [50, 97, 168],
  [147, 187, 236],
];

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    img.src = src;
  });
}

// La hoja no tiene canal alfa: se elimina el fondo por color (chroma-key)
export function chromaKey(img, colors = KEY_COLORS) {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    for (const [r, g, b] of colors) {
      if (px[i] === r && px[i + 1] === g && px[i + 2] === b) {
        px[i + 3] = 0;
        break;
      }
    }
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

export async function loadSpriteSheet(src) {
  try {
    return chromaKey(await loadImage(src));
  } catch (err) {
    console.warn(err.message, '— se usarán gráficos dibujados por código');
    return null;
  }
}
