const PREFIX = 'bobblejs.highscore.';

export function getHighScore(mode) {
  try {
    return Number(localStorage.getItem(PREFIX + mode)) || 0;
  } catch {
    return 0;
  }
}

export function saveHighScore(mode, score) {
  if (score <= getHighScore(mode)) return false;
  try {
    localStorage.setItem(PREFIX + mode, String(score));
  } catch {
    // Almacenamiento bloqueado: el récord solo dura esta sesión
  }
  return true;
}
