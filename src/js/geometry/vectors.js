/**
 * Pure 2D Vector Geometry Utilities
 */

export function vec(from, to) {
  return { x: to.x - from.x, y: to.y - from.y };
}

export function dot(u, v) {
  return u.x * v.x + u.y * v.y;
}

export function cross(u, v) {
  return u.x * v.y - u.y * v.x;
}

export function magnitude(v) {
  return Math.hypot(v.x, v.y);
}

export function normalize(v) {
  const m = magnitude(v);
  if (m < 1e-9) return { x: 0, y: 0 };
  return { x: v.x / m, y: v.y / m };
}

export function perpendicular(v) {
  return { x: -v.y, y: v.x };
}

export function angleBetweenRad(u, v) {
  const mu = magnitude(u);
  const mv = magnitude(v);
  if (mu < 1e-9 || mv < 1e-9) return 0;
  const cos = Math.max(-1, Math.min(1, dot(u, v) / (mu * mv)));
  return Math.acos(cos);
}

export function projectPointOnSegment(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-9) {
    return { x: a.x, y: a.y, t: 0, distance: Math.hypot(p.x - a.x, p.y - a.y) };
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
  const px = a.x + t * abx;
  const py = a.y + t * aby;
  return {
    x: px,
    y: py,
    t,
    distance: Math.hypot(p.x - px, p.y - py),
  };
}
