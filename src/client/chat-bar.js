// @ts-check

/**
 * Space the on-screen keyboard takes from the bottom of the layout viewport,
 * in CSS pixels. iOS Safari keeps the layout viewport full height and shrinks
 * only the visual viewport, so the chat bar must lift by this amount.
 * @param {number} layoutHeight
 * @param {{height:number,offsetTop:number}} visual
 */
export function keyboardInset(layoutHeight, visual) {
  const inset = layoutHeight - visual.height - visual.offsetTop;
  return Number.isFinite(inset) ? Math.max(0, Math.round(inset)) : 0;
}
