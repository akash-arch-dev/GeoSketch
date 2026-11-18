/**
 * Pure Line Geometry & Intersection Engine (image-space coordinates)
 */
import { distance, midpoint } from './points.js';
import { projectPointOnSegment } from './vectors.js';

export function computeLineMetrics(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lengthPx = distance(p1, p2);
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  // Image coordinates have +Y downward; screen-horizon angle where upward is positive or standard atan2
  // Standard math angle relative to +X axis in image space (clockwise positive in screen coords, negate dy for standard Cartesian rise)
  const angleRad = Math.atan2(-dy, dx);
  const angleDeg = (angleRad * 180) / Math.PI;
  const normalizedDeg = ((angleDeg % 360) + 360) % 360;
  // Angle relative to horizontal axis (0 to 90 deg)
  let horizontalAcuteDeg = Math.abs(angleDeg) % 180;
  if (horizontalAcuteDeg > 90) horizontalAcuteDeg = 180 - horizontalAcuteDeg;

  const slope = Math.abs(dx) < 1e-7 ? null : -dy / dx;

  return {
    p1: { x: p1.x, y: p1.y },
    p2: { x: p2.x, y: p2.y },
    dx,
    dy,
    absDx,
    absDy,
    lengthPx,
    angleDeg,
    normalizedDeg,
    horizontalAcuteDeg,
    slope,
    midpoint: midpoint(p1, p2),
  };
}

export function distanceToLineSegment(point, p1, p2) {
  return projectPointOnSegment(point, p1, p2).distance;
}

/**
 * Infinite-line intersection between line A (a1-a2) and line B (b1-b2).
 * Returns null if parallel.
 */
export function lineLineIntersection(a1, a2, b1, b2) {
  const x1 = a1.x, y1 = a1.y;
  const x2 = a2.x, y2 = a2.y;
  const x3 = b1.x, y3 = b1.y;
  const x4 = b2.x, y4 = b2.y;

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-8) return null;

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

  return {
    x: x1 + t * (x2 - x1),
    y: y1 + t * (y2 - y1),
    t,
    u,
    segmentsIntersect: t >= 0 && t <= 1 && u >= 0 && u <= 1,
  };
}

/**
 * Constrain endpoint p2 relative to p1 to nearest 45-degree angle increment (0, 45, 90, ...).
 */
export function constrainLineAngle(p1, p2, stepDeg = 45) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: p2.x, y: p2.y };
  const angle = Math.atan2(dy, dx);
  const stepRad = (stepDeg * Math.PI) / 180;
  const snapped = Math.round(angle / stepRad) * stepRad;
  return {
    x: p1.x + Math.cos(snapped) * len,
    y: p1.y + Math.sin(snapped) * len,
  };
}
