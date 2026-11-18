/**
 * Construction Assistance & Precision Snapping Engine
 *
 * Supports:
 * - Grid intersections
 * - Line endpoints & polygon vertices
 * - Object centers & midpoints
 * - Line & guide intersections
 * - Horizontal & vertical alignment guides
 * - Configurable screen-space sensitivity (zoom-independent feel)
 */
import { distance, midpoint } from '../geometry/points.js';
import { lineLineIntersection } from '../geometry/lines.js';
import { getShapeWorldVertices } from '../geometry/transformations.js';

export function createDefaultSnappingConfig() {
  return {
    enabled: true,
    sensitivityPx: 12,
    snapGrid: true,
    snapEndpoints: true,
    snapCenters: true,
    snapIntersections: true,
    snapAlignment: true,
  };
}

/**
 * Collect candidate snap points from visible grid, lines, shapes, angles, and guides.
 */
function collectSnapCandidates(state, excludeIds = []) {
  const endpoints = [];
  const centers = [];
  const segments = [];
  const alignRefs = [];

  const imgW = state.image.width || 0;
  const imgH = state.image.height || 0;

  // Image center
  if (imgW > 0 && imgH > 0) {
    const ic = { x: imgW * 0.5, y: imgH * 0.5 };
    centers.push({ ...ic, label: 'Image Center' });
    alignRefs.push(ic);
  }

  // Lines
  for (const l of state.lines) {
    if (l.visible === false || excludeIds.includes(l.id)) continue;
    endpoints.push({ x: l.p1.x, y: l.p1.y, label: 'Endpoint' });
    endpoints.push({ x: l.p2.x, y: l.p2.y, label: 'Endpoint' });
    centers.push({ ...midpoint(l.p1, l.p2), label: 'Midpoint' });
    segments.push({ p1: l.p1, p2: l.p2 });
    alignRefs.push(l.p1, l.p2);
  }

  // Shapes
  for (const s of state.shapes) {
    if (s.visible === false || excludeIds.includes(s.id)) continue;
    const cx = s.x + s.width * 0.5;
    const cy = s.y + s.height * 0.5;
    centers.push({ x: cx, y: cy, label: 'Center' });
    alignRefs.push({ x: cx, y: cy });

    if (s.type !== 'circle' && s.type !== 'ellipse') {
      const verts = getShapeWorldVertices(s);
      for (let i = 0; i < verts.length; i++) {
        const v = verts[i];
        const next = verts[(i + 1) % verts.length];
        endpoints.push({ x: v.x, y: v.y, label: 'Vertex' });
        centers.push({ ...midpoint(v, next), label: 'Edge Mid' });
        segments.push({ p1: v, p2: next });
        alignRefs.push(v);
      }
    }
  }

  // Angles
  for (const a of state.angles) {
    if (a.visible === false || excludeIds.includes(a.id)) continue;
    endpoints.push({ x: a.p1.x, y: a.p1.y, label: 'Endpoint' });
    endpoints.push({ x: a.vertex.x, y: a.vertex.y, label: 'Vertex' });
    endpoints.push({ x: a.p2.x, y: a.p2.y, label: 'Endpoint' });
    segments.push({ p1: a.p1, p2: a.vertex }, { p1: a.vertex, p2: a.p2 });
    alignRefs.push(a.vertex);
  }

  // Custom guide lines
  if (state.guides.showCustomGuides) {
    for (const g of state.guides.customLines) {
      if (g.visible === false || excludeIds.includes(g.id)) continue;
      if (g.orientation === 'horizontal') {
        segments.push({ p1: { x: 0, y: g.position }, p2: { x: imgW, y: g.position } });
      } else if (g.orientation === 'vertical') {
        segments.push({ p1: { x: g.position, y: 0 }, p2: { x: g.position, y: imgH } });
      } else if (g.p1 && g.p2) {
        segments.push({ p1: g.p1, p2: g.p2 });
      }
    }
  }

  return { endpoints, centers, segments, alignRefs };
}

/**
 * Compute nearest grid intersection in image coordinates when grid is visible.
 */
