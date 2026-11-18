/**
 * Centralized Zoom-Adaptive Rendering Configuration
 *
 * Strictly separates Image-Space properties (positions, dimensions, coordinates,
 * measurements) from Screen-Space properties (stroke thickness, grid readability,
 * label typography, handle sizes).
 *
 * Changing zoom NEVER alters geometry or measurements; only screen rendering adapts.
 */

export function createDefaultRenderConfig() {
  return {
    lineScaleMode: 'screen-constant', // 'screen-constant' | 'adaptive' | 'image-scaled'
    gridScaleMode: 'screen-constant', // 'screen-constant' | 'adaptive'
    labelScale: 1, // 0.75..1.5 screen typography multiplier
    handleRadiusPx: 5, // screen-space handle radius in CSS px
  };
}

export function createDefaultDisplaySettings() {
  return {
    showMeasurements: true,
    showLabels: true,
    showObjectNames: true,
    showControlPoints: true,
    showHandles: true,
    showSmartGeometry: true,
    smartAnnotationScope: 'selected', // 'selected' | 'all' | 'none'
  };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Convert a base thickness into world/canvas stroke width for the active zoom level.
 * Note: Canvas2D context is scaled by `zoom`, so `screenPx / zoom` renders `screenPx` CSS pixels.
 */
export function resolveStrokeWidthWorld(baseThickness, mode, zoom) {
  const z = Math.max(0.01, zoom);
  const t = Math.max(0.5, Number(baseThickness) || 1.5);

  if (mode === 'image-scaled') {
    // Scales proportionally with image, clamped slightly only at extreme zoom-out for visibility
    return Math.max(t, 0.75 / z);
  }

  if (mode === 'adaptive') {
    // Sublinear zoom curve bounded between crisp hairline and moderate thickness
    const screenPx = clamp(t * Math.pow(z, 0.25), Math.max(0.75, t * 0.65), t * 2.2);
    return screenPx / z;
  }

  // Default: 'screen-constant' — maintains exact screen-pixel thickness at any zoom (5%..3200%)
  return t / z;
}

/**
 * Resolve screen-space dash array converted into world units so dashes never bloat or vanish.
 */
export function resolveDashPatternWorld(dashScreenPx, zoom) {
  const z = Math.max(0.01, zoom);
  return dashScreenPx.map((d) => d / z);
}

/**
 * Resolve handle radius in world units from screen-space pixel radius.
 */
export function resolveHandleRadiusWorld(renderConfig, zoom) {
  const z = Math.max(0.01, zoom);
  const r = clamp(Number(renderConfig?.handleRadiusPx) || 5, 3, 10);
  return r / z;
}

/**
 * Resolve label font size in screen CSS pixels.
 */
export function resolveLabelFontPx(baseFontPx, renderConfig) {
  const scale = clamp(Number(renderConfig?.labelScale) || 1, 0.75, 1.5);
  return Math.round(clamp(baseFontPx * scale, 9, 22) * 10) / 10;
}
