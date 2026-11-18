/**
 * Pure Angle Calculation Engine
 */
import { lineLineIntersection } from './lines.js';
import { distance } from './points.js';

const RAD_TO_DEG = 180 / Math.PI;

export function normalizeDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

/**
 * Given 3 points (p1, vertex, p2) in image space (+X right, +Y down):
 * Computes interior, exterior, acute, obtuse, reflex, CW and CCW angles.
 */
export function computeAngleMetrics(p1, vertex, p2) {
  const a1 = Math.atan2(p1.y - vertex.y, p1.x - vertex.x);
  const a2 = Math.atan2(p2.y - vertex.y, p2.x - vertex.x);

  // In image space (+Y down), increasing atan2 goes visually clockwise.
  // So visual CW sweep from ray1 to ray2:
  const cwRad = ((a2 - a1) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const ccwRad = (2 * Math.PI - cwRad) % (2 * Math.PI);

  const cwDeg = cwRad * RAD_TO_DEG;
  const ccwDeg = ccwRad * RAD_TO_DEG;

  const interiorDeg = Math.min(cwDeg, ccwDeg);
  const reflexDeg = 360 - interiorDeg;
  const exteriorDeg = 180 - interiorDeg; // supplementary angle on extended ray
  const acuteDeg = interiorDeg <= 90 ? interiorDeg : 180 - interiorDeg;
  const obtuseDeg = interiorDeg >= 90 ? interiorDeg : 180 - interiorDeg;

  let classification = 'Acute';
  if (Math.abs(interiorDeg - 90) < 0.05) classification = 'Right';
  else if (Math.abs(interiorDeg - 180) < 0.05) classification = 'Straight';
  else if (interiorDeg > 90) classification = 'Obtuse';
  else if (interiorDeg < 0.05) classification = 'Zero';

  // Determine shorter sweep start/end for rendering the interior arc cleanly in canvas
  const useCwForInterior = cwDeg <= ccwDeg;
  const startAngle = a1;
  const endAngle = a2;
  const anticlockwise = !useCwForInterior;

  // Bisector direction for interior angle label
  const sweepSigned = useCwForInterior ? cwRad : -ccwRad;
  const bisectorRad = a1 + sweepSigned * 0.5;

  return {
    interiorDeg,
    exteriorDeg,
    acuteDeg,
    obtuseDeg,
    reflexDeg,
    cwDeg,
    ccwDeg,
    classification,
    ray1LengthPx: distance(vertex, p1),
    ray2LengthPx: distance(vertex, p2),
    startAngle,
    endAngle,
    anticlockwise,
    bisectorRad,
  };
}

/**
 * Given two line segments (a1-a2) and (b1-b2), compute an angle measurement triplet (p1, vertex, p2).
 */
export function angleFromTwoLines(a1, a2, b1, b2) {
  const hit = lineLineIntersection(a1, a2, b1, b2);
  if (!hit) return null;

  const vertex = { x: hit.x, y: hit.y };

  // Choose the endpoint on each line farthest from the intersection vertex so rays are visible
  const pickFarPoint = (pStart, pEnd) => {
    const d1 = distance(vertex, pStart);
    const d2 = distance(vertex, pEnd);
    return d1 >= d2 ? { x: pStart.x, y: pStart.y } : { x: pEnd.x, y: pEnd.y };
  };

  const p1 = pickFarPoint(a1, a2);
  const p2 = pickFarPoint(b1, b2);

  return {
    p1,
    vertex,
    p2,
    intersection: hit,
  };
}
