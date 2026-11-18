/**
 * GeoSketch Canvas Rendering Engine
 *
 * Separates Image-Space geometry from Screen-Space zoom-adaptive overlay rendering
 * via renderConfig.js. Supports Smart Geometric Annotations, Snapping Visuals,
 * Marquee Selection, and Full-Resolution Annotated PNG Export.
 */
import { drawTransformedImage } from '../image/imageProcessor.js';
import { computeLineMetrics } from '../geometry/lines.js';
import { computeAngleMetrics } from '../geometry/angles.js';
import {
  getShapeWorldVertices,
  getAffineBoxCorners,
  getShapePerspectiveQuad,
  getShapeHomography,
  applyHomography,
  applyAffineToLocalPoint,
  computeShapeMeasurements,
} from '../geometry/transformations.js';
import { formatLength, formatArea } from '../geometry/measurements.js';
import { distance, midpoint } from '../geometry/points.js';
import {
  resolveStrokeWidthWorld,
  resolveDashPatternWorld,
  resolveHandleRadiusWorld,
  resolveLabelFontPx,
} from './renderConfig.js';

export class CanvasEngine {
  constructor(canvasEl, coords) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.coords = coords;
    this.dpr = window.devicePixelRatio || 1;
  }

  resize(width, height) {
    this.dpr = window.devicePixelRatio || 1;
    this.coords.setViewportSize(width, height);
    this.canvas.width = Math.max(1, Math.floor(width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(height * this.dpr));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  render(state, toolPreview = null) {
    const ctx = this.ctx;
    const vw = this.coords.viewportWidth;
    const vh = this.coords.viewportHeight;

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);

    if (!state.image.element) {
      ctx.restore();
      return;
    }

    const imgW = state.image.width;
    const imgH = state.image.height;

    // World transform (image space -> screen space)
    ctx.save();
    ctx.translate(this.coords.panX, this.coords.panY);
    ctx.scale(this.coords.zoom, this.coords.zoom);

    const isEditingCrop = state.activeTool === 'cropScale' && state.subTools.cropScale === 'crop';
    const hasAppliedCrop = state.crop.applied && !isEditingCrop;

    const bounds = hasAppliedCrop
      ? { x: state.crop.x, y: state.crop.y, width: state.crop.width, height: state.crop.height }
      : { x: 0, y: 0, width: imgW, height: imgH };

    ctx.fillStyle = '#090d16';
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);

    ctx.save();
    if (hasAppliedCrop) {
      ctx.beginPath();
      ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
      ctx.clip();
    }

    if (state.image.visible !== false) {
      drawTransformedImage(ctx, state.image.element, state.image);
    }
    ctx.restore();

    // Image frame hairline
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = resolveStrokeWidthWorld(1, 'screen-constant', this.coords.zoom);
    ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);

    // Visual Guides
    this.renderVisualGuides(ctx, state, bounds, this.coords.zoom, false);

    // Shapes
    for (const shape of state.shapes) {
      if (shape.visible === false) continue;
      const isSelected = state.selectedIds.includes(shape.id);
      this.renderShape(ctx, shape, state, isSelected, this.coords.zoom, false);
    }

    // Measurement Lines
    for (const line of state.lines) {
      if (line.visible === false) continue;
      const isSelected = state.selectedIds.includes(line.id);
      this.renderLine(ctx, line, state, isSelected, this.coords.zoom, false);
    }

    // Angle Measurements
    for (const ang of state.angles) {
      if (ang.visible === false) continue;
      const isSelected = state.selectedIds.includes(ang.id);
      this.renderAngle(ctx, ang, state, isSelected, this.coords.zoom, false);
    }

    // Scale Calibration Reference
    if (
      state.activeTool === 'cropScale' &&
      state.subTools.cropScale === 'scale' &&
      state.calibration.p1 &&
      state.calibration.p2
    ) {
      this.renderScaleReference(ctx, state.calibration, state.renderConfig, this.coords.zoom);
    }

    // Crop Overlay
    if (isEditingCrop) {
      this.renderCropOverlay(ctx, state, imgW, imgH, this.coords.zoom);
    }

    // Live Tool Preview & Smart Live Dimensions
    if (toolPreview) {
      this.renderToolPreview(ctx, toolPreview, state, this.coords.zoom);
    }

    // Selection Handles & Control Points
    if (state.display.showHandles !== false) {
      this.renderSelectionGizmos(ctx, state, this.coords.zoom);
    }

    // Snap Feedback Overlay (drawn in world coordinates, screen-constant sizes)
    if (toolPreview && toolPreview.snap && toolPreview.snap.snapped) {
      this.renderSnapFeedback(ctx, toolPreview.snap, state.renderConfig, this.coords.zoom);
    }

    ctx.restore();
    ctx.restore();
  }

  /**
   * Render full-resolution annotated PNG onto an offscreen canvas (without handles or snap gizmos).
   */
  renderExportCanvas(state) {
    const imgW = state.image.width;
    const imgH = state.image.height;
    const useCrop = state.crop.applied;
    const outX = useCrop ? Math.round(state.crop.x) : 0;
    const outY = useCrop ? Math.round(state.crop.y) : 0;
    const outW = useCrop ? Math.max(1, Math.round(state.crop.width)) : imgW;
    const outH = useCrop ? Math.max(1, Math.round(state.crop.height)) : imgH;

    const off = document.createElement('canvas');
    off.width = outW;
    off.height = outH;
    const ctx = off.getContext('2d');

    ctx.save();
    ctx.translate(-outX, -outY);

    if (state.image.visible !== false) {
      drawTransformedImage(ctx, state.image.element, state.image);
    }

    const bounds = { x: outX, y: outY, width: outW, height: outH };
    this.renderVisualGuides(ctx, state, bounds, 1, true);

    for (const shape of state.shapes) {
      if (shape.visible === false) continue;
      this.renderShape(ctx, shape, state, false, 1, true);
    }
    for (const line of state.lines) {
      if (line.visible === false) continue;
      this.renderLine(ctx, line, state, false, 1, true);
    }
    for (const ang of state.angles) {
      if (ang.visible === false) continue;
      this.renderAngle(ctx, ang, state, false, 1, true);
    }

    ctx.restore();
    return off;
  }

  applyLineStyle(ctx, style, thickness, mode, zoom) {
    ctx.lineWidth = resolveStrokeWidthWorld(thickness, mode, zoom);
    if (style === 'dashed') {
      ctx.setLineDash(resolveDashPatternWorld([8, 6], zoom));
    } else if (style === 'dotted') {
      ctx.setLineDash(resolveDashPatternWorld([2, 5], zoom));
    } else {
      ctx.setLineDash([]);
    }
  }

  renderVisualGuides(ctx, state, bounds, zoom, isExport) {
    const g = state.guides;
    const { x, y, width, height } = bounds;
    const gridMode = isExport ? 'image-scaled' : state.renderConfig.gridScaleMode;

    ctx.save();

    // 1. Grid
    if (g.grid.visible) {
      ctx.save();
      ctx.strokeStyle = g.grid.color || '#38bdf8';
      ctx.globalAlpha = g.grid.opacity ?? 0.45;
      this.applyLineStyle(ctx, g.grid.style, g.grid.thickness || 1, gridMode, zoom);

      const ox = Number(g.grid.offsetX) || 0;
      const oy = Number(g.grid.offsetY) || 0;

      ctx.beginPath();
      if (g.grid.mode === 'cellSize') {
        const cw = Math.max(4, Number(g.grid.cellWidth) || 100);
        const ch = Math.max(4, Number(g.grid.cellHeight) || 100);
        const startX = x + (((ox % cw) + cw) % cw);
        const startY = y + (((oy % ch) + ch) % ch);
        for (let gx = startX; gx <= x + width + 0.5; gx += cw) {
          if (gx > x + 0.5 && gx < x + width - 0.5) {
            ctx.moveTo(gx, y);
            ctx.lineTo(gx, y + height);
          }
        }
        for (let gy = startY; gy <= y + height + 0.5; gy += ch) {
          if (gy > y + 0.5 && gy < y + height - 0.5) {
            ctx.moveTo(x, gy);
            ctx.lineTo(x + width, gy);
          }
        }
      } else {
        const cols = Math.max(1, Math.min(100, Number(g.grid.columns) || 4));
        const rows = Math.max(1, Math.min(100, Number(g.grid.rows) || 4));
        for (let c = 1; c < cols; c++) {
          const gx = x + (width * c) / cols + ox;
          if (gx > x && gx < x + width) {
            ctx.moveTo(gx, y);
            ctx.lineTo(gx, y + height);
          }
        }
        for (let r = 1; r < rows; r++) {
          const gy = y + (height * r) / rows + oy;
          if (gy > y && gy < y + height) {
            ctx.moveTo(x, gy);
            ctx.lineTo(x + width, gy);
          }
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    // 2. Structural Guides
    ctx.save();
    ctx.strokeStyle = g.guideColor || '#f59e0b';
    ctx.globalAlpha = g.guideOpacity ?? 0.65;
    ctx.lineWidth = resolveStrokeWidthWorld(g.guideThickness || 1, gridMode, zoom);

    if (g.hCenter) {
      ctx.setLineDash(resolveDashPatternWorld([6, 4], zoom));
      ctx.beginPath();
      ctx.moveTo(x, y + height * 0.5);
      ctx.lineTo(x + width, y + height * 0.5);
      ctx.stroke();
    }
    if (g.vCenter) {
      ctx.setLineDash(resolveDashPatternWorld([6, 4], zoom));
      ctx.beginPath();
      ctx.moveTo(x + width * 0.5, y);
      ctx.lineTo(x + width * 0.5, y + height);
      ctx.stroke();
    }
    if (g.diagonals) {
      ctx.setLineDash(resolveDashPatternWorld([5, 5], zoom));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + width, y + height);
      ctx.moveTo(x + width, y);
      ctx.lineTo(x, y + height);
      ctx.stroke();
    }
    if (g.ruleOfThirds) {
      ctx.setLineDash([]);
      ctx.beginPath();
      for (const f of [1 / 3, 2 / 3]) {
        ctx.moveTo(x + width * f, y);
        ctx.lineTo(x + width * f, y + height);
        ctx.moveTo(x, y + height * f);
        ctx.lineTo(x + width, y + height * f);
      }
      ctx.stroke();
    }
    if (g.goldenRatio) {
      const phi = 0.61803398875;
      const invPhi = 1 - phi;
      ctx.setLineDash(resolveDashPatternWorld([4, 3], zoom));
      ctx.beginPath();
      for (const f of [invPhi, phi]) {
        ctx.moveTo(x + width * f, y);
        ctx.lineTo(x + width * f, y + height);
        ctx.moveTo(x, y + height * f);
        ctx.lineTo(x + width, y + height * f);
      }
      ctx.stroke();
    }
    if (g.symmetry.enabled) {
      ctx.save();
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = resolveStrokeWidthWorld(1.5, gridMode, zoom);
      ctx.setLineDash(resolveDashPatternWorld([10, 5, 2, 5], zoom));
      const off = Number(g.symmetry.offset) || 0;
      ctx.beginPath();
      if (g.symmetry.axis === 'vertical' || g.symmetry.axis === 'both') {
        const sx = x + width * 0.5 + off;
        ctx.moveTo(sx, y);
        ctx.lineTo(sx, y + height);
      }
      if (g.symmetry.axis === 'horizontal' || g.symmetry.axis === 'both') {
        const sy = y + height * 0.5 + off;
        ctx.moveTo(x, sy);
        ctx.lineTo(x + width, sy);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 3. Custom Guide Lines
    if (g.showCustomGuides) {
      for (const cl of g.customLines) {
        if (cl.visible === false) continue;
        const isSelected = !isExport && state.selectedIds.includes(cl.id);
        ctx.save();
        ctx.strokeStyle = isSelected ? '#ffffff' : cl.color || '#818cf8';
        ctx.globalAlpha = cl.opacity ?? 0.75;
        this.applyLineStyle(ctx, cl.style || 'dashed', (cl.thickness || 1) + (isSelected ? 1 : 0), gridMode, zoom);
        ctx.beginPath();
        if (cl.orientation === 'horizontal') {
          ctx.moveTo(x, cl.position);
          ctx.lineTo(x + width, cl.position);
        } else if (cl.orientation === 'vertical') {
          ctx.moveTo(cl.position, y);
          ctx.lineTo(cl.position, y + height);
        } else if (cl.p1 && cl.p2) {
          ctx.moveTo(cl.p1.x, cl.p1.y);
          ctx.lineTo(cl.p2.x, cl.p2.y);
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    ctx.restore();
    ctx.restore();
  }

  shouldShowSmartAnnotations(state, isSelected) {
    const d = state.display;
    if (!d || !d.showSmartGeometry || d.smartAnnotationScope === 'none') return false;
    if (d.smartAnnotationScope === 'all') return true;
    return isSelected;
  }

  renderLine(ctx, line, state, isSelected, zoom, isExport) {
    const metrics = computeLineMetrics(line.p1, line.p2);
    const cal = state.calibration;
    const rc = state.renderConfig;
    const disp = state.display;
    const mode = isExport ? 'image-scaled' : rc.lineScaleMode;

    ctx.save();
    ctx.globalAlpha = line.opacity ?? 1;
    ctx.strokeStyle = line.color || '#38bdf8';
    ctx.lineWidth = resolveStrokeWidthWorld((line.thickness || 2) + (isSelected ? 1 : 0), mode, zoom);
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(line.p1.x, line.p1.y);
    ctx.lineTo(line.p2.x, line.p2.y);
    ctx.stroke();

    // End tick caps
    const tickSize = 5 / zoom;
    const len = Math.max(1e-6, metrics.lengthPx);
    const nx = -(line.p2.y - line.p1.y) / len;
    const ny = (line.p2.x - line.p1.x) / len;
    ctx.beginPath();
    ctx.moveTo(line.p1.x - nx * tickSize, line.p1.y - ny * tickSize);
    ctx.lineTo(line.p1.x + nx * tickSize, line.p1.y + ny * tickSize);
    ctx.moveTo(line.p2.x - nx * tickSize, line.p2.y - ny * tickSize);
    ctx.lineTo(line.p2.x + nx * tickSize, line.p2.y + ny * tickSize);
    ctx.stroke();

    // Control points (independent of labels/handles)
    if (!isExport && disp.showControlPoints !== false && !isSelected) {
      const cpr = 2.5 / zoom;
      ctx.fillStyle = line.color || '#38bdf8';
      ctx.beginPath();
      ctx.arc(line.p1.x, line.p1.y, cpr, 0, Math.PI * 2);
      ctx.arc(line.p2.x, line.p2.y, cpr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Smart Geometry: ΔX and ΔY right-triangle projection legs
    if (this.shouldShowSmartAnnotations(state, isSelected) && metrics.absDx > 8 && metrics.absDy > 8) {
      const corner = { x: line.p2.x, y: line.p1.y };
      ctx.save();
      ctx.strokeStyle = '#818cf8';
      ctx.globalAlpha = 0.72;
      ctx.lineWidth = resolveStrokeWidthWorld(1.2, 'screen-constant', zoom);
      ctx.setLineDash(resolveDashPatternWorld([4, 4], zoom));
      ctx.beginPath();
      ctx.moveTo(line.p1.x, line.p1.y);
      ctx.lineTo(corner.x, corner.y);
      ctx.lineTo(line.p2.x, line.p2.y);
      ctx.stroke();
      ctx.restore();

      if (disp.showLabels !== false && disp.showMeasurements !== false) {
        const dxStr = `ΔX ${formatLength(metrics.absDx, cal.displayUnit, cal, cal.precision)}`;
        const dyStr = `ΔY ${formatLength(metrics.absDy, cal.displayUnit, cal, cal.precision)}`;
        this.drawWorldLabel(ctx, (line.p1.x + corner.x) * 0.5, corner.y + (line.p2.y >= line.p1.y ? -11 : 11) / zoom, dxStr, '#818cf8', zoom, 10, rc);
        this.drawWorldLabel(ctx, corner.x + (line.p2.x >= line.p1.x ? 26 : -26) / zoom, (corner.y + line.p2.y) * 0.5, dyStr, '#818cf8', zoom, 10, rc);
      }
    }

    // Primary Label (never hides geometry when disabled)
    if (disp.showLabels !== false) {
      const parts = [];
      if (disp.showObjectNames !== false) parts.push(line.name);
      if (disp.showMeasurements !== false) {
        parts.push(formatLength(metrics.lengthPx, cal.displayUnit, cal, cal.precision));
        parts.push(`${metrics.horizontalAcuteDeg.toFixed(1)}°`);
      }
      if (parts.length > 0) {
        const text = parts.join(' · ');
        this.drawWorldLabel(ctx, metrics.midpoint.x, metrics.midpoint.y - 12 / zoom, text, line.color, zoom, 11, rc);
      }
    }

    ctx.restore();
  }

  renderShape(ctx, shape, state, isSelected, zoom, isExport) {
    const verts = getShapeWorldVertices(shape);
    if (verts.length < 2) return;

    const rc = state.renderConfig;
    const disp = state.display;
    const cal = state.calibration;
    const unit = cal.displayUnit;
    const prec = cal.precision ?? 2;
    const mode = isExport ? 'image-scaled' : rc.lineScaleMode;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i].x, verts[i].y);
    }
    ctx.closePath();

    if ((shape.fillOpacity ?? 0) > 0) {
      ctx.save();
      ctx.globalAlpha = shape.fillOpacity;
      ctx.fillStyle = shape.fillColor || '#f59e0b';
      ctx.fill();
      ctx.restore();
    }

    ctx.strokeStyle = shape.borderColor || '#f59e0b';
    ctx.lineWidth = resolveStrokeWidthWorld((shape.borderThickness || 2) + (isSelected ? 1 : 0), mode, zoom);
    ctx.stroke();

    // Optional internal construction sub-grid (2x2 center lines + diagonals)
    if (shape.showPerspectiveGrid) {
      const hw = shape.width * 0.5;
      const hh = shape.height * 0.5;
      const isPersp = Boolean(shape.perspectiveEnabled && shape.perspectiveCorners?.length === 4);
      const H = isPersp ? getShapeHomography(shape) : null;
      const mapPt = (lx, ly) =>
        isPersp ? applyHomography(H, lx, ly) : applyAffineToLocalPoint(lx, ly, shape);

      ctx.save();
      ctx.strokeStyle = shape.borderColor || '#f59e0b';
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = resolveStrokeWidthWorld(1, 'screen-constant', zoom);
      ctx.setLineDash(resolveDashPatternWorld([4, 4], zoom));

      const midTop = mapPt(0, -hh);
      const midBot = mapPt(0, hh);
      const midLeft = mapPt(-hw, 0);
      const midRight = mapPt(hw, 0);
      const tl = mapPt(-hw, -hh);
      const tr = mapPt(hw, -hh);
      const br = mapPt(hw, hh);
      const bl = mapPt(-hw, hh);

      ctx.beginPath();
      ctx.moveTo(midTop.x, midTop.y);
      ctx.lineTo(midBot.x, midBot.y);
      ctx.moveTo(midLeft.x, midLeft.y);
      ctx.lineTo(midRight.x, midRight.y);
      ctx.moveTo(tl.x, tl.y);
      ctx.lineTo(br.x, br.y);
      ctx.moveTo(tr.x, tr.y);
      ctx.lineTo(bl.x, bl.y);
      ctx.stroke();
      ctx.restore();
    }

    // Smart Geometric Annotations
    const showSmart = this.shouldShowSmartAnnotations(state, isSelected);
    const measurements = showSmart || (disp.showLabels !== false && (disp.showMeasurements !== false || disp.showObjectNames !== false))
      ? computeShapeMeasurements(shape)
      : null;

    if (disp.showControlPoints !== false && measurements) {
      const c = measurements.displayed.center;
      ctx.save();
      ctx.fillStyle = shape.borderColor || '#f59e0b';
      ctx.beginPath();
      ctx.arc(c.x, c.y, 3 / zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (showSmart && measurements) {
      this.renderShapeSmartAnnotations(ctx, shape, measurements, state, zoom);
    }

    // Primary Shape Name / Summary Label
    if (disp.showLabels !== false && measurements) {
      const c = measurements.displayed.center;
      const parts = [];
      if (disp.showObjectNames !== false) parts.push(shape.name);
      if (disp.showMeasurements !== false && !showSmart) {
        if (measurements.displayed.radiusPx != null) {
          parts.push(`r ${formatLength(measurements.displayed.radiusPx, unit, cal, prec)}`);
        } else {
          parts.push(
            `${formatLength(measurements.displayed.widthPx, unit, cal, prec).replace(/ [a-z]+$/i, '')} × ${formatLength(measurements.displayed.heightPx, unit, cal, prec)}`
          );
        }
      }
      if (parts.length > 0) {
        this.drawWorldLabel(ctx, c.x, c.y - (showSmart ? 14 / zoom : 0), parts.join(' · '), shape.borderColor, zoom, 10.5, rc);
      }
    }

    ctx.restore();
  }

  renderShapeSmartAnnotations(ctx, shape, measurements, state, zoom) {
    const d = measurements.displayed;
    const cal = state.calibration;
    const unit = cal.displayUnit;
    const prec = cal.precision ?? 2;
    const rc = state.renderConfig;
    const showText = state.display.showLabels !== false && state.display.showMeasurements !== false;

    ctx.save();
    const dash = resolveDashPatternWorld([5, 4], zoom);
    const thinW = resolveStrokeWidthWorld(1.2, 'screen-constant', zoom);

    // 1. Circle / Ellipse
    if ((shape.type === 'circle' || shape.type === 'ellipse') && d.majorAxisEndpoints && d.minorAxisEndpoints) {
      const [maj1, maj2] = d.majorAxisEndpoints;
      const [min1, min2] = d.minorAxisEndpoints;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = thinW;
      ctx.setLineDash(dash);

      if (d.radiusPx != null) {
        // Circle: center -> right edge radius + diameter chord
        ctx.beginPath();
        ctx.moveTo(maj1.x, maj1.y);
        ctx.lineTo(maj2.x, maj2.y);
        ctx.stroke();

        if (showText) {
          const rMid = midpoint(d.center, maj2);
          this.drawWorldLabel(ctx, rMid.x, rMid.y - 10 / zoom, `r: ${formatLength(d.radiusPx, unit, cal, prec)}`, '#38bdf8', zoom, 10, rc);
          this.drawWorldLabel(ctx, d.center.x, maj2.y + 14 / zoom, `Ø ${formatLength(d.diameterPx, unit, cal, prec)} · C ${formatLength(d.perimeterPx, unit, cal, prec)}`, '#818cf8', zoom, 10, rc);
        }
      } else {
        // Ellipse: major & minor axes
        ctx.beginPath();
        ctx.moveTo(maj1.x, maj1.y);
        ctx.lineTo(maj2.x, maj2.y);
        ctx.stroke();

        ctx.strokeStyle = '#818cf8';
        ctx.beginPath();
        ctx.moveTo(min1.x, min1.y);
        ctx.lineTo(min2.x, min2.y);
        ctx.stroke();

        if (showText) {
          const mMaj = midpoint(d.center, maj2);
          const mMin = midpoint(d.center, min2);
          this.drawWorldLabel(ctx, mMaj.x, mMaj.y - 10 / zoom, `Major ${formatLength(d.majorAxisPx, unit, cal, prec)}`, '#38bdf8', zoom, 10, rc);
          this.drawWorldLabel(ctx, mMin.x, mMin.y + 10 / zoom, `Minor ${formatLength(d.minorAxisPx, unit, cal, prec)}`, '#818cf8', zoom, 10, rc);
        }
      }
      ctx.restore();
      return;
    }

    // 2. Rectangle / Square: diagonal + dimensions + aspect ratio
    if (shape.type === 'rectangle' || shape.type === 'square') {
      const verts = measurements.worldVerts;
      if (verts.length === 4) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = thinW;
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(verts[0].x, verts[0].y);
        ctx.lineTo(verts[2].x, verts[2].y);
        ctx.stroke();

        if (showText) {
          const topMid = midpoint(verts[0], verts[1]);
          const rightMid = midpoint(verts[1], verts[2]);
          const diagLen = distance(verts[0], verts[2]);
          this.drawWorldLabel(ctx, topMid.x, topMid.y - 11 / zoom, `W: ${formatLength(d.sideLengthsPx[0], unit, cal, prec)}`, '#f59e0b', zoom, 10, rc);
          this.drawWorldLabel(ctx, rightMid.x + 26 / zoom, rightMid.y, `H: ${formatLength(d.sideLengthsPx[1], unit, cal, prec)}`, '#f59e0b', zoom, 10, rc);
          this.drawWorldLabel(ctx, d.center.x, d.center.y + 14 / zoom, `Diag: ${formatLength(diagLen, unit, cal, prec)} · ${d.aspectRatio.toFixed(2)}:1`, '#38bdf8', zoom, 10, rc);
        }
      }
      ctx.restore();
      return;
    }

    // 3. Triangle: altitude height line + base + side lengths + angles
    if (shape.type === 'triangle' && d.triangleAltitude) {
      const alt = d.triangleAltitude;
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = thinW;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(alt.apex.x, alt.apex.y);
      ctx.lineTo(alt.foot.x, alt.foot.y);
      ctx.stroke();

      if (showText) {
        const hMid = midpoint(alt.apex, alt.foot);
        const bMid = midpoint(alt.b1, alt.b2);
        this.drawWorldLabel(ctx, hMid.x + 18 / zoom, hMid.y, `h: ${formatLength(alt.heightPx, unit, cal, prec)}`, '#10b981', zoom, 10, rc);
        this.drawWorldLabel(ctx, bMid.x, bMid.y + 13 / zoom, `b: ${formatLength(alt.basePx, unit, cal, prec)}`, '#f59e0b', zoom, 10, rc);
      }
    }

    // 4. General Polygon / Triangle edge & vertex annotations
    const verts = measurements.worldVerts;
    if (showText && verts.length >= 3 && verts.length <= 10) {
      for (let i = 0; i < verts.length; i++) {
        const v1 = verts[i];
        const v2 = verts[(i + 1) % verts.length];
        if (shape.type !== 'triangle' || i !== 1) {
          const em = midpoint(v1, v2);
          const sLen = d.sideLengthsPx[i];
          if (sLen > 12) {
            this.drawWorldLabel(ctx, em.x, em.y, formatLength(sLen, unit, cal, prec), '#f59e0b', zoom, 9.5, rc);
          }
        }
        const ang = d.internalAnglesDeg[i];
        if (Number.isFinite(ang)) {
          const dirX = d.center.x - v1.x;
          const dirY = d.center.y - v1.y;
          const dLen = Math.max(1e-5, Math.hypot(dirX, dirY));
          const offset = Math.min(20 / zoom, dLen * 0.35);
          this.drawWorldLabel(ctx, v1.x + (dirX / dLen) * offset, v1.y + (dirY / dLen) * offset, `${ang.toFixed(0)}°`, '#818cf8', zoom, 9.5, rc);
        }
      }
      if (shape.type === 'polygon' || shape.type === 'customPolygon') {
        this.drawWorldLabel(ctx, d.center.x, d.center.y + 14 / zoom, `P: ${formatLength(d.perimeterPx, unit, cal, prec)} · A: ${formatArea(d.areaPx2, unit, cal, prec)}`, '#38bdf8', zoom, 9.5, rc);
      }
    }

    ctx.restore();
  }

  renderAngle(ctx, ang, state, isSelected, zoom, isExport) {
    const m = computeAngleMetrics(ang.p1, ang.vertex, ang.p2);
    const rc = state.renderConfig;
    const disp = state.display;
    const color = ang.arcColor || '#10b981';
    const mode = isExport ? 'image-scaled' : rc.lineScaleMode;
    const lw = resolveStrokeWidthWorld((ang.arcThickness || 2) + (isSelected ? 1 : 0), mode, zoom);
    const maxRay = Math.min(m.ray1LengthPx, m.ray2LengthPx);
    // Keep arc radius usable in screen space when zooming in deeply
    const arcR = Math.max(10 / zoom, Math.min(maxRay * 0.85, (ang.arcRadius || 42) / zoom));

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(ang.p1.x, ang.p1.y);
    ctx.lineTo(ang.vertex.x, ang.vertex.y);
    ctx.lineTo(ang.p2.x, ang.p2.y);
    ctx.stroke();

    // Interior Arc
    ctx.beginPath();
    ctx.arc(ang.vertex.x, ang.vertex.y, arcR, m.startAngle, m.endAngle, m.anticlockwise);
    ctx.stroke();

    if (ang.showReflex) {
      ctx.save();
      ctx.setLineDash(resolveDashPatternWorld([4, 4], zoom));
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(ang.vertex.x, ang.vertex.y, arcR * 0.72, m.startAngle, m.endAngle, !m.anticlockwise);
      ctx.stroke();
      ctx.restore();
    }

    if (disp.showLabels !== false) {
      const prec = ang.precision ?? 1;
      const parts = [];
      if (disp.showObjectNames !== false && isSelected) parts.push(ang.name);
      if (disp.showMeasurements !== false) {
        let degStr = `${m.interiorDeg.toFixed(prec)}°`;
        if (ang.showReflex) degStr += ` (R: ${m.reflexDeg.toFixed(prec)}°)`;
        else if (ang.showExterior) degStr += ` (E: ${m.exteriorDeg.toFixed(prec)}°)`;
        parts.push(degStr);
      }

      if (parts.length > 0) {
        let labelMult = 1.45;
        if (ang.labelPosition === 'inside') labelMult = 0.65;
        else if (ang.labelPosition === 'outside') labelMult = 1.85;

        const lx = ang.vertex.x + Math.cos(m.bisectorRad) * (arcR * labelMult);
        const ly = ang.vertex.y + Math.sin(m.bisectorRad) * (arcR * labelMult);
        this.drawWorldLabel(ctx, lx, ly, parts.join(' · '), color, zoom, ang.textSize || 11.5, rc);
      }
    }

    ctx.restore();
  }

  renderScaleReference(ctx, cal, rc, zoom) {
    const distPx = distance(cal.p1, cal.p2);
    ctx.save();
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = resolveStrokeWidthWorld(2, 'screen-constant', zoom);
    ctx.setLineDash(resolveDashPatternWorld([6, 4], zoom));
    ctx.beginPath();
    ctx.moveTo(cal.p1.x, cal.p1.y);
    ctx.lineTo(cal.p2.x, cal.p2.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const r = resolveHandleRadiusWorld(rc, zoom);
    for (const pt of [cal.p1, cal.p2]) {
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0b1120';
      ctx.lineWidth = 1.5 / zoom;
      ctx.stroke();
    }

    const mx = (cal.p1.x + cal.p2.x) * 0.5;
    const my = (cal.p1.y + cal.p2.y) * 0.5;
    const text = cal.calibrated
      ? `Scale: ${distPx.toFixed(1)} px = ${cal.realValue} ${cal.realUnit}`
      : `Ref: ${distPx.toFixed(1)} px`;
    this.drawWorldLabel(ctx, mx, my - 14 / zoom, text, '#10b981', zoom, 11, rc);
    ctx.restore();
  }

  renderCropOverlay(ctx, state, imgW, imgH, zoom) {
    const c = state.crop;
    const rx = c.draftX;
    const ry = c.draftY;
    const rw = c.draftWidth;
    const rh = c.draftHeight;

    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 23, 0.64)';
    ctx.beginPath();
    ctx.rect(0, 0, imgW, imgH);
    ctx.rect(rx, ry, rw, rh);
    ctx.fill('evenodd');

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = resolveStrokeWidthWorld(1.8, 'screen-constant', zoom);
    ctx.strokeRect(rx, ry, rw, rh);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = resolveStrokeWidthWorld(1, 'screen-constant', zoom);
    ctx.beginPath();
    for (const f of [1 / 3, 2 / 3]) {
      ctx.moveTo(rx + rw * f, ry);
      ctx.lineTo(rx + rw * f, ry + rh);
      ctx.moveTo(rx, ry + rh * f);
      ctx.lineTo(rx + rw, ry + rh * f);
    }
    ctx.stroke();

    const handles = [
      { x: rx, y: ry },
      { x: rx + rw * 0.5, y: ry },
      { x: rx + rw, y: ry },
      { x: rx + rw, y: ry + rh * 0.5 },
      { x: rx + rw, y: ry + rh },
      { x: rx + rw * 0.5, y: ry + rh },
      { x: rx, y: ry + rh },
      { x: rx, y: ry + rh * 0.5 },
    ];
    const hs = 5 / zoom;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5 / zoom;
    for (const h of handles) {
      ctx.fillRect(h.x - hs, h.y - hs, hs * 2, hs * 2);
      ctx.strokeRect(h.x - hs, h.y - hs, hs * 2, hs * 2);
    }
    ctx.restore();
  }

  renderToolPreview(ctx, preview, state, zoom) {
    const rc = state.renderConfig;
    const cal = state.calibration;
    const unit = cal.displayUnit;
    const prec = cal.precision ?? 2;

    ctx.save();
    if (preview.type === 'marquee') {
      const { x, y, width, height } = preview.rect;
      ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.2 / zoom;
      ctx.setLineDash(resolveDashPatternWorld([4, 3], zoom));
      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(x, y, width, height);
    } else if (preview.type === 'line') {
      this.renderLine(ctx, preview.line, state, true, zoom, false);
    } else if (preview.type === 'shape') {
      this.renderShape(ctx, preview.shape, state, true, zoom, false);
      const s = preview.shape;
      const wStr = formatLength(s.width, unit, cal, prec);
      const hStr = formatLength(s.height, unit, cal, prec);
      this.drawWorldLabel(ctx, s.x + s.width * 0.5, s.y - 12 / zoom, `${wStr} × ${hStr}`, '#f59e0b', zoom, 11, rc);
    } else if (preview.type === 'customPolygon') {
      const pts = preview.points;
      if (pts.length >= 1) {
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = resolveStrokeWidthWorld(2, 'screen-constant', zoom);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        if (preview.cursor) ctx.lineTo(preview.cursor.x, preview.cursor.y);
        ctx.stroke();

        const r = resolveHandleRadiusWorld(rc, zoom);
        for (let i = 0; i < pts.length; i++) {
          ctx.fillStyle = i === 0 ? '#10b981' : '#f59e0b';
          ctx.beginPath();
          ctx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        if (preview.cursor && pts.length >= 1) {
          const last = pts[pts.length - 1];
          const segLen = distance(last, preview.cursor);
          this.drawWorldLabel(ctx, (last.x + preview.cursor.x) * 0.5, (last.y + preview.cursor.y) * 0.5 - 12 / zoom, formatLength(segLen, unit, cal, prec), '#f59e0b', zoom, 10.5, rc);
        }
      }
    } else if (preview.type === 'freehand') {
      const pts = preview.points;
      if (pts.length >= 2) {
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = resolveStrokeWidthWorld(2, 'screen-constant', zoom);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
    } else if (preview.type === 'angle') {
      const pts = preview.points;
      if (pts.length === 1 && preview.cursor) {
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = resolveStrokeWidthWorld(2, 'screen-constant', zoom);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(preview.cursor.x, preview.cursor.y);
        ctx.stroke();
      } else if (pts.length === 2 && preview.cursor) {
        this.renderAngle(
          ctx,
          {
            name: 'Preview',
            p1: pts[0],
            vertex: pts[1],
            p2: preview.cursor,
            arcColor: '#10b981',
            arcThickness: 2,
            arcRadius: state.toolDefaults.angleArcRadius || 42,
            precision: state.toolDefaults.anglePrecision ?? 1,
          },
          state,
          true,
          zoom,
          false
        );
      }
    } else if (preview.type === 'twoLinesAngle') {
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = resolveStrokeWidthWorld(2, 'screen-constant', zoom);
      if (preview.line1) {
        ctx.beginPath();
        ctx.moveTo(preview.line1.p1.x, preview.line1.p1.y);
        ctx.lineTo(preview.line1.p2.x, preview.line1.p2.y);
        ctx.stroke();
      }
      if (preview.activeStart && preview.cursor) {
        ctx.setLineDash(resolveDashPatternWorld([5, 4], zoom));
        ctx.beginPath();
        ctx.moveTo(preview.activeStart.x, preview.activeStart.y);
        ctx.lineTo(preview.cursor.x, preview.cursor.y);
        ctx.stroke();
      }
    } else if (preview.type === 'scalePoint' && preview.p1 && preview.cursor) {
      this.renderScaleReference(ctx, { p1: preview.p1, p2: preview.cursor, calibrated: false }, rc, zoom);
    }
    ctx.restore();
  }

  renderSnapFeedback(ctx, snap, rc, zoom) {
    ctx.save();
    // Alignment guide lines
    if (snap.alignGuides && snap.alignGuides.length) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash(resolveDashPatternWorld([4, 4], zoom));
      ctx.beginPath();
      for (const ag of snap.alignGuides) {
        ctx.moveTo(ag.from.x, ag.from.y);
        ctx.lineTo(ag.to.x, ag.to.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const r = 6 / zoom;
    ctx.strokeStyle = snap.type === 'endpoint' ? '#f59e0b' : snap.type === 'intersection' ? '#fb7185' : '#38bdf8';
    ctx.lineWidth = 1.8 / zoom;

    if (snap.type === 'endpoint') {
      ctx.strokeRect(snap.x - r, snap.y - r, r * 2, r * 2);
    } else if (snap.type === 'center') {
      ctx.beginPath();
      ctx.moveTo(snap.x, snap.y - r * 1.2);
      ctx.lineTo(snap.x + r * 1.2, snap.y);
      ctx.lineTo(snap.x, snap.y + r * 1.2);
      ctx.lineTo(snap.x - r * 1.2, snap.y);
      ctx.closePath();
      ctx.stroke();
    } else if (snap.type === 'intersection') {
      ctx.beginPath();
      ctx.moveTo(snap.x - r, snap.y - r);
      ctx.lineTo(snap.x + r, snap.y + r);
      ctx.moveTo(snap.x + r, snap.y - r);
      ctx.lineTo(snap.x - r, snap.y + r);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(snap.x - r, snap.y);
      ctx.lineTo(snap.x + r, snap.y);
      ctx.moveTo(snap.x, snap.y - r);
      ctx.lineTo(snap.x, snap.y + r);
      ctx.stroke();
    }

    if (snap.label) {
      this.drawWorldLabel(ctx, snap.x, snap.y + 16 / zoom, snap.label, '#38bdf8', zoom, 10, rc);
    }
    ctx.restore();
  }

  renderSelectionGizmos(ctx, state, zoom) {
    const r = resolveHandleRadiusWorld(state.renderConfig, zoom);
    for (const id of state.selectedIds) {
      const line = state.lines.find((x) => x.id === id);
      if (line && line.visible !== false) {
        this.drawHandleDot(ctx, line.p1.x, line.p1.y, r, '#38bdf8', line.locked, zoom);
        this.drawHandleDot(ctx, line.p2.x, line.p2.y, r, '#38bdf8', line.locked, zoom);
        continue;
      }

      const ang = state.angles.find((x) => x.id === id);
      if (ang && ang.visible !== false) {
        this.drawHandleDot(ctx, ang.p1.x, ang.p1.y, r, '#10b981', ang.locked, zoom);
        this.drawHandleDot(ctx, ang.vertex.x, ang.vertex.y, r * 1.15, '#ffffff', ang.locked, zoom);
        this.drawHandleDot(ctx, ang.p2.x, ang.p2.y, r, '#10b981', ang.locked, zoom);
        continue;
      }

      const shape = state.shapes.find((x) => x.id === id);
      if (shape && shape.visible !== false) {
        if (shape.perspectiveEnabled) {
          const quad = getShapePerspectiveQuad(shape);
          ctx.save();
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1.2 / zoom;
          ctx.setLineDash(resolveDashPatternWorld([4, 4], zoom));
          ctx.beginPath();
          ctx.moveTo(quad[0].x, quad[0].y);
          for (let i = 1; i < 4; i++) ctx.lineTo(quad[i].x, quad[i].y);
          ctx.closePath();
          ctx.stroke();
          ctx.restore();
          for (const c of quad) {
            this.drawHandleDot(ctx, c.x, c.y, r * 1.15, '#38bdf8', shape.locked, zoom);
          }
        } else {
          const corners = getAffineBoxCorners(shape);
          ctx.save();
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1.2 / zoom;
          ctx.setLineDash(resolveDashPatternWorld([4, 3], zoom));
          ctx.beginPath();
          ctx.moveTo(corners[0].x, corners[0].y);
          for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
          ctx.closePath();
          ctx.stroke();
          ctx.setLineDash([]);

          const topMid = {
            x: (corners[0].x + corners[1].x) * 0.5,
            y: (corners[0].y + corners[1].y) * 0.5,
          };
          const rotRad = ((shape.rotation || 0) * Math.PI) / 180;
          const stemLen = 22 / zoom;
          const rotHandle = {
            x: topMid.x + Math.sin(rotRad) * stemLen,
            y: topMid.y - Math.cos(rotRad) * stemLen,
          };
          ctx.beginPath();
          ctx.moveTo(topMid.x, topMid.y);
          ctx.lineTo(rotHandle.x, rotHandle.y);
          ctx.stroke();
          ctx.restore();

          this.drawHandleDot(ctx, rotHandle.x, rotHandle.y, r, '#818cf8', shape.locked, zoom);
          for (const c of corners) {
            this.drawHandleSquare(ctx, c.x, c.y, r, '#38bdf8', shape.locked, zoom);
          }

          if ((shape.type === 'customPolygon' || shape.type === 'freehand') && shape.editVertices) {
            const verts = getShapeWorldVertices(shape);
            for (const v of verts) {
              this.drawHandleDot(ctx, v.x, v.y, r * 0.9, '#f59e0b', shape.locked, zoom);
            }
          }
        }
      }
    }
  }

  drawHandleDot(ctx, x, y, r, color, locked, zoom) {
    ctx.save();
    ctx.fillStyle = locked ? '#64748b' : '#ffffff';
    ctx.strokeStyle = locked ? '#94a3b8' : color;
    ctx.lineWidth = 1.8 / zoom;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawHandleSquare(ctx, x, y, r, color, locked, zoom) {
    ctx.save();
    ctx.fillStyle = locked ? '#64748b' : '#ffffff';
    ctx.strokeStyle = locked ? '#94a3b8' : color;
    ctx.lineWidth = 1.6 / zoom;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.strokeRect(x - r, y - r, r * 2, r * 2);
    ctx.restore();
  }

  drawWorldLabel(ctx, x, y, text, accentColor, zoom, baseFontSize = 11, rc = null) {
    ctx.save();
    const screenFontPx = resolveLabelFontPx(baseFontSize, rc);
    const fontSize = screenFontPx / zoom;
    ctx.font = `500 ${fontSize}px "JetBrains Mono", monospace`;
    const metrics = ctx.measureText(text);
    const padX = 5 / zoom;
    const padY = 3 / zoom;
    const boxW = metrics.width + padX * 2;
    const boxH = fontSize + padY * 2;

    ctx.fillStyle = 'rgba(11, 17, 32, 0.88)';
    ctx.strokeStyle = accentColor || '#38bdf8';
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    ctx.roundRect(x - boxW * 0.5, y - boxH * 0.5, boxW, boxH, 3 / zoom);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f1f5f9';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
    ctx.restore();
  }
}
