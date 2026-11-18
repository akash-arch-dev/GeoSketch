/**
 * Non-destructive Crop & Image Orientation Manager
 */
import { getWorkingImageDimensions } from './imageProcessor.js';

export const ASPECT_PRESETS = {
  free: null,
  '1:1': 1,
  '4:3': 4 / 3,
  '3:2': 3 / 2,
  '16:9': 16 / 9,
};

export function createDefaultCrop(width, height) {
  return {
    applied: false,
    x: 0,
    y: 0,
    width: Math.max(1, width),
    height: Math.max(1, height),
    draftX: 0,
    draftY: 0,
    draftWidth: Math.max(1, width),
    draftHeight: Math.max(1, height),
    aspectPreset: 'free',
    customW: 4,
    customH: 3,
    editing: false,
  };
}

export function getTargetAspectRatio(crop) {
  if (crop.aspectPreset === 'custom') {
    const w = Math.max(0.1, Number(crop.customW) || 1);
    const h = Math.max(0.1, Number(crop.customH) || 1);
    return w / h;
  }
  return ASPECT_PRESETS[crop.aspectPreset] || null;
}

export function enforceCropBoundsAndAspect(rect, maxW, maxH, aspectRatio, anchor = 'center') {
  let { x, y, width, height } = rect;
  const minSize = 20;

  width = Math.max(minSize, Math.min(maxW, width));
  height = Math.max(minSize, Math.min(maxH, height));

  if (aspectRatio) {
    if (width / height > aspectRatio) {
      width = height * aspectRatio;
    } else {
      height = width / aspectRatio;
    }
    if (width > maxW) {
      width = maxW;
      height = width / aspectRatio;
    }
    if (height > maxH) {
      height = maxH;
      width = height * aspectRatio;
    }
  }

  if (anchor === 'center') {
    const cx = rect.x + rect.width * 0.5;
    const cy = rect.y + rect.height * 0.5;
    x = cx - width * 0.5;
    y = cy - height * 0.5;
  }

  x = Math.max(0, Math.min(maxW - width, x));
  y = Math.max(0, Math.min(maxH - height, y));

  return { x, y, width, height };
}

/**
 * Transform a 2D point (x, y) when rotating the working image by +90 deg CW or -90 deg CCW.
 */
function transformPoint90(pt, oldW, oldH, dir) {
  if (dir === 1) {
    // 90 deg CW: (x, y) -> (oldH - y, x)
    return { x: oldH - pt.y, y: pt.x };
  }
  // 90 deg CCW: (x, y) -> (y, oldW - x)
  return { x: pt.y, y: oldW - pt.x };
}

function transformPointFlip(pt, w, h, axis) {
  if (axis === 'h') return { x: w - pt.x, y: pt.y };
  return { x: pt.x, y: h - pt.y };
}

/**
 * Rotate working image 90 deg CW (+1) or CCW (-1) and keep all overlays aligned.
 */
export function rotateWorkspace90(state, dir) {
  const { width: oldW, height: oldH } = getWorkingImageDimensions(state.image);
  state.image.rotationSteps = ((state.image.rotationSteps || 0) + dir + 4) % 4;
  const { width: newW, height: newH } = getWorkingImageDimensions(state.image);
  state.image.width = newW;
  state.image.height = newH;

  const mapPt = (p) => transformPoint90(p, oldW, oldH, dir);

  // Crop box
  const c1 = mapPt({ x: state.crop.x, y: state.crop.y });
  const c2 = mapPt({ x: state.crop.x + state.crop.width, y: state.crop.y + state.crop.height });
  state.crop.x = Math.min(c1.x, c2.x);
  state.crop.y = Math.min(c1.y, c2.y);
  state.crop.width = Math.abs(c2.x - c1.x);
  state.crop.height = Math.abs(c2.y - c1.y);
  state.crop.draftX = state.crop.x;
  state.crop.draftY = state.crop.y;
  state.crop.draftWidth = state.crop.width;
  state.crop.draftHeight = state.crop.height;

  // Calibration points
  if (state.calibration.p1) state.calibration.p1 = mapPt(state.calibration.p1);
  if (state.calibration.p2) state.calibration.p2 = mapPt(state.calibration.p2);

  // Lines
  for (const l of state.lines) {
    l.p1 = mapPt(l.p1);
    l.p2 = mapPt(l.p2);
  }

  // Angles
  for (const a of state.angles) {
    a.p1 = mapPt(a.p1);
    a.vertex = mapPt(a.vertex);
    a.p2 = mapPt(a.p2);
  }

  // Shapes
  for (const s of state.shapes) {
    const center = mapPt({ x: s.x + s.width * 0.5, y: s.y + s.height * 0.5 });
    s.rotation = (((s.rotation || 0) + dir * 90) % 360 + 360) % 360;
    s.x = center.x - s.width * 0.5;
    s.y = center.y - s.height * 0.5;
    if (s.points) s.points = s.points.map(mapPt);
    if (s.perspectiveCorners) s.perspectiveCorners = s.perspectiveCorners.map(mapPt);
  }

  // Custom guide lines
  for (const g of state.guides.customLines) {
    if (g.orientation === 'horizontal') {
      g.orientation = 'vertical';
      g.position = dir === 1 ? oldH - g.position : g.position;
    } else if (g.orientation === 'vertical') {
      g.orientation = 'horizontal';
      g.position = dir === 1 ? g.position : oldW - g.position;
    } else if (g.p1 && g.p2) {
      g.p1 = mapPt(g.p1);
      g.p2 = mapPt(g.p2);
    }
  }
}

export function flipWorkspace(state, axis) {
  const { width: w, height: h } = getWorkingImageDimensions(state.image);
  if (axis === 'h') state.image.flipH = !state.image.flipH;
  else state.image.flipV = !state.image.flipV;

  const mapPt = (p) => transformPointFlip(p, w, h, axis);

  if (axis === 'h') {
    state.crop.x = w - (state.crop.x + state.crop.width);
    state.crop.draftX = state.crop.x;
  } else {
    state.crop.y = h - (state.crop.y + state.crop.height);
    state.crop.draftY = state.crop.y;
  }

  if (state.calibration.p1) state.calibration.p1 = mapPt(state.calibration.p1);
  if (state.calibration.p2) state.calibration.p2 = mapPt(state.calibration.p2);

  for (const l of state.lines) {
    l.p1 = mapPt(l.p1);
    l.p2 = mapPt(l.p2);
  }

  for (const a of state.angles) {
    a.p1 = mapPt(a.p1);
    a.vertex = mapPt(a.vertex);
    a.p2 = mapPt(a.p2);
  }

  for (const s of state.shapes) {
    const center = mapPt({ x: s.x + s.width * 0.5, y: s.y + s.height * 0.5 });
    s.x = center.x - s.width * 0.5;
    s.y = center.y - s.height * 0.5;
    s.rotation = (-(s.rotation || 0) + 360) % 360;
    if (s.points) s.points = s.points.map(mapPt);
    if (s.perspectiveCorners) s.perspectiveCorners = s.perspectiveCorners.map(mapPt);
  }

  for (const g of state.guides.customLines) {
    if (axis === 'h' && g.orientation === 'vertical') g.position = w - g.position;
    if (axis === 'v' && g.orientation === 'horizontal') g.position = h - g.position;
    if (g.p1 && g.p2) {
      g.p1 = mapPt(g.p1);
      g.p2 = mapPt(g.p2);
    }
  }
}
