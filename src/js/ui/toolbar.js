/**
 * Top Toolbar & Sub-Tool Strip Controller
 */
import { SUPPORTED_UNITS } from '../geometry/measurements.js';

export class ToolbarUI {
  constructor(app) {
    this.app = app;
    this.catButtons = Array.from(document.querySelectorAll('.cat-btn'));
    this.subStrip = document.getElementById('subtool-strip');
    this.unitSelect = document.getElementById('global-unit-select');
    this.precisionSelect = document.getElementById('global-precision-select');
    this.zoomReadout = document.getElementById('topbar-zoom-readout');
    this.undoBtn = document.getElementById('btn-undo');
    this.redoBtn = document.getElementById('btn-redo');
    this.hintBanner = document.getElementById('canvas-hint-banner');
    this.projectMenuBtn = document.getElementById('btn-project-menu');
    this.projectDropdown = document.getElementById('project-menu-dropdown');
    this.projectNameInput = document.getElementById('project-name-input');
  }

  bind() {
    for (const btn of this.catButtons) {
      btn.addEventListener('click', () => {
        this.app.setActiveTool(btn.dataset.tool);
      });
    }

    this.unitSelect.addEventListener('change', () => {
      const unit = this.unitSelect.value;
      this.app.state.calibration.displayUnit = unit;
      if (unit !== 'px' && !this.app.state.calibration.calibrated) {
        this.app.notify('No real-world scale calibrated yet. Displaying pixel values until calibrated.', 'info');
      }
      this.app.onStateChanged({ skipHistory: true });
    });

    this.precisionSelect.addEventListener('change', () => {
      this.app.state.calibration.precision = Number(this.precisionSelect.value);
      this.app.onStateChanged({ skipHistory: true });
    });

    document.getElementById('btn-undo').addEventListener('click', () => this.app.undo());
    document.getElementById('btn-redo').addEventListener('click', () => this.app.redo());
    document.getElementById('btn-zoom-in').addEventListener('click', () => this.app.zoomBy(1.25));
    document.getElementById('btn-zoom-out').addEventListener('click', () => this.app.zoomBy(1 / 1.25));
    document.getElementById('btn-fit-screen').addEventListener('click', () => this.app.fitToScreen());
    document.getElementById('btn-reset-zoom').addEventListener('click', () => this.app.resetZoom());
    document.getElementById('btn-back-upload').addEventListener('click', () => this.app.showUploadScreen());
    document.getElementById('btn-export-png-quick').addEventListener('click', () => this.app.exportPng());

    this.projectNameInput.addEventListener('change', () => {
      const val = this.projectNameInput.value.trim() || 'Untitled Study';
      this.app.state.projectName = val;
      this.projectNameInput.value = val;
      this.app.onStateChanged({ skipHistory: true });
    });

    this.projectMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.projectDropdown.classList.toggle('hidden');
    });

    document.addEventListener('click', () => {
      this.projectDropdown.classList.add('hidden');
    });

    this.projectDropdown.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      this.projectDropdown.classList.add('hidden');
      this.app.handleProjectAction(btn.dataset.action);
    });

    // Populate unit options cleanly
    this.unitSelect.innerHTML = SUPPORTED_UNITS.map((u) => `<option value="${u}">${u}</option>`).join('');
  }

  sync(state) {
    for (const btn of this.catButtons) {
      btn.classList.toggle('active', btn.dataset.tool === state.activeTool);
    }

    this.projectNameInput.value = state.projectName || 'Untitled Study';
    this.unitSelect.value = state.calibration.displayUnit || 'px';
    this.precisionSelect.value = String(state.calibration.precision ?? 2);

    this.undoBtn.disabled = !this.app.history.canUndo();
    this.redoBtn.disabled = !this.app.history.canRedo();

    this.renderSubTools(state);
    this.updateHintBanner();
    this.updateZoomReadout();
  }

  renderSubTools(state) {
    const toolName = state.activeTool;
    if (toolName === 'select') {
      this.subStrip.innerHTML = `
        <span class="section-subtitle" style="padding: 0 4px;">Click objects to select &middot; Shift+Click for multi-select &middot; Drag handles to resize/rotate/distort</span>
      `;
      return;
    }

    const controller = this.app.tools[toolName];
    if (!controller || !controller.getSubTools) {
      this.subStrip.innerHTML = '';
      return;
    }

    const items = controller.getSubTools();
    const activeSub = state.subTools[toolName];
    this.subStrip.innerHTML = items
      .map(
        (item) =>
          `<button type="button" class="subtool-btn ${item.id === activeSub ? 'active' : ''}" data-subtool="${item.id}">${item.label}</button>`
      )
      .join('');

    this.subStrip.querySelectorAll('.subtool-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const subId = btn.dataset.subtool;
        if (controller.cancel) controller.cancel();
        state.subTools[toolName] = subId;
        this.app.onStateChanged({ skipHistory: true, skipAutosave: true });
      });
    });
  }

  updateHintBanner() {
    const state = this.app.state;
    const tool = this.app.getActiveToolController();
    const hint = tool && tool.getHint ? tool.getHint(state) : '';
    if (hint) {
      this.hintBanner.textContent = hint;
      this.hintBanner.classList.remove('hidden');
    } else {
      this.hintBanner.classList.add('hidden');
    }
  }

  updateZoomReadout() {
    if (this.zoomReadout) {
      this.zoomReadout.textContent = `${Math.round(this.app.coords.zoom * 100)}%`;
    }
  }
}
