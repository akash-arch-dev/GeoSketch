/**
 * Pure 2D Affine & Projective Homography Transformations Engine
 */
import {
  createRegularPolygonVertices,
  sampleEllipsePoints,
  computePolygonSummary,
  ellipsePerimeter,
  ellipseArea,
  polygonCentroid,
} from './polygons.js';
import { boundingBox, distance } from './points.js';

/**
 * Apply 2D affine transform centered around local (0,0) then translated to (cx, cy):
 * scale -> skew -> rotation -> translate
 */
export function applyAffineToLocalPoint(lx, ly, shape) {
  const sx = lx * (shape.scaleX ?? 1);
  const sy = ly * (shape.scaleY ?? 1);

  const skewXRad = ((shape.skewX || 0) * Math.PI) / 180;
  const skewYRad = ((shape.skewY || 0) * Math.PI) / 180;

  const kx = sx + sy * Math.tan(skewXRad);
  const ky = sy + sx * Math.tan(skewYRad);

  const rotRad = ((shape.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rotRad);
  const sin = Math.sin(rotRad);

  const cx = shape.x + shape.width * 0.5;
  const cy = shape.y + shape.height * 0.5;

  return {
    x: cx + (kx * cos - ky * sin),
    y: cy + (kx * sin + ky * cos),
  };
}

/**
 * Solve 8x8 linear system Ax = b via Gaussian elimination with partial pivoting.
 */
function solveLinear8(A, b) {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[maxRow][col])) {
        maxRow = r;
      }
    }
    if (Math.abs(M[maxRow][col]) < 1e-10) {
      return null;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];

    const pivot = M[col][col];
    for (let c = col; c <= n; c++) {
      M[col][c] /= pivot;
    }

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      for (let c = col; c <= n; c++) {
        M[r][c] -= factor * M[col][c];
      }
    }
  }

  return M.map((row) => row[n]);
}

/**
 * Compute 3x3 projective homography matrix H mapping 4 source points -> 4 destination points.
 * srcPts and dstPts are arrays of 4 {x, y} objects: [TL, TR, BR, BL].
 */
export function computeHomography(srcPts, dstPts) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const sx = srcPts[i].x;
    const sy = srcPts[i].y;
    const dx = dstPts[i].x;
    const dy = dstPts[i].y;

    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    b.push(dx);

    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    b.push(dy);
  }

  const h = solveLinear8(A, b);
  if (!h) return null;
  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];
}

export function applyHomography(H, x, y) {
  if (!H) return { x, y };
  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  if (Math.abs(w) < 1e-9) return { x, y };
  return {
    x: (H[0][0] * x + H[0][1] * y + H[0][2]) / w,
    y: (H[1][0] * x + H[1][1] * y + H[1][2]) / w,
  };
}

/**
 * Returns the 4 un-warped (affine-transformed) box corners [TL, TR, BR, BL] in image space.
 */
export function getAffineBoxCorners(shape) {
  const hw = shape.width * 0.5;
  const hh = shape.height * 0.5;
  return [
    applyAffineToLocalPoint(-hw, -hh, shape),
    applyAffineToLocalPoint(hw, -hh, shape),
    applyAffineToLocalPoint(hw, hh, shape),
    applyAffineToLocalPoint(-hw, hh, shape),
  ];
}

/**
 * Returns the active 4 perspective corners [TL, TR, BR, BL] in image space.
 */
export function getShapePerspectiveQuad(shape) {
  if (shape.perspectiveCorners && shape.perspectiveCorners.length === 4) {
    return shape.perspectiveCorners.map((p) => ({ x: p.x, y: p.y }));
  }
  return getAffineBoxCorners(shape);
}

/**
 * Build homography from local normalized box [(-w/2,-h/2)..(w/2,h/2)] to perspective quad.
 */
export function getShapeHomography(shape) {
  const hw = Math.max(1e-3, shape.width * 0.5);
  const hh = Math.max(1e-3, shape.height * 0.5);
  const src = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ];
  const dst = getShapePerspectiveQuad(shape);
  return computeHomography(src, dst);
}

/**
 * Compute world/image-space polygon vertices representing the shape outline.
 */
