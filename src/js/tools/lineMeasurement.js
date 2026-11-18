/**
 * Line Measurement Tool Controller (with Construction Snapping & 45° Shift Constraint)
 */
import { distance } from '../geometry/points.js';
import { constrainLineAngle } from '../geometry/lines.js';
import { createMeasurementLine } from '../layers/objectManager.js';
import { resolveSnap } from '../core/snapEngine.js';

export class LineMeasurementTool {
  constructor(app) {
    this.app = app;
    this.startPt = null;
    this.isDragging = false;
  }

  getSubTools() {
    return [{ id: 'draw', label: '2-Point Line (Shift: 45° snap · Alt: Bypass snap)' }];
  }

  getHint() {
    return this.startPt
      ? 'Click second point to finish line (Shift: 45° snap, Alt: disable snap, Esc: cancel).'
      : 'Click & drag (or click two points) to create a measurement line.';
  }

  onPointerDown(imgPt, e, state) {
    const snapped = resolveSnap(imgPt, state, this.app.coords, {
      bypass: e.altKey,
      anchorPt: this.startPt,
    });
    if (!this.startPt) {
      this.startPt = { x: snapped.x, y: snapped.y };
      this.isDragging = true;
    } else {
      const endPt = e.shiftKey ? constrainLineAngle(this.startPt, snapped, 45) : snapped;
      this.finishLine(this.startPt, endPt, state);
    }
  }

  onPointerMove(imgPt, e, state) {
    const snapped = resolveSnap(imgPt, state, this.app.coords, {
      bypass: e.altKey,
      anchorPt: this.startPt,
    });
    if (!this.startPt) {
      return snapped.snapped ? { type: 'snapOnly', snap: snapped } : null;
    }
    const endPt = e.shiftKey ? constrainLineAngle(this.startPt, snapped, 45) : snapped;
    return {
      type: 'line',
      snap: snapped,
      line: {
        name: `Line ${state.lines.length + 1}`,
        p1: this.startPt,
        p2: endPt,
        color: state.toolDefaults.lineColor,
        thickness: state.toolDefaults.lineThickness,
        opacity: state.toolDefaults.lineOpacity,
      },
    };
  }

  onPointerUp(imgPt, e, state) {
    if (this.startPt && this.isDragging) {
      this.isDragging = false;
      const snapped = resolveSnap(imgPt, state, this.app.coords, {
        bypass: e.altKey,
        anchorPt: this.startPt,
      });
      const endPt = e.shiftKey ? constrainLineAngle(this.startPt, snapped, 45) : snapped;
      if (distance(this.startPt, endPt) > 10) {
        this.finishLine(this.startPt, endPt, state);
      }
    }
  }

  finishLine(p1, p2, state) {
    if (distance(p1, p2) < 2) return;
    this.app.pushUndo('Draw Measurement Line');
    const line = createMeasurementLine(p1, p2, state.lines.length + 1, {
      color: state.toolDefaults.lineColor,
      thickness: state.toolDefaults.lineThickness,
      opacity: state.toolDefaults.lineOpacity,
    });
    state.lines.push(line);
    state.selectedIds = [line.id];
    if (state.ratioCompareIds.length < 4) {
      state.ratioCompareIds.push(line.id);
    }
    this.startPt = null;
    this.isDragging = false;
    this.app.onStateChanged();
  }

  cancel() {
    this.startPt = null;
    this.isDragging = false;
  }
}
