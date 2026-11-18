/**
 * Pure Polygon, Ellipse, and Shape Measurements Engine
 */
import { distance, boundingBox } from './points.js';
import { computeAngleMetrics } from './angles.js';

export function polygonSignedArea(vertices) {
  const n = vertices.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum * 0.5;
}

export function polygonArea(vertices) {
  return Math.abs(polygonSignedArea(vertices));
}

export function polygonPerimeter(vertices, closed = true) {
  const n = vertices.length;
  if (n < 2) return 0;
  let perim = 0;
  const limit = closed ? n : n - 1;
  for (let i = 0; i < limit; i++) {
    perim += distance(vertices[i], vertices[(i + 1) % n]);
  }
  return perim;
}

export function polygonSideLengths(vertices, closed = true) {
  const n = vertices.length;
  if (n < 2) return [];
  const sides = [];
  const limit = closed ? n : n - 1;
  for (let i = 0; i < limit; i++) {
    sides.push(distance(vertices[i], vertices[(i + 1) % n]));
  }
  return sides;
}

export function polygonCentroid(vertices) {
  const n = vertices.length;
  if (n === 0) return { x: 0, y: 0 };
  const area = polygonSignedArea(vertices);
  if (Math.abs(area) < 1e-7) {
    let sx = 0, sy = 0;
    for (const v of vertices) {
      sx += v.x;
      sy += v.y;
    }
    return { x: sx / n, y: sy / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    const f = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * f;
    cy += (a.y + b.y) * f;
  }
  const factor = 1 / (6 * area);
  return { x: cx * factor, y: cy * factor };
}

/**
 * Compute internal angles (in degrees) at each vertex of a simple polygon.
 */
export function polygonInternalAngles(vertices) {
  const n = vertices.length;
  if (n < 3) return [];
  const signedArea = polygonSignedArea(vertices);
  // In screen space (+Y down), positive signedArea means visual clockwise winding.
  const isCw = signedArea > 0;
  const angles = [];

  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];
    const m = computeAngleMetrics(prev, curr, next);
    // Use directional angle matching polygon interior based on winding
    const aPrev = Math.atan2(prev.y - curr.y, prev.x - curr.x);
    const aNext = Math.atan2(next.y - curr.y, next.x - curr.x);
    let sweep = isCw
      ? ((aPrev - aNext) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)
      : ((aNext - aPrev) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    const deg = (sweep * 180) / Math.PI;
    angles.push(Number.isFinite(deg) ? deg : m.interiorDeg);
  }
  return angles;
}

/**
 * Compute all diagonal lengths for quadrilaterals or polygons (up to 6 vertices cleanly).
 */
export function polygonDiagonals(vertices) {
  const n = vertices.length;
  if (n < 4) return [];
  const diagonals = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      diagonals.push({
        from: i,
        to: j,
        lengthPx: distance(vertices[i], vertices[j]),
      });
    }
  }
  return diagonals;
}

/**
 * Ramanujan's second approximation for ellipse perimeter.
 */
export function ellipsePerimeter(rx, ry) {
  const a = Math.abs(rx);
  const b = Math.abs(ry);
  if (a < 1e-9 && b < 1e-9) return 0;
  const h = Math.pow(a - b, 2) / Math.pow(a + b, 2);
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

export function ellipseArea(rx, ry) {
  return Math.PI * Math.abs(rx) * Math.abs(ry);
}

/**
 * Generate regular N-gon vertices centered at (0, 0) within width/height box.
 */
export function createRegularPolygonVertices(sides, rx, ry, startAngleRad = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const theta = startAngleRad + (i * 2 * Math.PI) / sides;
    pts.push({
      x: Math.cos(theta) * rx,
      y: Math.sin(theta) * ry,
    });
  }
  return pts;
}

/**
 * Generate an ellipse sampled as polygon points for homography distortion & area estimation.
 */
export function sampleEllipsePoints(cx, cy, rx, ry, segments = 64) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const theta = (i * 2 * Math.PI) / segments;
    pts.push({
      x: cx + Math.cos(theta) * rx,
      y: cy + Math.sin(theta) * ry,
    });
  }
  return pts;
}

/**
 * Douglas-Peucker polyline simplification for freehand shapes.
 */
export function simplifyPoints(points, tolerance = 2.5) {
  if (points.length <= 3) return points.map((p) => ({ x: p.x, y: p.y }));

  const sqTol = tolerance * tolerance;

  function getSqSegDist(p, p1, p2) {
    let x = p1.x;
    let y = p1.y;
    let dx = p2.x - x;
    let dy = p2.y - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = p2.x;
        y = p2.y;
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }
    dx = p.x - x;
    dy = p.y - y;
    return dx * dx + dy * dy;
  }

  function simplifyDP(pts, first, last, out) {
    let maxDist = sqTol;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const dist = getSqSegDist(pts[i], pts[first], pts[last]);
      if (dist > maxDist) {
        index = i;
        maxDist = dist;
      }
    }
    if (index !== -1) {
      if (index - first > 1) simplifyDP(pts, first, index, out);
      out.push(pts[index]);
      if (last - index > 1) simplifyDP(pts, index, last, out);
    }
  }

  const out = [points[0]];
  simplifyDP(points, 0, points.length - 1, out);
  out.push(points[points.length - 1]);
  return out;
}

export function pointInPolygon(pt, vertices) {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x, yi = vertices[i].y;
    const xj = vertices[j].x, yj = vertices[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function computePolygonSummary(vertices) {
  const bbox = boundingBox(vertices);
  return {
    widthPx: bbox.width,
    heightPx: bbox.height,
    aspectRatio: bbox.height > 1e-7 ? bbox.width / bbox.height : 0,
    sideLengthsPx: polygonSideLengths(vertices, true),
    internalAnglesDeg: polygonInternalAngles(vertices),
    perimeterPx: polygonPerimeter(vertices, true),
    areaPx2: polygonArea(vertices),
    diagonalsPx: polygonDiagonals(vertices),
    bbox,
  };
}
