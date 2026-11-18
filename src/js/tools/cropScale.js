/**
 * Crop & Scale Calibration Tool Controller
 */
import { distance } from '../geometry/points.js';
import { getTargetAspectRatio, enforceCropBoundsAndAspect, createDefaultCrop } from '../image/cropManager.js';

export class CropScaleTool {
  constructor(app) {
    this.app = app;
    this.dragAction = null;
    this.scaleStartPt = null;
  }

  getSubTools() {
    return [
      { id: 'crop', label: 'Crop & Orientation' },
      { id: 'scale', label: 'Calibrate Scale' },
    ];
  }

  getHint(state) {
    if (state.subTools.cropScale === 'crop') {
      return 'Drag crop handles to frame region, then click Apply Crop in the sidebar.';
    }
    return 'Click & drag (or click two points) across a known reference length to calibrate scale.';
  }

  onPointerDown(imgPt, e, state, tolerancePx) {
    const sub = state.subTools.cropScale;
    if (sub === 'crop') {
      const c = state.crop;
      const handles = [
        { id: 'tl', x: c.draftX, y: c.draftY },
        { id: 'tm', x: c.draftX + c.draftWidth * 0.5, y: c.draftY },
        { id: 'tr', x: c.draftX + c.draftWidth, y: c.draftY },
        { id: 'mr', x: c.draftX + c.draftWidth, y: c.draftY + c.draftHeight * 0.5 },
        { id: 'br', x: c.draftX + c.draftWidth, y: c.draftY + c.draftHeight },
        { id: 'bm', x: c.draftX + c.draftWidth * 0.5, y: c.draftY + c.draftHeight },
        { id: 'bl', x: c.draftX, y: c.draftY + c.draftHeight },
        { id: 'ml', x: c.draftX, y: c.draftY + c.draftHeight * 0.5 },
      ];
      for (const h of handles) {
        if (distance(imgPt, h) <= tolerancePx * 1.4) {
          this.dragAction = {
            type: 'handle',
            handle: h.id,
            startPt: { ...imgPt },
            startRect: { x: c.draftX, y: c.draftY, width: c.draftWidth, height: c.draftHeight },
          };
          return;
        }
      }

      if (
        imgPt.x >= c.draftX &&
        imgPt.x <= c.draftX + c.draftWidth &&
        imgPt.y >= c.draftY &&
        imgPt.y <= c.draftY + c.draftHeight
      ) {
        this.dragAction = {
          type: 'move',
          startPt: { ...imgPt },
          startRect: { x: c.draftX, y: c.draftY, width: c.draftWidth, height: c.draftHeight },
        };
      } else {
        this.dragAction = {
          type: 'draw',
          startPt: { ...imgPt },
        };
      }
      return;
    }

    // Scale Calibration mode
    const cal = state.calibration;
    if (cal.p1 && distance(imgPt, cal.p1) <= tolerancePx * 1.3) {
      this.app.history.beginBatch(state, 'Adjust Scale Point');
      this.dragAction = { type: 'calP1' };
      return;
    }
    if (cal.p2 && distance(imgPt, cal.p2) <= tolerancePx * 1.3) {
      this.app.history.beginBatch(state, 'Adjust Scale Point');
      this.dragAction = { type: 'calP2' };
      return;
    }

    if (!this.scaleStartPt) {
      this.scaleStartPt = { ...imgPt };
    } else {
      const dist = distance(this.scaleStartPt, imgPt);
      if (dist >= 2) {
        this.app.pushUndo('Set Scale Reference Points');
        cal.p1 = { ...this.scaleStartPt };
        cal.p2 = { ...imgPt };
        cal.pixelDistance = dist;
        this.scaleStartPt = null;
        this.app.onStateChanged();
      }
    }
    void e;
  }

