'use strict';

function estimateTranslation(previous, current, width, height, radius = 4) {
  if (!previous || !current || previous.length !== current.length) return null;
  let texture = 0; let samples = 0;
  for (let y = 6; y < height - 6; y += 6) for (let x = 6; x < width - 6; x += 6) {
    const index = y * width + x;
    texture += Math.abs(previous[index] - previous[index + 1]) + Math.abs(previous[index] - previous[index + width]);
    samples += 1;
  }
  if (!samples || texture / samples < 9) return { dx: 0, dy: 0, confidence: 0 };

  const score = (dx, dy) => {
    let error = 0; let count = 0;
    for (let y = radius + 4; y < height - radius - 4; y += 6) for (let x = radius + 4; x < width - radius - 4; x += 6) {
      error += Math.abs(previous[y * width + x] - current[(y + dy) * width + x + dx]);
      count += 1;
    }
    return count ? error / count : Infinity;
  };

  const stationary = score(0, 0); let best = { dx: 0, dy: 0, error: stationary };
  for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
    const error = score(dx, dy);
    if (error < best.error) best = { dx, dy, error };
  }
  return { dx: best.dx, dy: best.dy, confidence: Math.max(0, Math.min(1, (stationary - best.error) / Math.max(stationary, 1))) };
}

if (typeof module !== 'undefined') module.exports = { estimateTranslation };
if (typeof window !== 'undefined') window.OpticalFlow = { estimateTranslation };