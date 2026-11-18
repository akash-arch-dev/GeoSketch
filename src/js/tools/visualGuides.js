/**
 * Visual Guides Tool Controller (with Grid Snapping support for Custom Guides)
 */
import { createDefaultGuides } from '../project/projectManager.js';
import { createCustomGuideLine } from '../layers/objectManager.js';
import { resolveSnap } from '../core/snapEngine.js';

export class VisualGuidesTool {
  constructor(app) {
    this.app = app;
    this.dragStart = null;
  }

  getSubTools() {
    return [
      { id: 'grid', label: 'Grid & Presets' },
      { id: 'customH', label: '+ Horizontal Guide' },
      { id: 'customV', label: '+ Vertical Guide' },
      { id: 'customAngled', label: '+ Angled Guide' },
    ];
  }

  getHint(state) {
    const sub = state.subTools.guides;
    if (sub === 'customH') return 'Click anywhere on the image to place a horizontal guide line.';
    if (sub === 'customV') return 'Click anywhere on the image to place a vertical guide line.';
    if (sub === 'customAngled') return 'Drag between two points to place an angled guide line.';
    return '';
  }

  onPointerDown(imgPt, e, state) {
    const sub = state.subTools.guides;
    const snapped = resolveSnap(imgPt, state, this.app.coords, { bypass: e.altKey });

    if (sub === 'customH') {
      this.app.pushUndo('Add Horizontal Guide');
      const count = state.guides.customLines.length + 1;
      const guide = createCustomGuideLine('horizontal', snapped.y, count);
      state.guides.showCustomGuides = true;
      state.guides.customLines.push(guide);
      state.selectedIds = [guide.id];
      this.app.onStateChanged();
    } else if (sub === 'customV') {
      this.app.pushUndo('Add Vertical Guide');
      const count = state.guides.customLines.length + 1;
      const guide = createCustomGuideLine('vertical', snapped.x, count);
      state.guides.showCustomGuides = true;
      state.guides.customLines.push(guide);
      state.selectedIds = [guide.id];
      this.app.onStateChanged();
    } else if (sub === 'customAngled') {
      this.dragStart = { x: snapped.x, y: snapped.y };
    }
  }

  onPointerMove(imgPt, e, state) {
    const snapped = resolveSnap(imgPt, state, this.app.coords, {
      bypass: e.altKey,
      anchorPt: this.dragStart,
    });
    if (this.dragStart) {
      return {
        type: 'line',
        snap: snapped,
        line: {
          name: 'Guide',
          p1: this.dragStart,
          p2: snapped,
          color: '#818cf8',
          thickness: 1.5,
          opacity: 0.85,
        },
      };
    }
    return snapped.snapped ? { type: 'snapOnly', snap: snapped } : null;
  }

  onPointerUp(imgPt, e, state) {
    if (this.dragStart) {
      const snapped = resolveSnap(imgPt, state, this.app.coords, {
        bypass: e.altKey,
        anchorPt: this.dragStart,
      });
      const dist = Math.hypot(snapped.x - this.dragStart.x, snapped.y - this.dragStart.y);
      if (dist >= 5) {
        this.app.pushUndo('Add Angled Guide');
        const count = state.guides.customLines.length + 1;
        const guide = createCustomGuideLine('angled', 0, count, this.dragStart, { x: snapped.x, y: snapped.y });
        state.guides.showCustomGuides = true;
        state.guides.customLines.push(guide);
        state.selectedIds = [guide.id];
        this.app.onStateChanged();
      }
      this.dragStart = null;
    }
  }

  cancel() {
    this.dragStart = null;
  }

  resetGrid(state) {
    this.app.pushUndo('Reset Grid');
    state.guides.grid = createDefaultGuides().grid;
    this.app.onStateChanged();
  }
}
