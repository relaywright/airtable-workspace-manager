/**
 * Viewport helpers shared by the Cytoscape maps.
 */

// Fitting a small graph should not blow nodes and labels up to fill the screen.
export const MAX_FIT_ZOOM = 1.25;

/** @typedef {{ top: number, right: number, bottom: number, left: number }} Insets */

/** @returns {Insets} */
function toInsets(padding) {
  if (typeof padding === 'number') {
    return { top: padding, right: padding, bottom: padding, left: padding };
  }
  return { top: 0, right: 0, bottom: 0, left: 0, ...padding };
}

/**
 * Fit the graph into view like cy.fit(), but never zoom in past `maxZoom`.
 * A small graph is centered at a readable size instead of scaled up.
 *
 * `padding` is a number or per-side insets. Pass `paddingOptions` (several inset sets, e.g. one
 * that keeps clear of side panels and one that keeps clear of a top band) to use whichever
 * leaves the graph largest.
 *
 * `eles` frames a subset (e.g. a node's closed neighborhood) instead of the whole graph; a lone
 * node is centered at `maxZoom`. `complete` runs once the camera arrives. With `queue`, an
 * animated fit waits for in-flight animations instead of cancelling them (and their callbacks).
 * @param {import('cytoscape').Core} cy
 * @param {{ eles?: import('cytoscape').Collection, padding?: number | Partial<Insets>,
 *   paddingOptions?: Array<number | Partial<Insets>>, maxZoom?: number, animate?: boolean,
 *   duration?: number, queue?: boolean, complete?: () => void }} [options]
 */
export function fitGraph(
  cy,
  {
    eles,
    padding = 50,
    paddingOptions,
    maxZoom = MAX_FIT_ZOOM,
    animate = false,
    duration = 300,
    queue = false,
    complete,
  } = {},
) {
  if (!cy) return;
  const target = eles ?? cy.elements();
  if (target.length === 0) return;

  const box = target.boundingBox();
  const width = cy.width();
  const height = cy.height();
  const zoomCap = Math.min(maxZoom, cy.maxZoom());

  let best = null;
  for (const option of paddingOptions?.length ? paddingOptions : [padding]) {
    const insets = toInsets(option);
    const availWidth = width - insets.left - insets.right;
    const availHeight = height - insets.top - insets.bottom;
    if (availWidth <= 0 || availHeight <= 0) continue;
    // A zero-size box (lone node without dimensions) fits at any zoom, so it lands on the cap
    const fitZoom = Math.min(availWidth / box.w, availHeight / box.h);
    if (Number.isNaN(fitZoom) || fitZoom <= 0) continue;
    const zoom = Math.max(cy.minZoom(), Math.min(fitZoom, zoomCap));
    if (!best || zoom > best.zoom) best = { zoom, insets, availWidth, availHeight };
  }
  if (!best) return;

  const { zoom, insets, availWidth, availHeight } = best;
  const pan = {
    x: insets.left + (availWidth - zoom * box.w) / 2 - zoom * box.x1,
    y: insets.top + (availHeight - zoom * box.h) / 2 - zoom * box.y1,
  };

  if (animate) {
    if (!queue) cy.stop(true);
    cy.animate({ zoom, pan }, { duration, easing: 'ease-in-out-cubic', queue: true, complete });
  } else {
    cy.viewport({ zoom, pan });
    complete?.();
  }
}