  onPointerMove(imgPt, e, state) {
    const sub = state.subTools.cropScale;
    const maxW = state.image.width;
    const maxH = state.image.height;

    if (sub === 'crop' && this.dragAction) {
      const c = state.crop;
      const ratio = getTargetAspectRatio(c);
      const act = this.dragAction;

      if (act.type === 'move') {
        const dx = imgPt.x - act.startPt.x;
        const dy = imgPt.y - act.startPt.y;
        c.draftX = Math.max(0, Math.min(maxW - act.startRect.width, act.startRect.x + dx));
        c.draftY = Math.max(0, Math.min(maxH - act.startRect.height, act.startRect.y + dy));
      } else if (act.type === 'draw') {
        let x1 = Math.max(0, Math.min(maxW, act.startPt.x));
        let y1 = Math.max(0, Math.min(maxH, act.startPt.y));
        let x2 = Math.max(0, Math.min(maxW, imgPt.x));
        let y2 = Math.max(0, Math.min(maxH, imgPt.y));
        let w = Math.max(20, Math.abs(x2 - x1));
        let h = Math.max(20, Math.abs(y2 - y1));
        if (ratio) h = w / ratio;
        const rx = x2 >= x1 ? x1 : Math.max(0, x1 - w);
        const ry = y2 >= y1 ? y1 : Math.max(0, y1 - h);
        const clamped = enforceCropBoundsAndAspect({ x: rx, y: ry, width: w, height: h }, maxW, maxH, ratio, 'tl');
        c.draftX = clamped.x;
        c.draftY = clamped.y;
        c.draftWidth = clamped.width;
        c.draftHeight = clamped.height;
      } else if (act.type === 'handle') {
        const sr = act.startRect;
        let left = sr.x;
        let top = sr.y;
        let right = sr.x + sr.width;
        let bottom = sr.y + sr.height;

        const cx = Math.max(0, Math.min(maxW, imgPt.x));
        const cy = Math.max(0, Math.min(maxH, imgPt.y));

        if (act.handle.includes('l')) left = Math.min(right - 20, cx);
        if (act.handle.includes('r')) right = Math.max(left + 20, cx);
        if (act.handle.includes('t')) top = Math.min(bottom - 20, cy);
        if (act.handle.includes('b')) bottom = Math.max(top + 20, cy);

        let w = right - left;
        let h = bottom - top;
        if (ratio) {
          if (act.handle === 'tm' || act.handle === 'bm') w = h * ratio;
          else h = w / ratio;
          if (left + w > maxW) {
            w = maxW - left;
            h = w / ratio;
          }
          if (top + h > maxH) {
            h = maxH - top;
            w = h * ratio;
          }
        }
        c.draftX = Math.max(0, left);
        c.draftY = Math.max(0, top);
        c.draftWidth = Math.max(20, Math.min(maxW - c.draftX, w));
        c.draftHeight = Math.max(20, Math.min(maxH - c.draftY, h));
      }
      this.app.renderCanvas();
      this.app.ui.refreshInspectorLive();
      return null;
    }

    if (sub === 'scale') {
      if (this.dragAction?.type === 'calP1') {
        state.calibration.p1 = { ...imgPt };
        state.calibration.pixelDistance = distance(state.calibration.p1, state.calibration.p2);
        this.app.renderCanvas();
        this.app.ui.refreshInspectorLive();
        return null;
      }
      if (this.dragAction?.type === 'calP2') {
        state.calibration.p2 = { ...imgPt };
        state.calibration.pixelDistance = distance(state.calibration.p1, state.calibration.p2);
        this.app.renderCanvas();
        this.app.ui.refreshInspectorLive();
        return null;
      }
      if (this.scaleStartPt) {
        return { type: 'scalePoint', p1: this.scaleStartPt, cursor: imgPt };
      }
    }
    void e;
    return null;
  }

  onPointerUp(imgPt, e, state) {
    if (this.dragAction && state.subTools.cropScale === 'scale') {
      this.app.history.commitBatch(state);
      this.app.onStateChanged();
    } else if (this.dragAction && state.subTools.cropScale === 'crop') {
      this.app.ui.refreshInspectorLive();
    } else if (state.subTools.cropScale === 'scale' && this.scaleStartPt) {
      const dist = distance(this.scaleStartPt, imgPt);
      if (dist > 12) {
        this.app.pushUndo('Set Scale Reference Points');
        state.calibration.p1 = { ...this.scaleStartPt };
        state.calibration.p2 = { ...imgPt };
        state.calibration.pixelDistance = dist;
        this.scaleStartPt = null;
        this.app.onStateChanged();
      }
    }
    this.dragAction = null;
    void e;
  }

  cancel() {
    this.dragAction = null;
    this.scaleStartPt = null;
    this.app.history.cancelBatch();
  }

  applyCrop(state) {
    this.app.pushUndo('Apply Crop');
    state.crop.x = state.crop.draftX;
    state.crop.y = state.crop.draftY;
    state.crop.width = state.crop.draftWidth;
    state.crop.height = state.crop.draftHeight;
    state.crop.applied = true;
    this.app.fitToScreen();
    this.app.onStateChanged();
  }

  cancelCrop(state) {
    state.crop.draftX = state.crop.x;
    state.crop.draftY = state.crop.y;
    state.crop.draftWidth = state.crop.width;
    state.crop.draftHeight = state.crop.height;
    this.app.setActiveTool('select');
  }

  resetCrop(state) {
    this.app.pushUndo('Reset Crop');
    const def = createDefaultCrop(state.image.width, state.image.height);
    state.crop = { ...def };
    this.app.fitToScreen();
    this.app.onStateChanged();
  }
}
