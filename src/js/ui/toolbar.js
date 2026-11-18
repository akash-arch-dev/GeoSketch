/**
 * GeoSketch Top Toolbar & Sub-Tool Strip Controller
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
    this.snapBtn = document.getElementById('btn-toggle-snap');
    this.viewBtn = document.getElementById('btn-display-settings');
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

    this.unitSelect.innerHTML = SUPPORTED_UNITS.map((u) => `<option value="${u}">${u}</option>`).join('');

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

    this.undoBtn.addEventListener('click', () => this.app.undo());
    this.redoBtn.addEventListener('click', () => this.app.redo());
    document.getElementById('btn-zoom-in').addEventListener('click', () => this.app.zoomBy(1.25));
    document.getElementById('btn-zoom-out').addEventListener('click', () => this.app.zoomBy(1 / 1.25));
    document.getElementById('btn-fit-screen').addEventListener('click', () => this.app.fitToScreen());
    document.getElementById('btn-reset-zoom').addEventListener('click', () => this.app.resetZoom());
    document.getElementById('btn-back-upload').addEventListener('click', () => this.app.showUploadScreen());
    document.getElementById('btn-export-png-quick').addEventListener('click', () => this.app.exportPng());

    this.snapBtn.addEventListener('click', () => {
      this.app.state.snapping.enabled = !this.app.state.snapping.enabled;
      this.app.onStateChanged({ skipHistory: true });
    });

    this.viewBtn.addEventListener('click', () => this.app.openDisplaySettingsModal());
    document.getElementById('btn-command-palette').addEventListener('click', () => this.app.openCommandPalette());
    document.getElementById('btn-shortcuts-help').addEventListener('click', () => this.app.openShortcutsModal());

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
  }

  sync(state) {
    for (const btn of this.catButtons) {
      btn.classList.toggle('active', btn.dataset.tool === state.activeTool);
    }

    this.updateShortcutTooltips();

    this.projectNameInput.value = state.projectName || 'Untitled Study';
    this.unitSelect.value = state.calibration.displayUnit || 'px';
    this.precisionSelect.value = String(state.calibration.precision ?? 2);

    this.undoBtn.disabled = !this.app.history.canUndo();
    this.redoBtn.disabled = !this.app.history.canRedo();
    this.snapBtn.classList.toggle('active', Boolean(state.snapping.enabled));

    this.renderSubTools(state);
    this.updateHintBanner();
    this.updateZoomReadout();
  }

  updateShortcutTooltips() {
    const s = this.app.shortcuts;
    const map = {
      select: `Select, Move & Edit (${s.getCombo('toolSelect')})`,
      pan: `Pan Canvas (${s.getCombo('toolPan')} or Space+Drag)`,
      guides: `Visual Guides (${s.getCombo('toolGuides')})`,
      cropScale: `Crop & Scale (${s.getCombo('toolCropScale')})`,
      line: `Line Measurement (${s.getCombo('toolLine')})`,
      shape: `Shapes (${s.getCombo('toolRect')} Rect · ${s.getCombo('toolCircle')} Circle · ${s.getCombo('toolEllipse')} Ellipse · ${s.getCombo('toolPolygon')} Polygon)`,
      angle: `Angle Measurement (${s.getCombo('toolAngle')})`,
    };
    for (const btn of this.catButtons) {
      if (map[btn.dataset.tool]) btn.title = map[btn.dataset.tool];
    }
    this.undoBtn.title = `Undo (${s.getCombo('undo')})`;
    this.redoBtn.title = `Redo (${s.getCombo('redo')})`;
    document.getElementById('btn-fit-screen').title = `Fit Image to Screen (${s.getCombo('fitScreen')})`;
    document.getElementById('btn-reset-zoom').title = `Reset Zoom to 100% (${s.getCombo('zoom100')})`;
    document.getElementById('btn-zoom-in').title = `Zoom In (${s.getCombo('zoomIn')})`;
    document.getElementById('btn-zoom-out').title = `Zoom Out (${s.getCombo('zoomOut')})`;
    document.getElementById('btn-command-palette').title = `Command Palette (${s.getCombo('commandPalette')})`;
    document.getElementById('btn-shortcuts-help').title = `Keyboard Shortcuts (${s.getCombo('shortcutsHelp')})`;
  }

  renderSubTools(state) {
    const toolName = state.activeTool;
    if (toolName === 'select') {
      this.subStrip.innerHTML = `
        <span class="section-subtitle" style="padding: 0 4px;">Click or drag box to select &middot; Shift+Click multi-select &middot; Drag handles to resize, rotate, or warp</span>
      `;
      return;
    }
    if (toolName === 'pan') {
      this.subStrip.innerHTML = `
        <span class="section-subtitle" style="padding: 0 4px;">Drag canvas to pan safely without creating or editing geometry &middot; Wheel to zoom</span>
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