export function getShapeWorldVertices(shape) {
  const hw = shape.width * 0.5;
  const hh = shape.height * 0.5;
  const isPerspective = Boolean(shape.perspectiveEnabled && shape.perspectiveCorners?.length === 4);
  const H = isPerspective ? getShapeHomography(shape) : null;

  const mapPt = (lx, ly) =>
    isPerspective ? applyHomography(H, lx, ly) : applyAffineToLocalPoint(lx, ly, shape);

  if (shape.type === 'rectangle' || shape.type === 'square') {
    return [
      mapPt(-hw, -hh),
      mapPt(hw, -hh),
      mapPt(hw, hh),
      mapPt(-hw, hh),
    ];
  }

  if (shape.type === 'triangle') {
    return [
      mapPt(0, -hh),
      mapPt(hw, hh),
      mapPt(-hw, hh),
    ];
  }

  if (shape.type === 'polygon') {
    const sides = Math.max(3, Math.min(16, shape.sides || 5));
    const localPts = createRegularPolygonVertices(sides, hw, hh);
    return localPts.map((p) => mapPt(p.x, p.y));
  }

  if (shape.type === 'circle' || shape.type === 'ellipse') {
    const localPts = sampleEllipsePoints(0, 0, hw, hh, 64);
    return localPts.map((p) => mapPt(p.x, p.y));
  }

  if (shape.type === 'customPolygon' || shape.type === 'freehand') {
    const pts = shape.points || [];
    if (isPerspective) {
      const b = shape.localBounds || boundingBox(pts);
      const bw = Math.max(1, b.width);
      const bh = Math.max(1, b.height);
      return pts.map((p) => {
        const nx = ((p.x - b.cx) / bw) * shape.width;
        const ny = ((p.y - b.cy) / bh) * shape.height;
        return applyHomography(H, nx, ny);
      });
    }
    const hasAffine =
      Math.abs(shape.rotation || 0) > 1e-6 ||
      Math.abs((shape.scaleX ?? 1) - 1) > 1e-6 ||
      Math.abs((shape.scaleY ?? 1) - 1) > 1e-6 ||
      Math.abs(shape.skewX || 0) > 1e-6 ||
      Math.abs(shape.skewY || 0) > 1e-6;
    if (!hasAffine) {
      return pts.map((p) => ({ x: p.x, y: p.y }));
    }
    const cx = shape.x + shape.width * 0.5;
    const cy = shape.y + shape.height * 0.5;
    return pts.map((p) => applyAffineToLocalPoint(p.x - cx, p.y - cy, shape));
  }

  return [];
}

/**
 * Compute triangle altitude (base edge B->C, apex A, and perpendicular foot on infinite line BC).
 */
export function computeTriangleAltitude(vertices) {
  if (!vertices || vertices.length !== 3) return null;
  // Base is edge [1] -> [2] (bottom edge of constructed triangle), apex is [0]
  const apex = vertices[0];
  const b1 = vertices[1];
  const b2 = vertices[2];
  const dx = b2.x - b1.x;
  const dy = b2.y - b1.y;
  const baseLen = Math.hypot(dx, dy);
  if (baseLen < 1e-7) return null;
  const t = ((apex.x - b1.x) * dx + (apex.y - b1.y) * dy) / (baseLen * baseLen);
  const foot = {
    x: b1.x + t * dx,
    y: b1.y + t * dy,
  };
  const heightPx = distance(apex, foot);
  return {
    apex,
    b1,
    b2,
    foot,
    basePx: baseLen,
    heightPx,
  };
}

/**
 * Compute comprehensive Original vs Displayed (Distorted) measurements and Smart Annotation geometry.
 */
