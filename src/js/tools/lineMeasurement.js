/**
 * Line Measurement Tool Controller
 */
import { distance } from '../geometry/points.js';
import { constrainLineAngle } from '../geometry/lines.js';
import { createMeasurementLine } from '../layers/objectManager.js';

export class LineMeasurementTool {
  constructor(app) {
    this.app = app;
    this.startPt = null;
    this.isDragging = false;
  }

  getSubTools() {
    return [{ id: 'draw', label: '2-Point Line (Hold Shift for 45° snap)' }];
  }

  getHint() {
    return this.startPt
      ? 'Click second point to finish line (Shift snaps to 45°). Press Esc to cancel.'
      : 'Click & drag (or click two points) to create a measurement line.';
  }

  onPointerDown(imgPt, e, state) {
    if (!this.startPt) {
      this.startPt = { ...imgPt };
      this.isDragging = true;
    } else {
      const endPt = e.shiftKey ? constrainLineAngle(this.startPt, imgPt, 45) : imgPt;
      this.finishLine(this.startPt, endPt, state);
    }
  }

  onPointerMove(imgPt, e, state) {
    if (!this.startPt) return null;
    const endPt = e.shiftKey ? constrainLineAngle(this.startPt, imgPt, 45) : imgPt;
    return {
      type: 'line',
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
      const endPt = e.shiftKey ? constrainLineAngle(this.startPt, imgPt, 45) : imgPt;
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
    // Automatically add first lines to ratio comparison convenience if <= 4
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
