/**
 * Angle Measurement Tool Controller
 * Supports 3-Point Angle, Two Intersecting Lines, and From Selected Lines.
 */
import { angleFromTwoLines } from '../geometry/angles.js';
import { distance } from '../geometry/points.js';
import { createAngleObject } from '../layers/objectManager.js';

export class AngleMeasurementTool {
  constructor(app) {
    this.app = app;
    this.points = [];
    // For twoLines mode:
    this.line1 = null;
    this.activeStart = null;
  }

  getSubTools() {
    return [
      { id: 'threePoint', label: '3-Point Angle' },
      { id: 'twoLines', label: '2 Intersecting Lines' },
      { id: 'fromLines', label: 'Angle Between Existing Lines' },
    ];
  }

  getHint(state) {
    const sub = state.subTools.angle;
    if (sub === 'threePoint') {
      if (this.points.length === 0) return 'Step 1/3: Click first ray endpoint.';
      if (this.points.length === 1) return 'Step 2/3: Click angle vertex.';
      return 'Step 3/3: Click second ray endpoint.';
    }
    if (sub === 'twoLines') {
      if (!this.line1 && !this.activeStart) return 'Draw first line (drag or click two points).';
      if (!this.line1 && this.activeStart) return 'Click end of first line.';
      if (this.line1 && !this.activeStart) return 'Draw second intersecting line.';
      return 'Click end of second line to compute intersection angle.';
    }
    return 'Select 2 existing measurement lines in the canvas or sidebar to compute their angle.';
  }

  onPointerDown(imgPt, e, state) {
    const sub = state.subTools.angle;

    if (sub === 'threePoint') {
      this.points.push({ ...imgPt });
      if (this.points.length === 3) {
        this.app.pushUndo('Measure 3-Point Angle');
        const ang = createAngleObject(
          this.points[0],
          this.points[1],
          this.points[2],
          state.angles.length + 1,
          {
            arcColor: state.toolDefaults.angleArcColor,
            arcThickness: state.toolDefaults.angleArcThickness,
            arcRadius: state.toolDefaults.angleArcRadius,
            textSize: state.toolDefaults.angleTextSize,
            precision: state.toolDefaults.anglePrecision,
          }
        );
        state.angles.push(ang);
        state.selectedIds = [ang.id];
        this.points = [];
        this.app.onStateChanged();
      }
      return;
    }

    if (sub === 'twoLines') {
      if (!this.activeStart) {
        this.activeStart = { ...imgPt };
      } else {
        this.completeTwoLineSegment(imgPt, state);
      }
      return;
    }

    if (sub === 'fromLines') {
      // Allow Shift-free toggling of lines directly when in fromLines mode
      const tol = this.app.coords.screenDistToImageDist(10);
      const hit = this.app.selection.hitTestObjectBody(state, imgPt, tol);
      if (hit && hit.category === 'line') {
        const idx = state.selectedIds.indexOf(hit.id);
        if (idx >= 0) {
          state.selectedIds.splice(idx, 1);
        } else {
          const lineIds = state.selectedIds.filter((id) => state.lines.some((l) => l.id === id));
          if (lineIds.length >= 2) {
            state.selectedIds = [lineIds[1], hit.id];
          } else {
            state.selectedIds.push(hit.id);
          }
        }
        this.app.onStateChanged({ skipAutosave: true });
      }
    }
    void e;
  }

  onPointerMove(imgPt, e, state) {
    const sub = state.subTools.angle;
    if (sub === 'threePoint' && this.points.length > 0) {
      return { type: 'angle', points: this.points, cursor: imgPt };
    }
    if (sub === 'twoLines' && (this.line1 || this.activeStart)) {
      return {
        type: 'twoLinesAngle',
        line1: this.line1,
        activeStart: this.activeStart,
        cursor: imgPt,
      };
    }
    void e;
    void state;
    return null;
  }

  onPointerUp(imgPt, e, state) {
    if (state.subTools.angle === 'twoLines' && this.activeStart) {
      if (distance(this.activeStart, imgPt) > 12) {
        this.completeTwoLineSegment(imgPt, state);
      }
    }
    void e;
  }

  completeTwoLineSegment(endPt, state) {
    if (distance(this.activeStart, endPt) < 4) return;
    if (!this.line1) {
      this.line1 = { p1: { ...this.activeStart }, p2: { ...endPt } };
      this.activeStart = null;
      this.app.renderCanvas({ type: 'twoLinesAngle', line1: this.line1 });
      this.app.ui.updateHintBanner();
      return;
    }

    const line2 = { p1: { ...this.activeStart }, p2: { ...endPt } };
    const res = angleFromTwoLines(this.line1.p1, this.line1.p2, line2.p1, line2.p2);
    this.line1 = null;
    this.activeStart = null;

    if (!res) {
      this.app.notify('Lines are parallel and do not intersect.', 'error');
      this.app.renderCanvas();
      return;
    }

    this.app.pushUndo('Measure Intersecting Lines Angle');
    const ang = createAngleObject(res.p1, res.vertex, res.p2, state.angles.length + 1, {
      arcColor: state.toolDefaults.angleArcColor,
      arcThickness: state.toolDefaults.angleArcThickness,
      arcRadius: state.toolDefaults.angleArcRadius,
      textSize: state.toolDefaults.angleTextSize,
      precision: state.toolDefaults.anglePrecision,
    });
    state.angles.push(ang);
    state.selectedIds = [ang.id];
    this.app.onStateChanged();
  }

  createAngleFromSelectedLines(state) {
    const selectedLines = state.lines.filter((l) => state.selectedIds.includes(l.id));
    if (selectedLines.length !== 2) {
      this.app.notify('Select exactly 2 measurement lines to compute their angle.', 'error');
      return;
    }
    const [l1, l2] = selectedLines;
    const res = angleFromTwoLines(l1.p1, l1.p2, l2.p1, l2.p2);
    if (!res) {
      this.app.notify('The two selected lines are parallel and do not intersect.', 'error');
      return;
    }
    this.app.pushUndo('Angle Between Lines');
    const ang = createAngleObject(res.p1, res.vertex, res.p2, state.angles.length + 1, {
      name: `Angle (${l1.name} × ${l2.name})`,
      arcColor: state.toolDefaults.angleArcColor,
      arcThickness: state.toolDefaults.angleArcThickness,
      arcRadius: state.toolDefaults.angleArcRadius,
      textSize: state.toolDefaults.angleTextSize,
      precision: state.toolDefaults.anglePrecision,
    });
    state.angles.push(ang);
    state.selectedIds = [ang.id];
    this.app.onStateChanged();
  }

  cancel() {
    this.points = [];
    this.line1 = null;
    this.activeStart = null;
  }
}
