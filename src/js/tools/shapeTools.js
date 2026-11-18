/**
 * Geometric Shape Tools Controller (with Construction Snapping & Live Dimension Preview)
 */
import { distance } from '../geometry/points.js';
import { simplifyPoints } from '../geometry/polygons.js';
import { createShapeObject } from '../layers/objectManager.js';
import { resolveSnap } from '../core/snapEngine.js';

export class ShapeToolsController {
  constructor(app) {
    this.app = app;
    this.dragStart = null;
    this.polyPoints = [];
    this.freehandPoints = [];
    this.cursorPt = null;
  }

  getSubTools() {
    return [
      { id: 'rectangle', label: 'Rectangle (R)' },
      { id: 'square', label: 'Square' },
      { id: 'circle', label: 'Circle (C)' },
      { id: 'ellipse', label: 'Ellipse (E)' },
      { id: 'triangle', label: 'Triangle' },
      { id: 'polygon', label: 'Polygon (P)' },
      { id: 'customPolygon', label: 'Custom Polygon' },
      { id: 'freehand', label: 'Freehand' },
    ];
  }

  getHint(state) {
    const type = state.subTools.shape;
    if (type === 'customPolygon') {
      return this.polyPoints.length
        ? 'Click to add vertices. Click start point, double-click, or press Enter to close.'
        : 'Click to place the first vertex of your custom polygon.';
    }
    if (type === 'freehand') {
      return 'Press and drag to sketch a freehand closed shape.';
    }
    return 'Click & drag to draw shape (Shift: 1:1 ratio · Alt: bypass snap).';
  }

  onPointerDown(imgPt, e, state, tolerancePx) {
    const type = state.subTools.shape;
    const snapped = resolveSnap(imgPt, state, this.app.coords, {
      bypass: e.altKey,
      anchorPt: this.polyPoints.length ? this.polyPoints[this.polyPoints.length - 1] : null,
    });
    this.cursorPt = { x: snapped.x, y: snapped.y };

    if (type === 'customPolygon') {
      if (this.polyPoints.length >= 3 && distance(snapped, this.polyPoints[0]) <= tolerancePx * 1.4) {
        this.commitCustomPolygon(state);
        return;
      }
      this.polyPoints.push({ x: snapped.x, y: snapped.y });
      this.app.renderCanvas({ type: 'customPolygon', points: this.polyPoints, cursor: snapped, snap: snapped });
      return;
    }

    if (type === 'freehand') {
      this.freehandPoints = [{ ...imgPt }];
      return;
    }

    this.dragStart = { x: snapped.x, y: snapped.y };
  }

  onDoubleClick(state) {
    if (state.subTools.shape === 'customPolygon' && this.polyPoints.length >= 3) {
      this.commitCustomPolygon(state);
    }
  }

  onPointerMove(imgPt, e, state) {
    const type = state.subTools.shape;
    const snapped = resolveSnap(imgPt, state, this.app.coords, {
      bypass: e.altKey || type === 'freehand',
      anchorPt: this.dragStart || (this.polyPoints.length ? this.polyPoints[this.polyPoints.length - 1] : null),
    });
    this.cursorPt = { x: snapped.x, y: snapped.y };

    if (type === 'customPolygon' && this.polyPoints.length > 0) {
      return { type: 'customPolygon', points: this.polyPoints, cursor: snapped, snap: snapped };
    }

    if (type === 'freehand' && this.freehandPoints.length > 0) {
      const last = this.freehandPoints[this.freehandPoints.length - 1];
      if (distance(last, imgPt) >= 3) {
        this.freehandPoints.push({ ...imgPt });
      }
      return { type: 'freehand', points: this.freehandPoints };
    }

    if (this.dragStart) {
      const bounds = this.computeDragBounds(this.dragStart, snapped, type, e.shiftKey);
      const previewShape = createShapeObject(type, bounds, state.shapes.length + 1, {
        sides: state.toolDefaults.polygonSides,
        borderColor: state.toolDefaults.shapeBorderColor,
        fillColor: state.toolDefaults.shapeFillColor,
        fillOpacity: state.toolDefaults.shapeFillOpacity,
        borderThickness: state.toolDefaults.shapeBorderThickness,
      });
      return { type: 'shape', shape: previewShape, snap: snapped };
    }

    return snapped.snapped ? { type: 'snapOnly', snap: snapped } : null;
  }