function findNearestGridPoint(imgPt, state) {
  const g = state.guides.grid;
  if (!g || !g.visible) return null;

  const bounds = state.crop.applied
    ? { x: state.crop.x, y: state.crop.y, width: state.crop.width, height: state.crop.height }
    : { x: 0, y: 0, width: state.image.width, height: state.image.height };

  if (bounds.width <= 0 || bounds.height <= 0) return null;

  const ox = Number(g.offsetX) || 0;
  const oy = Number(g.offsetY) || 0;

  let gx;
  let gy;
  if (g.mode === 'cellSize') {
    const cw = Math.max(4, Number(g.cellWidth) || 100);
    const ch = Math.max(4, Number(g.cellHeight) || 100);
    const startX = bounds.x + (((ox % cw) + cw) % cw);
    const startY = bounds.y + (((oy % ch) + ch) % ch);
    const colIdx = Math.round((imgPt.x - startX) / cw);
    const rowIdx = Math.round((imgPt.y - startY) / ch);
    gx = startX + colIdx * cw;
    gy = startY + rowIdx * ch;
  } else {
    const cols = Math.max(1, Math.min(100, Number(g.columns) || 4));
    const rows = Math.max(1, Math.min(100, Number(g.rows) || 4));
    const stepX = bounds.width / cols;
    const stepY = bounds.height / rows;
    const colIdx = Math.round((imgPt.x - bounds.x - ox) / stepX);
    const rowIdx = Math.round((imgPt.y - bounds.y - oy) / stepY);
    gx = bounds.x + ox + colIdx * stepX;
    gy = bounds.y + oy + rowIdx * stepY;
  }

  if (gx < bounds.x - 1 || gx > bounds.x + bounds.width + 1 || gy < bounds.y - 1 || gy > bounds.y + bounds.height + 1) {
    return null;
  }
  return { x: gx, y: gy, label: 'Grid' };
}

/**
 * Snap an image-space cursor point against enabled snap targets.
 */
export function resolveSnap(imgPt, state, coords, options = {}) {
  const cfg = state.snapping;
  if (!cfg || !cfg.enabled || options.bypass) {
    return { x: imgPt.x, y: imgPt.y, snapped: false, type: null, label: '', alignGuides: [] };
  }

  const sensPx = Math.max(4, Math.min(32, Number(cfg.sensitivityPx) || 12));
  const tol = coords.screenDistToImageDist(sensPx);
  const { endpoints, centers, segments, alignRefs } = collectSnapCandidates(state, options.excludeIds || []);

  if (options.anchorPt) {
    alignRefs.push(options.anchorPt);
  }

  let best = null;
  let bestDist = tol;

  const tryCandidate = (pt, type, label, priorityBonus = 0) => {
    const d = distance(imgPt, pt);
    if (d <= tol && d - priorityBonus < bestDist) {
      bestDist = d - priorityBonus;
      best = { x: pt.x, y: pt.y, snapped: true, type, label, alignGuides: [] };
    }
  };

  // 1. Endpoints & Vertices (highest priority)
  if (cfg.snapEndpoints) {
    for (const pt of endpoints) {
      tryCandidate(pt, 'endpoint', pt.label, tol * 0.25);
    }
  }

  // 2. Intersections (between lines/guides/edges)
  if (cfg.snapIntersections && segments.length >= 2 && segments.length <= 45) {
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        const hit = lineLineIntersection(segments[i].p1, segments[i].p2, segments[j].p1, segments[j].p2);
        if (hit && hit.segmentsIntersect) {
          tryCandidate(hit, 'intersection', 'Intersection', tol * 0.2);
        }
      }
    }
  }

  // 3. Centers & Midpoints
  if (cfg.snapCenters) {
    for (const pt of centers) {
      tryCandidate(pt, 'center', pt.label, tol * 0.15);
    }
  }

  // 4. Grid Intersections
  if (cfg.snapGrid) {
    const gridPt = findNearestGridPoint(imgPt, state);
    if (gridPt) {
      tryCandidate(gridPt, 'grid', 'Grid', 0);
    }
  }

  if (best) {
    return best;
  }

  // 5. Horizontal / Vertical Alignment Guides
  if (cfg.snapAlignment && alignRefs.length > 0) {
    let bestX = null;
    let bestXRef = null;
    let minDx = tol * 0.85;
    let bestY = null;
    let bestYRef = null;
    let minDy = tol * 0.85;

    for (const ref of alignRefs) {
      const dx = Math.abs(imgPt.x - ref.x);
      if (dx < minDx) {
        minDx = dx;
        bestX = ref.x;
        bestXRef = ref;
      }
      const dy = Math.abs(imgPt.y - ref.y);
      if (dy < minDy) {
        minDy = dy;
        bestY = ref.y;
        bestYRef = ref;
      }
    }

    if (bestX !== null || bestY !== null) {
      const alignGuides = [];
      const outX = bestX !== null ? bestX : imgPt.x;
      const outY = bestY !== null ? bestY : imgPt.y;
      if (bestX !== null && bestXRef) {
        alignGuides.push({ from: bestXRef, to: { x: outX, y: outY }, axis: 'vertical' });
      }
      if (bestY !== null && bestYRef) {
        alignGuides.push({ from: bestYRef, to: { x: outX, y: outY }, axis: 'horizontal' });
      }
      const label = bestX !== null && bestY !== null ? 'Align H+V' : bestX !== null ? 'Align V' : 'Align H';
      return {
        x: outX,
        y: outY,
        snapped: true,
        type: 'align',
        label,
        alignGuides,
      };
    }
  }

  return { x: imgPt.x, y: imgPt.y, snapped: false, type: null, label: '', alignGuides: [] };
}