export function computeShapeMeasurements(shape) {
  const isDistorted =
    Boolean(shape.perspectiveEnabled && shape.perspectiveCorners?.length === 4) ||
    Math.abs((shape.scaleX ?? 1) - 1) > 1e-4 ||
    Math.abs((shape.scaleY ?? 1) - 1) > 1e-4 ||
    Math.abs(shape.skewX || 0) > 1e-4 ||
    Math.abs(shape.skewY || 0) > 1e-4;

  // Original Geometry
  const origW = Math.abs(shape.width);
  const origH = Math.abs(shape.height);
  let origArea = origW * origH;
  let origPerimeter = 2 * (origW + origH);
  let origSideLengths = [origW, origH, origW, origH];
  let origAngles = [90, 90, 90, 90];

  if (shape.type === 'circle' || shape.type === 'ellipse') {
    origArea = ellipseArea(origW * 0.5, origH * 0.5);
    origPerimeter = ellipsePerimeter(origW * 0.5, origH * 0.5);
    origSideLengths = [];
    origAngles = [];
  } else if (shape.type === 'triangle') {
    const triVerts = [
      { x: 0, y: -origH * 0.5 },
      { x: origW * 0.5, y: origH * 0.5 },
      { x: -origW * 0.5, y: origH * 0.5 },
    ];
    const s = computePolygonSummary(triVerts);
    origArea = s.areaPx2;
    origPerimeter = s.perimeterPx;
    origSideLengths = s.sideLengthsPx;
    origAngles = s.internalAnglesDeg;
  } else if (shape.type === 'polygon') {
    const verts = createRegularPolygonVertices(shape.sides || 5, origW * 0.5, origH * 0.5);
    const s = computePolygonSummary(verts);
    origArea = s.areaPx2;
    origPerimeter = s.perimeterPx;
    origSideLengths = s.sideLengthsPx;
    origAngles = s.internalAnglesDeg;
  } else if ((shape.type === 'customPolygon' || shape.type === 'freehand') && shape.points?.length >= 3) {
    const s = computePolygonSummary(shape.points);
    origArea = s.areaPx2;
    origPerimeter = s.perimeterPx;
    origSideLengths = s.sideLengthsPx;
    origAngles = s.internalAnglesDeg;
  }

  const original = {
    widthPx: origW,
    heightPx: origH,
    aspectRatio: origH > 1e-7 ? origW / origH : 0,
    areaPx2: origArea,
    perimeterPx: origPerimeter,
    sideLengthsPx: origSideLengths,
    internalAnglesDeg: origAngles,
    diagonalsPx:
      shape.type === 'rectangle' || shape.type === 'square'
        ? [
            { from: 0, to: 2, lengthPx: Math.hypot(origW, origH) },
            { from: 1, to: 3, lengthPx: Math.hypot(origW, origH) },
          ]
        : [],
  };

  // Displayed Geometry
  const worldVerts = getShapeWorldVertices(shape);
  const isPersp = Boolean(shape.perspectiveEnabled && shape.perspectiveCorners?.length === 4);
  const H = isPersp ? getShapeHomography(shape) : null;
  const mapPt = (lx, ly) => (isPersp ? applyHomography(H, lx, ly) : applyAffineToLocalPoint(lx, ly, shape));
  const center =
    shape.type === 'circle' || shape.type === 'ellipse'
      ? mapPt(0, 0)
      : worldVerts.length >= 3
      ? polygonCentroid(worldVerts)
      : { x: shape.x + shape.width * 0.5, y: shape.y + shape.height * 0.5 };

  let displayed;
  const isPureEllipse =
    (shape.type === 'circle' || shape.type === 'ellipse') &&
    !shape.perspectiveEnabled &&
    Math.abs(shape.skewX || 0) < 1e-4 &&
    Math.abs(shape.skewY || 0) < 1e-4;

  if (isPureEllipse) {
    const rx = origW * Math.abs(shape.scaleX ?? 1) * 0.5;
    const ry = origH * Math.abs(shape.scaleY ?? 1) * 0.5;
    const dispSummary = computePolygonSummary(worldVerts);
    const axisXEnd1 = mapPt(-origW * 0.5, 0);
    const axisXEnd2 = mapPt(origW * 0.5, 0);
    const axisYEnd1 = mapPt(0, -origH * 0.5);
    const axisYEnd2 = mapPt(0, origH * 0.5);

    const majorIsX = rx >= ry;
    displayed = {
      widthPx: dispSummary.widthPx,
      heightPx: dispSummary.heightPx,
      aspectRatio: dispSummary.heightPx > 1e-7 ? dispSummary.widthPx / dispSummary.heightPx : 0,
      center,
      rxPx: rx,
      ryPx: ry,
      radiusPx: Math.abs(rx - ry) < 0.5 ? rx : null,
      diameterPx: Math.abs(rx - ry) < 0.5 ? rx * 2 : null,
      majorAxisPx: Math.max(rx, ry) * 2,
      minorAxisPx: Math.min(rx, ry) * 2,
      majorAxisEndpoints: majorIsX ? [axisXEnd1, axisXEnd2] : [axisYEnd1, axisYEnd2],
      minorAxisEndpoints: majorIsX ? [axisYEnd1, axisYEnd2] : [axisXEnd1, axisXEnd2],
      rotationDeg: shape.rotation || 0,
      areaPx2: ellipseArea(rx, ry),
      perimeterPx: ellipsePerimeter(rx, ry),
      sideLengthsPx: [],
      internalAnglesDeg: [],
      diagonalsPx: [
        { from: 0, to: 2, lengthPx: rx * 2 },
        { from: 1, to: 3, lengthPx: ry * 2 },
      ],
    };
  } else {
    const dispSummary = computePolygonSummary(worldVerts);
    const triangleAlt = shape.type === 'triangle' ? computeTriangleAltitude(worldVerts) : null;
    displayed = {
      widthPx: dispSummary.widthPx,
      heightPx: dispSummary.heightPx,
      aspectRatio: dispSummary.aspectRatio,
      center,
      areaPx2: dispSummary.areaPx2,
      perimeterPx: dispSummary.perimeterPx,
      sideLengthsPx: shape.type === 'circle' || shape.type === 'ellipse' ? [] : dispSummary.sideLengthsPx,
      internalAnglesDeg: shape.type === 'circle' || shape.type === 'ellipse' ? [] : dispSummary.internalAnglesDeg,
      diagonalsPx:
        shape.type === 'circle' || shape.type === 'ellipse' ? [] : dispSummary.diagonalsPx.slice(0, 6),
      triangleAltitude: triangleAlt,
    };
  }

  return {
    isDistorted,
    original,
    displayed,
    worldVerts,
  };
}
