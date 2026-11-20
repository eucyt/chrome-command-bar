// Where the fallback window goes. Pure functions.

/**
 * Centres the window horizontally over its parent and puts it a quarter of the
 * spare height down (80px at least), about where the overlay shows the bar. Without a parent
 * the position is left to Chrome.
 * @param {{left?: number, top?: number, width?: number, height?: number} | null | undefined} parent
 * @param {{width: number, height: number}} size
 * @returns {{width: number, height: number, left?: number, top?: number}}
 */
export function fallbackWindowBounds(parent, size) {
  const known = [parent?.left, parent?.top, parent?.width, parent?.height].every(Number.isFinite);
  if (!known) return { ...size };
  return {
    ...size,
    left: Math.round(parent.left + (parent.width - size.width) / 2),
    top: Math.round(parent.top + Math.max(80, (parent.height - size.height) / 4)),
  };
}
