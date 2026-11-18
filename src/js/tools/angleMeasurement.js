/**
 * Angle Measurement Tool Controller (with Construction Snapping)
 */
import { angleFromTwoLines } from '../geometry/angles.js';
import { distance } from '../geometry/points.js';
import { createAngleObject } from '../layers/objectManager.js';
import { resolveSnap } from '../core/snapEngine.js';

export class AngleMeasurementTool {
  constructor(app) {
    this.app = app;
    this.points = [];
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
      if (this.points.length === 0) return 'Step 1/3: Click first ray endpoint (snaps to endpoints/grid).';
      if (this.points.length === 1) return 'Step 2/3: Click angle vertex.';
      return 'Step 3/3: Click second ray endpoint.';
    }
    if (sub === 'twoLines') {
      if (!this.line1 && !this.activeStart) return 'Draw first line (drag or click two points).';
      if (!this.line1 && this.activeStart) return 'Click end of first line.';
      if (this.line1 && !this.activeStart) return 'Draw second intersecting line.';
      return 'Click end of second line to compute intersection angle.';
    }
    return 'Click 2 existing measurement lines to compute their intersection angle.';
  }

  onPointerDown(imgPt, e, state) {
    const sub = state.subTools.angle;
    const snapped = resolveSnap(imgPt, state, this.app.coords, {
      bypass: e.altKey,
      anchorPt: this.points.length ? this.points[this.points.length - 1] : this.activeStart,
    });

    if (sub === 'threePoint') {
      this.points.push({ x: snapped.x, y: snapped.y });
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
      } else {
        this.app.ui.updateHintBanner();
      }
      return;
    }

    if (sub === 'twoLines') {
      if (!this.activeStart) {
        this.activeStart = { x: snapped.x, y: snapped.y };
      } else {
        this.completeTwoLineSegment(snapped, state);
      }
      return;
    }

    if (sub === 'fromLines') {
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
  }

  onPointerMove(imgPt, e, state) {
    const sub = state.subTools.angle;
    if (sub === 'fromLines') return null;

    const snapped = resolveSnap(imgPt, state, this.app.coords, {
      bypass: e.altKey,
      anchorPt: this.points.length ? this.points[this.points.length - 1] : this.activeStart,
    });

    if (sub === 'threePoint' && this.points.length > 0) {
      return { type: 'angle', points: this.points, cursor: snapped, snap: snapped };
    }
    if (sub === 'twoLines' && (this.line1 || this.activeStart)) {
      return {
        type: 'twoLinesAngle',
        line1: this.line1,
        activeStart: this.activeStart,
        cursor: snapped,
        snap: snapped,
      };
    }
    return snapped.snapped ? { type: 'snapOnly', snap: snapped } : null;
  }

  onPointerUp(imgPt, e, state) {
    if (state.subTools.angle === 'twoLines' && this.activeStart) {
      const snapped = resolveSnap(imgPt, state, this.app.coords, {
        bypass: e.altKey,
        anchorPt: this.activeStart,
      });
      if (distance(this.activeStart, snapped) > 12) {
        this.completeTwoLineSegment(snapped, state);
      }
    }
  }

  completeTwoLineSegment(endPt, state) {
    if (distance(this.activeStart, endPt) < 4) return;
    if (!this.line1) {
      this.line1 = { p1: { ...this.activeStart }, p2: { x: endPt.x, y: endPt.y } };
      this.activeStart = null;
      this.app.renderCanvas({ type: 'twoLinesAngle', line1: this.line1 });
      this.app.ui.updateHintBanner();
      return;
    }

    const line2 = { p1: { ...this.activeStart }, p2: { x: endPt.x, y: endPt.y } };
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
