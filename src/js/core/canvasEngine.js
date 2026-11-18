/**
 * Canvas Rendering Engine: Renders image, non-destructive crop, visual guides,
 * lines, shapes (including projective homography perspective), angles, and selection handles.
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
} from '../geometry/transformations.js';
import { formatLength } from '../geometry/measurements.js';
import { distance } from '../geometry/points.js';

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

    // Determine active image bounds (crop if applied and not currently editing crop)
    const isEditingCrop = state.activeTool === 'cropScale' && state.subTools.cropScale === 'crop';
    const hasAppliedCrop = state.crop.applied && !isEditingCrop;

    const bounds = hasAppliedCrop
      ? { x: state.crop.x, y: state.crop.y, width: state.crop.width, height: state.crop.height }
      : { x: 0, y: 0, width: imgW, height: imgH };

    // Subtle canvas frame backdrop
    ctx.fillStyle = '#090b0e';
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);

    // Clip to applied crop if active
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

    // Image border frame
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1 / this.coords.zoom;
    ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);

    // Visual Guides (rendered over image within active bounds)
    this.renderVisualGuides(ctx, state, bounds, this.coords.zoom);

    // Shapes
    for (const shape of state.shapes) {
      if (shape.visible === false) continue;
      const isSelected = state.selectedIds.includes(shape.id);
      this.renderShape(ctx, shape, isSelected, this.coords.zoom);
    }

    // Measurement Lines
    for (const line of state.lines) {
      if (line.visible === false) continue;
      const isSelected = state.selectedIds.includes(line.id);
      this.renderLine(ctx, line, state.calibration, isSelected, this.coords.zoom);
    }

    // Angle Measurements
    for (const ang of state.angles) {
      if (ang.visible === false) continue;
      const isSelected = state.selectedIds.includes(ang.id);
      this.renderAngle(ctx, ang, isSelected, this.coords.zoom);
    }

    // Scale Calibration Reference Line (when in scale tool or calibrated & selected)
    if (
      state.activeTool === 'cropScale' &&
      state.subTools.cropScale === 'scale' &&
      state.calibration.p1 &&
      state.calibration.p2
    ) {
      this.renderScaleReference(ctx, state.calibration, this.coords.zoom);
    }

    // Crop Overlay when editing crop
    if (isEditingCrop) {
      this.renderCropOverlay(ctx, state, imgW, imgH, this.coords.zoom);
    }

    // Live Tool Preview (rubber-band line, shape, angle, custom polygon)
    if (toolPreview) {
      this.renderToolPreview(ctx, toolPreview, state, this.coords.zoom);
    }

    // Selection Handles & Gizmos
    this.renderSelectionGizmos(ctx, state, this.coords.zoom);

    ctx.restore();
    ctx.restore();
  }

  /**
   * Render full-resolution annotated PNG onto an offscreen canvas (without selection handles).
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
    this.renderVisualGuides(ctx, state, bounds, 1);

    for (const shape of state.shapes) {
      if (shape.visible !== false) this.renderShape(ctx, shape, false, 1);
    }
    for (const line of state.lines) {
      if (line.visible !== false) this.renderLine(ctx, line, state.calibration, false, 1);
    }
    for (const ang of state.angles) {
      if (ang.visible !== false) this.renderAngle(ctx, ang, false, 1);
    }

    ctx.restore();
    return off;
  }

  applyLineStyle(ctx, style, thickness, zoom) {
    const lw = Math.max(0.5, thickness) / zoom;
    ctx.lineWidth = lw;
    if (style === 'dashed') {
      ctx.setLineDash([8 / zoom, 6 / zoom]);
    } else if (style === 'dotted') {
      ctx.setLineDash([2 / zoom, 5 / zoom]);
    } else {
      ctx.setLineDash([]);
    }
  }

  renderVisualGuides(ctx, state, bounds, zoom) {
    const g = state.guides;
    const { x, y, width, height } = bounds;

    ctx.save();

    // 1. Grid
    if (g.grid.visible) {
      ctx.save();
      ctx.strokeStyle = g.grid.color || '#60a5fa';
      ctx.globalAlpha = g.grid.opacity ?? 0.45;
      this.applyLineStyle(ctx, g.grid.style, g.grid.thickness || 1, zoom);

      ctx.beginPath();
      if (g.grid.mode === 'cellSize') {
        const cw = Math.max(4, Number(g.grid.cellWidth) || 100);
        const ch = Math.max(4, Number(g.grid.cellHeight) || 100);
        for (let gx = x + cw; gx < x + width - 0.5; gx += cw) {
          ctx.moveTo(gx, y);
          ctx.lineTo(gx, y + height);
        }
        for (let gy = y + ch; gy < y + height - 0.5; gy += ch) {
          ctx.moveTo(x, gy);
          ctx.lineTo(x + width, gy);
        }
      } else {
        const cols = Math.max(1, Math.min(100, Number(g.grid.columns) || 4));
        const rows = Math.max(1, Math.min(100, Number(g.grid.rows) || 4));
        for (let c = 1; c < cols; c++) {
          const gx = x + (width * c) / cols;
          ctx.moveTo(gx, y);
          ctx.lineTo(gx, y + height);
        }
        for (let r = 1; r < rows; r++) {
          const gy = y + (height * r) / rows;
          ctx.moveTo(x, gy);
          ctx.lineTo(x + width, gy);
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    // 2. Structural Composition Guides
    ctx.save();
    ctx.strokeStyle = g.guideColor || '#f59e0b';
    ctx.globalAlpha = g.guideOpacity ?? 0.65;
    ctx.lineWidth = (g.guideThickness || 1) / zoom;

    if (g.hCenter) {
      ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.beginPath();
      ctx.moveTo(x, y + height * 0.5);
      ctx.lineTo(x + width, y + height * 0.5);
      ctx.stroke();
    }

    if (g.vCenter) {
      ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.beginPath();
      ctx.moveTo(x + width * 0.5, y);
      ctx.lineTo(x + width * 0.5, y + height);
      ctx.stroke();
    }

    if (g.diagonals) {
      ctx.setLineDash([5 / zoom, 5 / zoom]);
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
      ctx.setLineDash([4 / zoom, 3 / zoom]);
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
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([10 / zoom, 5 / zoom, 2 / zoom, 5 / zoom]);
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
        const isSelected = state.selectedIds.includes(cl.id);
        ctx.save();
        ctx.strokeStyle = isSelected ? '#ffffff' : cl.color || '#a78bfa';
        ctx.globalAlpha = cl.opacity ?? 0.75;
        this.applyLineStyle(ctx, cl.style || 'dashed', (cl.thickness || 1) + (isSelected ? 1 : 0), zoom);
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

  renderLine(ctx, line, calibration, isSelected, zoom) {
    const metrics = computeLineMetrics(line.p1, line.p2);
    ctx.save();
    ctx.globalAlpha = line.opacity ?? 1;
    ctx.strokeStyle = line.color || '#38bdf8';
    ctx.lineWidth = ((line.thickness || 2) + (isSelected ? 1.2 : 0)) / zoom;
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

    // Crisp screen-scaled label pill at midpoint
    const labelText = `${line.name}: ${formatLength(
      metrics.lengthPx,
      calibration.displayUnit,
      calibration,
      calibration.precision
    )}`;
    this.drawWorldLabel(ctx, metrics.midpoint.x, metrics.midpoint.y - 10 / zoom, labelText, line.color, zoom);
    ctx.restore();
  }

  renderShape(ctx, shape, isSelected, zoom) {
    const verts = getShapeWorldVertices(shape);
    if (verts.length < 2) return;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i].x, verts[i].y);
    }
    ctx.closePath();

    // Fill
    if ((shape.fillOpacity ?? 0) > 0) {
      ctx.save();
      ctx.globalAlpha = shape.fillOpacity;
      ctx.fillStyle = shape.fillColor || '#f59e0b';
      ctx.fill();
      ctx.restore();
    }

    // Stroke
    ctx.strokeStyle = shape.borderColor || '#f59e0b';
    ctx.lineWidth = ((shape.borderThickness || 2) + (isSelected ? 1 : 0)) / zoom;
    ctx.stroke();

    // Optional perspective / affine internal construction sub-grid (2x2 center lines + diagonals)
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
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash([4 / zoom, 4 / zoom]);

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

    ctx.restore();
  }

  renderAngle(ctx, ang, isSelected, zoom) {
    const m = computeAngleMetrics(ang.p1, ang.vertex, ang.p2);
    const color = ang.arcColor || '#10b981';
    const lw = ((ang.arcThickness || 2) + (isSelected ? 1 : 0)) / zoom;
    const maxRay = Math.min(m.ray1LengthPx, m.ray2LengthPx);
    const arcR = Math.max(10 / zoom, Math.min(maxRay * 0.85, (ang.arcRadius || 42) / Math.min(zoom, 1.5)));

    ctx.save();
    // Rays
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

    // Optional Reflex Arc
    if (ang.showReflex) {
      ctx.save();
      ctx.setLineDash([4 / zoom, 4 / zoom]);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(ang.vertex.x, ang.vertex.y, arcR * 0.72, m.startAngle, m.endAngle, !m.anticlockwise);
      ctx.stroke();
      ctx.restore();
    }

    // Angle Label
    const prec = ang.precision ?? 1;
    let label = `${m.interiorDeg.toFixed(prec)}°`;
    if (ang.showReflex) label += ` (R: ${m.reflexDeg.toFixed(prec)}°)`;
    else if (ang.showExterior) label += ` (E: ${m.exteriorDeg.toFixed(prec)}°)`;

    let labelMult = 1.45;
    if (ang.labelPosition === 'inside') labelMult = 0.65;
    else if (ang.labelPosition === 'outside') labelMult = 1.8;

    const lx = ang.vertex.x + Math.cos(m.bisectorRad) * (arcR * labelMult);
    const ly = ang.vertex.y + Math.sin(m.bisectorRad) * (arcR * labelMult);
    this.drawWorldLabel(ctx, lx, ly, label, color, zoom, ang.textSize || 12);

    ctx.restore();
  }

  renderScaleReference(ctx, cal, zoom) {
    const distPx = distance(cal.p1, cal.p2);
    ctx.save();
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2.2 / zoom;
    ctx.setLineDash([6 / zoom, 4 / zoom]);
    ctx.beginPath();
    ctx.moveTo(cal.p1.x, cal.p1.y);
    ctx.lineTo(cal.p2.x, cal.p2.y);
    ctx.stroke();
    ctx.setLineDash([]);

    for (const pt of [cal.p1, cal.p2]) {
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 5 / zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0c0e12';
      ctx.lineWidth = 1.5 / zoom;
      ctx.stroke();
    }

    const mx = (cal.p1.x + cal.p2.x) * 0.5;
    const my = (cal.p1.y + cal.p2.y) * 0.5;
    const text = cal.calibrated
      ? `Scale: ${distPx.toFixed(1)} px = ${cal.realValue} ${cal.realUnit}`
      : `Ref: ${distPx.toFixed(1)} px`;
    this.drawWorldLabel(ctx, mx, my - 12 / zoom, text, '#10b981', zoom);
    ctx.restore();
  }

  renderCropOverlay(ctx, state, imgW, imgH, zoom) {
    const c = state.crop;
    const rx = c.draftX;
    const ry = c.draftY;
    const rw = c.draftWidth;
    const rh = c.draftHeight;

    ctx.save();
    // Dim outside crop rectangle
    ctx.fillStyle = 'rgba(0, 0, 0, 0.58)';
    ctx.beginPath();
    ctx.rect(0, 0, imgW, imgH);
    ctx.rect(rx, ry, rw, rh);
    ctx.fill('evenodd');

    // Crop border
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.8 / zoom;
    ctx.strokeRect(rx, ry, rw, rh);

    // Rule of thirds inside crop box
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    for (const f of [1 / 3, 2 / 3]) {
      ctx.moveTo(rx + rw * f, ry);
      ctx.lineTo(rx + rw * f, ry + rh);
      ctx.moveTo(rx, ry + rh * f);
      ctx.lineTo(rx + rw, ry + rh * f);
    }
    ctx.stroke();

    // 8 Handles
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
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5 / zoom;
    for (const h of handles) {
      ctx.fillRect(h.x - hs, h.y - hs, hs * 2, hs * 2);
      ctx.strokeRect(h.x - hs, h.y - hs, hs * 2, hs * 2);
    }
    ctx.restore();
  }

  renderToolPreview(ctx, preview, state, zoom) {
    ctx.save();
    if (preview.type === 'line') {
      this.renderLine(ctx, preview.line, state.calibration, true, zoom);
    } else if (preview.type === 'shape') {
      this.renderShape(ctx, preview.shape, true, zoom);
    } else if (preview.type === 'customPolygon') {
      const pts = preview.points;
      if (pts.length >= 1) {
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2 / zoom;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        if (preview.cursor) ctx.lineTo(preview.cursor.x, preview.cursor.y);
        ctx.stroke();

        for (let i = 0; i < pts.length; i++) {
          ctx.fillStyle = i === 0 ? '#10b981' : '#f59e0b';
          ctx.beginPath();
          ctx.arc(pts[i].x, pts[i].y, 4.5 / zoom, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (preview.type === 'freehand') {
      const pts = preview.points;
      if (pts.length >= 2) {
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2 / zoom;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
    } else if (preview.type === 'angle') {
      const pts = preview.points;
      if (pts.length === 1 && preview.cursor) {
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2 / zoom;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(preview.cursor.x, preview.cursor.y);
        ctx.stroke();
      } else if (pts.length === 2 && preview.cursor) {
        this.renderAngle(
          ctx,
          {
            p1: pts[0],
            vertex: pts[1],
            p2: preview.cursor,
            arcColor: '#10b981',
            arcThickness: 2,
            arcRadius: 42,
            precision: 1,
          },
          true,
          zoom
        );
      }
    } else if (preview.type === 'twoLinesAngle') {
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2 / zoom;
      if (preview.line1) {
        ctx.beginPath();
        ctx.moveTo(preview.line1.p1.x, preview.line1.p1.y);
        ctx.lineTo(preview.line1.p2.x, preview.line1.p2.y);
        ctx.stroke();
      }
      if (preview.activeStart && preview.cursor) {
        ctx.setLineDash([5 / zoom, 4 / zoom]);
        ctx.beginPath();
        ctx.moveTo(preview.activeStart.x, preview.activeStart.y);
        ctx.lineTo(preview.cursor.x, preview.cursor.y);
        ctx.stroke();
      }
    } else if (preview.type === 'scalePoint' && preview.p1 && preview.cursor) {
      this.renderScaleReference(ctx, { p1: preview.p1, p2: preview.cursor, calibrated: false }, zoom);
    }
    ctx.restore();
  }

  renderSelectionGizmos(ctx, state, zoom) {
    const r = 5 / zoom;
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
          ctx.strokeStyle = '#3b82f6';
          ctx.lineWidth = 1.2 / zoom;
          ctx.setLineDash([4 / zoom, 4 / zoom]);
          ctx.beginPath();
          ctx.moveTo(quad[0].x, quad[0].y);
          for (let i = 1; i < 4; i++) ctx.lineTo(quad[i].x, quad[i].y);
          ctx.closePath();
          ctx.stroke();
          ctx.restore();
          for (const c of quad) {
            this.drawHandleDot(ctx, c.x, c.y, r * 1.15, '#3b82f6', shape.locked, zoom);
          }
        } else {
          const corners = getAffineBoxCorners(shape);
          ctx.save();
          ctx.strokeStyle = '#3b82f6';
          ctx.lineWidth = 1.2 / zoom;
          ctx.setLineDash([4 / zoom, 3 / zoom]);
          ctx.beginPath();
          ctx.moveTo(corners[0].x, corners[0].y);
          for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
          ctx.closePath();
          ctx.stroke();
          ctx.setLineDash([]);

          // Rotation stem & handle
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

          this.drawHandleDot(ctx, rotHandle.x, rotHandle.y, r, '#a78bfa', shape.locked, zoom);
          for (const c of corners) {
            this.drawHandleSquare(ctx, c.x, c.y, r, '#3b82f6', shape.locked, zoom);
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

  drawWorldLabel(ctx, x, y, text, accentColor, zoom, baseFontSize = 11.5) {
    ctx.save();
    const fontSize = baseFontSize / zoom;
    ctx.font = `500 ${fontSize}px "JetBrains Mono", monospace`;
    const metrics = ctx.measureText(text);
    const padX = 5 / zoom;
    const padY = 3 / zoom;
    const boxW = metrics.width + padX * 2;
    const boxH = fontSize + padY * 2;

    ctx.fillStyle = 'rgba(14, 17, 23, 0.86)';
    ctx.strokeStyle = accentColor || '#3b82f6';
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
