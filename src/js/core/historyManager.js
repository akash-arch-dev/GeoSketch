/**
 * Undo / Redo History Manager using deep snapshots of workspace state.
 */

export class HistoryManager {
  constructor(maxEntries = 80) {
    this.maxEntries = maxEntries;
    this.undoStack = [];
    this.redoStack = [];
    this.pendingDragSnapshot = null;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.pendingDragSnapshot = null;
  }

  cloneSnapshot(state) {
    return JSON.parse(
      JSON.stringify({
        projectName: state.projectName,
        imageMeta: {
          rotationSteps: state.image.rotationSteps,
          flipH: state.image.flipH,
          flipV: state.image.flipV,
          visible: state.image.visible,
          opacity: state.image.opacity,
          locked: state.image.locked,
        },
        crop: state.crop,
        calibration: state.calibration,
        guides: state.guides,
        lines: state.lines,
        shapes: state.shapes,
        angles: state.angles,
        selectedIds: state.selectedIds,
        ratioCompareIds: state.ratioCompareIds,
      })
    );
  }

  pushState(state, label = 'Edit') {
    const snapshot = this.cloneSnapshot(state);
    this.undoStack.push({ label, snapshot });
    if (this.undoStack.length > this.maxEntries) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  beginBatch(state, label = 'Transform') {
    if (!this.pendingDragSnapshot) {
      this.pendingDragSnapshot = {
        label,
        snapshot: this.cloneSnapshot(state),
      };
    }
  }

  commitBatch(currentState) {
    if (!this.pendingDragSnapshot) return false;
    const before = JSON.stringify(this.pendingDragSnapshot.snapshot);
    const after = JSON.stringify(this.cloneSnapshot(currentState));
    if (before !== after) {
      this.undoStack.push(this.pendingDragSnapshot);
      if (this.undoStack.length > this.maxEntries) {
        this.undoStack.shift();
      }
      this.redoStack = [];
      this.pendingDragSnapshot = null;
      return true;
    }
    this.pendingDragSnapshot = null;
    return false;
  }

  cancelBatch() {
    this.pendingDragSnapshot = null;
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo(currentState) {
    if (!this.canUndo()) return null;
    const currentSnapshot = this.cloneSnapshot(currentState);
    const entry = this.undoStack.pop();
    this.redoStack.push({ label: entry.label, snapshot: currentSnapshot });
    return entry;
  }

  redo(currentState) {
    if (!this.canRedo()) return null;
    const currentSnapshot = this.cloneSnapshot(currentState);
    const entry = this.redoStack.pop();
    this.undoStack.push({ label: entry.label, snapshot: currentSnapshot });
    return entry;
  }
}