  onPointerUp(imgPt, e, state) {
    const type = state.subTools.shape;

    if (type === 'freehand' && this.freehandPoints.length >= 3) {
      const simplified = simplifyPoints(this.freehandPoints, 4 / Math.max(0.25, this.app.coords.zoom));
      if (simplified.length >= 3) {
        this.app.pushUndo('Draw Freehand Shape');
        const shape = createShapeObject('freehand', { x: 0, y: 0, width: 10, height: 10 }, state.shapes.length + 1, {
          points: simplified,
          borderColor: state.toolDefaults.shapeBorderColor,
          fillColor: state.toolDefaults.shapeFillColor,
          fillOpacity: state.toolDefaults.shapeFillOpacity,
          borderThickness: state.toolDefaults.shapeBorderThickness,
        });
        state.shapes.push(shape);
        state.selectedIds = [shape.id];
        this.app.onStateChanged();
      }
      this.freehandPoints = [];
      return;
    }

    if (this.dragStart) {
      const snapped = resolveSnap(imgPt, state, this.app.coords, {
        bypass: e.altKey,
        anchorPt: this.dragStart,
      });
      const bounds = this.computeDragBounds(this.dragStart, snapped, type, e.shiftKey);
      if (bounds.width >= 6 && bounds.height >= 6) {
        this.app.pushUndo(`Draw ${type}`);
        const shape = createShapeObject(type, bounds, state.shapes.length + 1, {
          sides: state.toolDefaults.polygonSides,
          borderColor: state.toolDefaults.shapeBorderColor,
          fillColor: state.toolDefaults.shapeFillColor,
          fillOpacity: state.toolDefaults.shapeFillOpacity,
          borderThickness: state.toolDefaults.shapeBorderThickness,
        });
        state.shapes.push(shape);
        state.selectedIds = [shape.id];
        this.app.onStateChanged();
      }
      this.dragStart = null;
    }
  }

  commitCustomPolygon(state) {
    if (this.polyPoints.length < 3) {
      this.polyPoints = [];
      return;
    }
    this.app.pushUndo('Draw Custom Polygon');
    const shape = createShapeObject(
      'customPolygon',
      { x: 0, y: 0, width: 10, height: 10 },
      state.shapes.length + 1,
      {
        points: this.polyPoints.map((p) => ({ ...p })),
        borderColor: state.toolDefaults.shapeBorderColor,
        fillColor: state.toolDefaults.shapeFillColor,
        fillOpacity: state.toolDefaults.shapeFillOpacity,
        borderThickness: state.toolDefaults.shapeBorderThickness,
      }
    );
    state.shapes.push(shape);
    state.selectedIds = [shape.id];
    this.polyPoints = [];
    this.app.onStateChanged();
  }

  computeDragBounds(start, curr, type, shiftKey) {
    let dx = curr.x - start.x;
    let dy = curr.y - start.y;
    const forceSquare = type === 'square' || type === 'circle' || shiftKey;
    if (forceSquare) {
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      dx = dx >= 0 ? size : -size;
      dy = dy >= 0 ? size : -size;
    }
    return {
      x: dx >= 0 ? start.x : start.x + dx,
      y: dy >= 0 ? start.y : start.y + dy,
      width: Math.abs(dx),
      height: Math.abs(dy),
    };
  }

  cancel() {
    this.dragStart = null;
    this.polyPoints = [];
    this.freehandPoints = [];
  }
}
