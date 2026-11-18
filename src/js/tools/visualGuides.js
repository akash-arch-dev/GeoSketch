/**
 * Visual Guides Tool Controller
 */
import { createDefaultGuides } from '../project/projectManager.js';
import { createCustomGuideLine } from '../layers/objectManager.js';

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
    if (sub === 'customH') {
      this.app.pushUndo('Add Horizontal Guide');
      const count = state.guides.customLines.length + 1;
      const guide = createCustomGuideLine('horizontal', imgPt.y, count);
      state.guides.showCustomGuides = true;
      state.guides.customLines.push(guide);
      state.selectedIds = [guide.id];
      this.app.onStateChanged();
    } else if (sub === 'customV') {
      this.app.pushUndo('Add Vertical Guide');
      const count = state.guides.customLines.length + 1;
      const guide = createCustomGuideLine('vertical', imgPt.x, count);
      state.guides.showCustomGuides = true;
      state.guides.customLines.push(guide);
      state.selectedIds = [guide.id];
      this.app.onStateChanged();
    } else if (sub === 'customAngled') {
      this.dragStart = { x: imgPt.x, y: imgPt.y };
    }
    void e;
  }

  onPointerMove(imgPt) {
    if (this.dragStart) {
      return {
        type: 'line',
        line: {
          name: 'Guide',
          p1: this.dragStart,
          p2: imgPt,
          color: '#a78bfa',
          thickness: 1.5,
          opacity: 0.85,
        },
      };
    }
    return null;
  }

  onPointerUp(imgPt, e, state) {
    if (this.dragStart) {
      const dist = Math.hypot(imgPt.x - this.dragStart.x, imgPt.y - this.dragStart.y);
      if (dist >= 5) {
        this.app.pushUndo('Add Angled Guide');
        const count = state.guides.customLines.length + 1;
        const guide = createCustomGuideLine('angled', 0, count, this.dragStart, { ...imgPt });
        state.guides.showCustomGuides = true;
        state.guides.customLines.push(guide);
        state.selectedIds = [guide.id];
        this.app.onStateChanged();
      }
      this.dragStart = null;
    }
    void e;
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
