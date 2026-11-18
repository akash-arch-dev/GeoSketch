/**
 * GeoSketch — Main Application Controller
 * Orchestrates Landing/Upload Screen, Workspace, Tools, Snapping, Smart Annotations,
 * Zoom-Adaptive Rendering, Command Palette, Keyboard Shortcuts, and Project Persistence.
 */
import { CoordinateSystem } from './core/coordinateSystem.js';
import { HistoryManager } from './core/historyManager.js';
import { SelectionManager } from './core/selectionManager.js';
import { CanvasEngine } from './core/canvasEngine.js';
import { EventManager } from './core/eventManager.js';
import { ShortcutManager, DEFAULT_SHORTCUTS, eventToCombo } from './core/shortcutManager.js';

import {
  loadImageFromFile,
  loadImageFromUrl,
  readClipboardImage,
  formatFileSize,
} from './image/imageLoader.js';
import { createDefaultCrop } from './image/cropManager.js';

import { VisualGuidesTool } from './tools/visualGuides.js';
import { CropScaleTool } from './tools/cropScale.js';
import { LineMeasurementTool } from './tools/lineMeasurement.js';
import { ShapeToolsController } from './tools/shapeTools.js';
import { AngleMeasurementTool } from './tools/angleMeasurement.js';

import { ToolbarUI } from './ui/toolbar.js';
import { SidebarUI } from './ui/sidebar.js';
import { showToast, openModal, closeModal } from './ui/notifications.js';

import {
  createInitialState,
  createDefaultGuides,
  deserializeProject,
  ProjectManager,
} from './project/projectManager.js';
import {
  exportProjectJson,
  exportAnnotatedPng,
  exportMeasurementsCsv,
} from './project/exportManager.js';
import { deleteObjectById } from './layers/layerManager.js';

class GeoSketchApp {
  constructor() {
    this.currentScreen = 'upload';
    this.pendingImage = null;
    this.isCapturingShortcut = false;

    this.coords = new CoordinateSystem();
    this.history = new HistoryManager();
    this.selection = new SelectionManager();
    this.projectManager = new ProjectManager();
    this.shortcuts = new ShortcutManager();

    this.state = createInitialState();

    this.canvasEl = document.getElementById('main-canvas');
    this.viewportEl = document.getElementById('canvas-viewport');
    this.canvasEngine = new CanvasEngine(this.canvasEl, this.coords);
    this.eventManager = new EventManager(this, this.viewportEl);

    this.tools = {
      guides: new VisualGuidesTool(this),
      cropScale: new CropScaleTool(this),
      line: new LineMeasurementTool(this),
      shape: new ShapeToolsController(this),
      angle: new AngleMeasurementTool(this),
    };

    this.ui = {
      toolbar: new ToolbarUI(this),
      sidebar: new SidebarUI(this),
      updateZoomReadout: () => this.ui.toolbar.updateZoomReadout(),
      updateHintBanner: () => this.ui.toolbar.updateHintBanner(),
      refreshInspectorLive: () => this.ui.sidebar.refreshInspectorLive(),
      updateStatusCoords: (imgPt) => this.updateStatusCoords(imgPt),
    };

    this.init();
  }

  init() {
    this.bindUploadScreen();
    this.bindModal();
    this.ui.toolbar.bind();
    this.ui.sidebar.bind();
    this.eventManager.bind();

    window.addEventListener('resize', () => {
      if (this.currentScreen === 'workspace') {
        this.resizeCanvasToViewport();
      }
    });

    document.getElementById('json-import-input').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        await this.loadDeserializedProject(parsed);
        this.notify('Project imported successfully.', 'success');
      } catch (err) {
        this.notify(err.message || 'Failed to import project JSON.', 'error');
      }
    });
  }

  bindUploadScreen() {
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('file-input');
    const browseBtn = document.getElementById('btn-browse-file');
    const pasteBtn = document.getElementById('btn-paste-clipboard');
    const openWsBtn = document.getElementById('btn-open-workspace');
    const replaceBtn = document.getElementById('btn-replace-image');
    const removeBtn = document.getElementById('btn-remove-image');

    const handleFile = async (file) => {
      this.clearUploadError();
      try {
        const loaded = await loadImageFromFile(file);
        this.setPendingUploadImage(loaded);
      } catch (err) {
        this.showUploadError(err.message);
      }
    };

    browseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
    replaceBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });

    dropzone.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      if (!this.pendingImage) fileInput.click();
    });

    dropzone.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !this.pendingImage) {
        e.preventDefault();
        fileInput.click();
      }
    });

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) handleFile(file);
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('drag-over');
    });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFile(file);
    });

    pasteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      this.clearUploadError();
      try {
        const loaded = await readClipboardImage();
        this.setPendingUploadImage(loaded);
      } catch (err) {
        this.showUploadError(err.message);
      }
    });

    window.addEventListener('paste', async (e) => {
      if (this.currentScreen !== 'upload') return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handleFile(file);
            return;
          }
        }
      }
    });

    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.pendingImage = null;
      document.getElementById('dropzone-preview').classList.add('hidden');
      document.getElementById('dropzone-empty').classList.remove('hidden');
      this.clearUploadError();
    });

    openWsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.pendingImage) return;
      this.openImageInWorkspace(this.pendingImage);
    });

    document.querySelectorAll('.sample-card').forEach((card) => {
      card.addEventListener('click', async () => {
        this.clearUploadError();
        try {
          const sampleSrc = card.querySelector('img')?.src || card.dataset.sampleSrc;
          const loaded = await loadImageFromUrl(sampleSrc, card.dataset.sampleName);
          this.setPendingUploadImage(loaded);
          this.openImageInWorkspace(loaded);
        } catch (err) {
          this.showUploadError(err.message);
        }
      });
    });

    document.getElementById('btn-upload-open-project').addEventListener('click', () => {
      this.openSavedProjectsModal();
    });
    document.getElementById('btn-upload-import-json').addEventListener('click', () => {
      document.getElementById('json-import-input').click();
    });
  }

  setPendingUploadImage(loaded) {
    this.pendingImage = loaded;
    const previewImg = document.getElementById('upload-preview-img');
    const filenameEl = document.getElementById('preview-filename');
    const dimEl = document.getElementById('preview-dimensions');
    const detailsEl = document.getElementById('preview-details');

    previewImg.src = loaded.dataUrl;
    filenameEl.textContent = loaded.name;
    dimEl.textContent = `${loaded.naturalWidth} × ${loaded.naturalHeight} px`;
    const ratio = (loaded.naturalWidth / Math.max(1, loaded.naturalHeight)).toFixed(2);
    detailsEl.textContent = `${loaded.mimeType.replace('image/', '').toUpperCase()} · ${formatFileSize(loaded.sizeBytes)} · Aspect ${ratio}:1`;

    document.getElementById('dropzone-empty').classList.add('hidden');
    document.getElementById('dropzone-preview').classList.remove('hidden');
  }

  showUploadError(msg) {
    const el = document.getElementById('upload-error');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  clearUploadError() {
    const el = document.getElementById('upload-error');
    el.classList.add('hidden');
    el.textContent = '';
  }

  openImageInWorkspace(loaded) {
    const fresh = createInitialState();
    fresh.projectName = loaded.name.replace(/\.[^.]+$/, '') || 'Untitled Study';
    fresh.image = {
      element: loaded.element,
      dataUrl: loaded.dataUrl,
      name: loaded.name,
      mimeType: loaded.mimeType,
      sizeBytes: loaded.sizeBytes,
      naturalWidth: loaded.naturalWidth,
      naturalHeight: loaded.naturalHeight,
      width: loaded.naturalWidth,
      height: loaded.naturalHeight,
      rotationSteps: 0,
      flipH: false,
      flipV: false,
      visible: true,
      opacity: 1,
      locked: true,
    };
    fresh.crop = createDefaultCrop(loaded.naturalWidth, loaded.naturalHeight);

    this.state = fresh;
    this.history.clear();
    this.showWorkspaceScreen();
    this.fitToScreen();
    this.onStateChanged({ skipHistory: true });
  }

  showUploadScreen() {
    this.currentScreen = 'upload';
    document.getElementById('screen-workspace').classList.add('hidden');
    document.getElementById('screen-upload').classList.remove('hidden');
  }

  showWorkspaceScreen() {
    this.currentScreen = 'workspace';
    document.getElementById('screen-upload').classList.add('hidden');
    document.getElementById('screen-workspace').classList.remove('hidden');
    this.resizeCanvasToViewport();
  }

  resizeCanvasToViewport() {
    const rect = this.viewportEl.getBoundingClientRect();
    this.canvasEngine.resize(rect.width, rect.height);
    this.renderCanvas();
  }

  getActiveToolController() {
    return this.tools[this.state.activeTool] || null;
  }

  setActiveTool(toolName, subTool = null) {
    const prevTool = this.getActiveToolController();
    if (prevTool && prevTool.cancel) prevTool.cancel();

    this.state.activeTool = toolName;
    if (subTool && this.state.subTools[toolName] !== undefined) {
      this.state.subTools[toolName] = subTool;
    }

    if (toolName === 'cropScale' && this.state.subTools.cropScale === 'crop') {
      this.state.crop.draftX = this.state.crop.x;
      this.state.crop.draftY = this.state.crop.y;
      this.state.crop.draftWidth = this.state.crop.width;
      this.state.crop.draftHeight = this.state.crop.height;
    }

    this.eventManager.updateCursor();
    this.onStateChanged({ skipHistory: true, skipAutosave: true });
  }

  executeAction(actionId) {
    switch (actionId) {
      case 'undo': this.undo(); break;
      case 'redo': this.redo(); break;
      case 'copy': {
        const count = this.selection.copySelected(this.state);
        if (count > 0) this.notify(`Copied ${count} object${count > 1 ? 's' : ''}.`);
        break;
      }
      case 'paste': this.pasteSelected(); break;
      case 'duplicate': this.duplicateSelected(); break;
      case 'selectAll': this.selectAll(); break;
      case 'delete': this.deleteSelected(); break;
      case 'cancel': {
        const tool = this.getActiveToolController();
        if (tool && tool.cancel) tool.cancel();
        this.eventManager.cancelActiveDrag();
        this.renderCanvas();
        this.ui.updateHintBanner();
        break;
      }
      case 'toolSelect': this.setActiveTool('select'); break;
      case 'toolPan': this.setActiveTool('pan'); break;
      case 'toolGuides': this.setActiveTool('guides'); break;
      case 'toolCropScale': this.setActiveTool('cropScale'); break;
      case 'toolLine': this.setActiveTool('line'); break;
      case 'toolRect': this.setActiveTool('shape', 'rectangle'); break;
      case 'toolCircle': this.setActiveTool('shape', 'circle'); break;
      case 'toolEllipse': this.setActiveTool('shape', 'ellipse'); break;
      case 'toolPolygon': this.setActiveTool('shape', 'polygon'); break;
      case 'toolAngle': this.setActiveTool('angle'); break;
      case 'fitScreen': this.fitToScreen(); break;
      case 'zoom100': this.resetZoom(); break;
      case 'zoomIn': this.zoomBy(1.2); break;
      case 'zoomOut': this.zoomBy(1 / 1.2); break;
      case 'saveProject': this.handleProjectAction('save-project'); break;
      case 'openProject': this.handleProjectAction('open-project'); break;
      case 'commandPalette': this.openCommandPalette(); break;
      case 'shortcutsHelp': this.openShortcutsModal(); break;
      default: break;
    }
  }

  selectAll() {
    const ids = [];
    for (const l of this.state.lines) if (l.visible !== false) ids.push(l.id);
    for (const s of this.state.shapes) if (s.visible !== false) ids.push(s.id);
    for (const a of this.state.angles) if (a.visible !== false) ids.push(a.id);
    this.state.selectedIds = ids;
    this.setActiveTool('select');
    this.notify(`Selected ${ids.length} object${ids.length === 1 ? '' : 's'}.`);
  }

  fitToScreen() {
    if (!this.state.image.element) return;
    const isEditingCrop =
      this.state.activeTool === 'cropScale' && this.state.subTools.cropScale === 'crop';
    const rect =
      this.state.crop.applied && !isEditingCrop
        ? this.state.crop
        : { x: 0, y: 0, width: this.state.image.width, height: this.state.image.height };
    this.coords.fitRect(rect.x, rect.y, rect.width, rect.height, 36);
    this.renderCanvas();
    this.ui.updateZoomReadout();
  }

  resetZoom() {
    if (!this.state.image.element) return;
    const rect = this.state.crop.applied
      ? this.state.crop
      : { x: 0, y: 0, width: this.state.image.width, height: this.state.image.height };
    this.coords.resetZoomCentered(rect.x, rect.y, rect.width, rect.height);
    this.renderCanvas();
    this.ui.updateZoomReadout();
  }

  zoomBy(factor) {
    const cx = this.coords.viewportWidth * 0.5;
    const cy = this.coords.viewportHeight * 0.5;
    this.coords.zoomAtScreenPoint(this.coords.zoom * factor, cx, cy);
    this.renderCanvas();
    this.ui.updateZoomReadout();
  }

  renderCanvas(toolPreview = null) {
    this.canvasEngine.render(this.state, toolPreview);
  }

  pushUndo(label) {
    this.history.pushState(this.state, label);
  }

  applySnapshot(entry) {
    const snap = entry.snapshot;
    this.state.projectName = snap.projectName;
    this.state.image.rotationSteps = snap.imageMeta.rotationSteps;
    this.state.image.flipH = snap.imageMeta.flipH;
    this.state.image.flipV = snap.imageMeta.flipV;
    this.state.image.visible = snap.imageMeta.visible;
    this.state.image.opacity = snap.imageMeta.opacity;
    this.state.image.locked = snap.imageMeta.locked;
    this.state.image.width =
      snap.imageMeta.rotationSteps % 2 === 1
        ? this.state.image.naturalHeight
        : this.state.image.naturalWidth;
    this.state.image.height =
      snap.imageMeta.rotationSteps % 2 === 1
        ? this.state.image.naturalWidth
        : this.state.image.naturalHeight;

    this.state.crop = JSON.parse(JSON.stringify(snap.crop));
    this.state.calibration = JSON.parse(JSON.stringify(snap.calibration));
    this.state.guides = JSON.parse(JSON.stringify(snap.guides));
    this.state.lines = JSON.parse(JSON.stringify(snap.lines));
    this.state.shapes = JSON.parse(JSON.stringify(snap.shapes));
    this.state.angles = JSON.parse(JSON.stringify(snap.angles));
    this.state.selectedIds = [...snap.selectedIds];
    this.state.ratioCompareIds = [...snap.ratioCompareIds];
  }

  undo() {
    const entry = this.history.undo(this.state);
    if (!entry) return;
    this.applySnapshot(entry);
    this.onStateChanged({ skipHistory: true });
    this.notify(`Undo: ${entry.label}`);
  }

  redo() {
    const entry = this.history.redo(this.state);
    if (!entry) return;
    this.applySnapshot(entry);
    this.onStateChanged({ skipHistory: true });
    this.notify(`Redo: ${entry.label}`);
  }

  deleteSelected() {
    if (!this.state.selectedIds.length) return;
    this.pushUndo('Delete Selected');
    for (const id of [...this.state.selectedIds]) {
      const found = this.selection.findObjectById(this.state, id);
      if (found && !found.item.locked) {
        deleteObjectById(this.state, found.category, id);
      }
    }
    this.onStateChanged();
  }

  duplicateSelected() {
    if (!this.state.selectedIds.length) return;
    const count = this.selection.copySelected(this.state);
    if (count > 0) this.pasteSelected();
  }

  pasteSelected() {
    if (!this.selection.clipboard.length) return;
    this.pushUndo('Paste Objects');
    const created = this.selection.pasteClipboard(
      this.state,
      (cat) => `${cat}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`
    );
    if (created.length) {
      this.onStateChanged();
    }
  }

  onStateChanged(opts = {}) {
    this.renderCanvas();
    this.ui.toolbar.sync(this.state);
    this.ui.sidebar.render(this.state);
    this.updateStatusBar();

    if (!opts.skipAutosave) {
      const statusEl = document.getElementById('autosave-status');
      this.projectManager.scheduleAutosave(this.state, this.coords, (label) => {
        if (statusEl) statusEl.textContent = label;
      });
    }
  }

  updateStatusBar() {
    const dimEl = document.getElementById('status-image-dim');
    const scaleEl = document.getElementById('status-scale');
    const selEl = document.getElementById('status-selection');

    if (dimEl) {
      dimEl.textContent = `Image: ${this.state.image.width} × ${this.state.image.height} px`;
    }
    if (scaleEl) {
      const cal = this.state.calibration;
      scaleEl.textContent = cal.calibrated
        ? `Scale: ${cal.pixelDistance.toFixed(1)} px = ${cal.realValue} ${cal.realUnit} (${cal.displayUnit})`
        : `Scale: Uncalibrated (${cal.displayUnit})`;
    }
    if (selEl) {
      const count = this.state.selectedIds.length;
      if (count === 0) selEl.textContent = 'No selection';
      else if (count === 1) {
        const f = this.selection.findObjectById(this.state, this.state.selectedIds[0]);
        selEl.textContent = f ? `Selected: ${f.item.name}` : '1 selected';
      } else {
        selEl.textContent = `${count} objects selected`;
      }
    }
  }

  updateStatusCoords(imgPt) {
    const el = document.getElementById('status-coords');
    if (el) {
      el.textContent = `X: ${Math.round(imgPt.x)} px · Y: ${Math.round(imgPt.y)} px`;
    }
  }

  async handleProjectAction(action) {
    if (action === 'new-project' || action === 'replace-image') {
      this.showUploadScreen();
      return;
    }
    if (action === 'save-project') {
      try {
        await this.projectManager.save(this.state, this.coords);
        document.getElementById('autosave-status').textContent = 'Saved';
        this.notify('Project saved to browser storage.', 'success');
      } catch (err) {
        this.notify(err.message || 'Failed to save project.', 'error');
      }
      return;
    }
    if (action === 'open-project') {
      this.openSavedProjectsModal();
      return;
    }
    if (action === 'import-json') {
      document.getElementById('json-import-input').click();
      return;
    }
    if (action === 'export-json') {
      exportProjectJson(this.state, this.coords);
      this.notify('Project JSON exported.', 'success');
      return;
    }
    if (action === 'export-png') {
      this.exportPng();
      return;
    }
    if (action === 'export-csv') {
      exportMeasurementsCsv(this.state);
      this.notify('Measurements CSV exported.', 'success');
      return;
    }
    if (action === 'reset-workspace') {
      this.pushUndo('Reset Workspace Annotations');
      this.state.lines = [];
      this.state.shapes = [];
      this.state.angles = [];
      this.state.selectedIds = [];
      this.state.ratioCompareIds = [];
      this.state.guides = createDefaultGuides();
      this.state.crop = createDefaultCrop(this.state.image.width, this.state.image.height);
      this.state.calibration.calibrated = false;
      this.state.calibration.p1 = null;
      this.state.calibration.p2 = null;
      this.state.calibration.displayUnit = 'px';
      this.fitToScreen();
      this.onStateChanged();
      this.notify('Workspace annotations cleared.');
    }
  }

  exportPng() {
    exportAnnotatedPng(this.state, this.canvasEngine);
    this.notify('Annotated PNG exported.', 'success');
  }

  openDisplaySettingsModal() {
    const d = this.state.display;
    const rc = this.state.renderConfig;
    const sn = this.state.snapping;

    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div class="panel-section">
          <h3 class="section-title">Smart Annotations &amp; Visibility</h3>
          <label class="checkbox-row"><span>Show Measurements</span><input type="checkbox" data-d="showMeasurements" ${d.showMeasurements !== false ? 'checked' : ''} /></label>
          <label class="checkbox-row"><span>Show Labels (hiding never hides geometry)</span><input type="checkbox" data-d="showLabels" ${d.showLabels !== false ? 'checked' : ''} /></label>
          <label class="checkbox-row"><span>Show Object Names</span><input type="checkbox" data-d="showObjectNames" ${d.showObjectNames !== false ? 'checked' : ''} /></label>
          <label class="checkbox-row"><span>Show Control Points</span><input type="checkbox" data-d="showControlPoints" ${d.showControlPoints !== false ? 'checked' : ''} /></label>
          <label class="checkbox-row"><span>Show Selection Handles</span><input type="checkbox" data-d="showHandles" ${d.showHandles !== false ? 'checked' : ''} /></label>
          <label class="checkbox-row"><span>Show Smart Geometry Explainers</span><input type="checkbox" data-d="showSmartGeometry" ${d.showSmartGeometry !== false ? 'checked' : ''} /></label>
          <div class="field">
            <span class="field-label">Smart Geometry Scope</span>
            <select id="m-smart-scope" class="select">
              <option value="selected" ${d.smartAnnotationScope === 'selected' ? 'selected' : ''}>Selected Object Only</option>
              <option value="all" ${d.smartAnnotationScope === 'all' ? 'selected' : ''}>All Objects</option>
              <option value="none" ${d.smartAnnotationScope === 'none' ? 'selected' : ''}>Off</option>
            </select>
          </div>
        </div>

        <div class="panel-section">
          <h3 class="section-title">Zoom-Adaptive Overlay Rendering</h3>
          <div class="prop-grid-2">
            <div class="field">
              <span class="field-label">Line &amp; Shape Thickness</span>
              <select id="m-rc-line" class="select">
                <option value="screen-constant" ${rc.lineScaleMode === 'screen-constant' ? 'selected' : ''}>Screen-Constant px</option>
                <option value="adaptive" ${rc.lineScaleMode === 'adaptive' ? 'selected' : ''}>Adaptive Clamped</option>
                <option value="image-scaled" ${rc.lineScaleMode === 'image-scaled' ? 'selected' : ''}>Image-Scaled</option>
              </select>
            </div>
            <div class="field">
              <span class="field-label">Grid Line Thickness</span>
              <select id="m-rc-grid" class="select">
                <option value="screen-constant" ${rc.gridScaleMode === 'screen-constant' ? 'selected' : ''}>Screen-Constant px</option>
                <option value="adaptive" ${rc.gridScaleMode === 'adaptive' ? 'selected' : ''}>Adaptive Readable</option>
              </select>
            </div>
            <div class="field">
              <span class="field-label">Label Text Scale (${rc.labelScale}x)</span>
              <input id="m-rc-lscale" type="range" min="0.75" max="1.5" step="0.05" value="${rc.labelScale}" class="range-input" />
            </div>
            <div class="field">
              <span class="field-label">Handle Radius (${rc.handleRadiusPx} px)</span>
              <input id="m-rc-hradius" type="range" min="3" max="9" step="1" value="${rc.handleRadiusPx}" class="range-input" />
            </div>
          </div>
        </div>

        <div class="panel-section" style="border-bottom:none;padding-bottom:0;">
          <h3 class="section-title">Snapping Sensitivity</h3>
          <div class="field-inline">
            <label for="m-snap-sens">Snap Threshold (${sn.sensitivityPx} screen px)</label>
            <input id="m-snap-sens" type="range" min="4" max="28" step="1" value="${sn.sensitivityPx}" class="range-input" style="max-width:160px;" />
          </div>
        </div>
      </div>
    `;

    wrap.querySelectorAll('[data-d]').forEach((chk) => {
      chk.addEventListener('change', () => {
        d[chk.dataset.d] = chk.checked;
        this.onStateChanged({ skipHistory: true });
      });
    });
    wrap.querySelector('#m-smart-scope').addEventListener('change', (e) => {
      d.smartAnnotationScope = e.target.value;
      this.onStateChanged({ skipHistory: true });
    });
    wrap.querySelector('#m-rc-line').addEventListener('change', (e) => {
      rc.lineScaleMode = e.target.value;
      this.onStateChanged({ skipHistory: true });
    });
    wrap.querySelector('#m-rc-grid').addEventListener('change', (e) => {
      rc.gridScaleMode = e.target.value;
      this.onStateChanged({ skipHistory: true });
    });
    wrap.querySelector('#m-rc-lscale').addEventListener('input', (e) => {
      rc.labelScale = Number(e.target.value);
      this.renderCanvas();
    });
    wrap.querySelector('#m-rc-hradius').addEventListener('input', (e) => {
      rc.handleRadiusPx = Number(e.target.value);
      this.renderCanvas();
    });
    wrap.querySelector('#m-snap-sens').addEventListener('input', (e) => {
      sn.sensitivityPx = Number(e.target.value);
    });

    openModal('Smart View & Zoom-Adaptive Settings', wrap);
  }

  openCommandPalette() {
    const commands = [
      ...DEFAULT_SHORTCUTS.map((s) => ({
        id: s.id,
        label: s.label,
        category: s.category,
        shortcut: this.shortcuts.getCombo(s.id),
        run: () => this.executeAction(s.id),
      })),
      { id: 'cmd-grid', label: 'Toggle Grid Overlay', category: 'Visual Guides', shortcut: '', run: () => { this.pushUndo('Toggle Grid'); this.state.guides.grid.visible = !this.state.guides.grid.visible; this.onStateChanged(); } },
      { id: 'cmd-thirds', label: 'Toggle Rule of Thirds', category: 'Visual Guides', shortcut: '', run: () => { this.pushUndo('Toggle Rule of Thirds'); this.state.guides.ruleOfThirds = !this.state.guides.ruleOfThirds; this.onStateChanged(); } },
      { id: 'cmd-golden', label: 'Toggle Golden Ratio Guide', category: 'Visual Guides', shortcut: '', run: () => { this.pushUndo('Toggle Golden Ratio'); this.state.guides.goldenRatio = !this.state.guides.goldenRatio; this.onStateChanged(); } },
      { id: 'cmd-snap', label: 'Toggle Construction Snapping', category: 'Assistance', shortcut: '', run: () => { this.state.snapping.enabled = !this.state.snapping.enabled; this.onStateChanged({ skipHistory: true }); } },
      { id: 'cmd-view', label: 'Open Smart View & Zoom-Adaptive Settings', category: 'View', shortcut: '', run: () => this.openDisplaySettingsModal() },
      { id: 'cmd-png', label: 'Export Annotated PNG', category: 'Export', shortcut: '', run: () => this.exportPng() },
      { id: 'cmd-csv', label: 'Export Measurements CSV', category: 'Export', shortcut: '', run: () => exportMeasurementsCsv(this.state) },
      { id: 'cmd-json', label: 'Export Project JSON', category: 'Export', shortcut: '', run: () => exportProjectJson(this.state, this.coords) },
    ];

    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <input type="text" id="palette-search-input" class="palette-search" placeholder="Search tools, guides, shortcuts, or exports..." />
      <div id="palette-list" class="palette-list"></div>
    `;

    const input = wrap.querySelector('#palette-search-input');
    const listEl = wrap.querySelector('#palette-list');
    let activeIdx = 0;
    let filtered = commands;

    const renderList = () => {
      listEl.innerHTML = filtered
        .map(
          (c, i) => `
          <button type="button" class="palette-item ${i === activeIdx ? 'active' : ''}" data-idx="${i}">
            <span><strong>${this.escape(c.label)}</strong><span class="palette-item-cat">${this.escape(c.category)}</span></span>
            ${c.shortcut ? `<kbd>${this.escape(c.shortcut)}</kbd>` : ''}
          </button>`
        )
        .join('');
      listEl.querySelectorAll('.palette-item').forEach((btn) => {
        btn.addEventListener('click', () => {
          const cmd = filtered[Number(btn.dataset.idx)];
          closeModal();
          cmd?.run();
        });
      });
    };

    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      filtered = q
        ? commands.filter((c) => c.label.toLowerCase().includes(q) || c.category.toLowerCase().includes(q))
        : commands;
      activeIdx = 0;
      renderList();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIdx = Math.min(filtered.length - 1, activeIdx + 1);
        renderList();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIdx = Math.max(0, activeIdx - 1);
        renderList();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filtered[activeIdx];
        closeModal();
        cmd?.run();
      }
    });

    openModal('Command Palette', wrap);
    document.getElementById('modal-dialog').classList.add('palette-dialog');
    renderList();
    setTimeout(() => input.focus(), 20);
  }

  openShortcutsModal() {
    const wrap = document.createElement('div');
    const renderTable = () => {
      wrap.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:10px;">
          <span class="section-subtitle">Click Rebind on any editable shortcut and press a new key combination.</span>
          <button type="button" id="btn-reset-shortcuts" class="btn btn-xs btn-secondary">Reset Defaults</button>
        </div>
        <table class="shortcut-table">
          <thead><tr><th>Action</th><th>Category</th><th>Shortcut</th><th></th></tr></thead>
          <tbody>
            ${DEFAULT_SHORTCUTS.map(
              (s) => `
              <tr>
                <td>${this.escape(s.label)}</td>
                <td class="section-subtitle">${this.escape(s.category)}</td>
                <td><kbd>${this.escape(this.shortcuts.getCombo(s.id))}</kbd></td>
                <td style="text-align:right;">
                  ${
                    s.fixed
                      ? `<span class="section-subtitle">Fixed</span>`
                      : `<button type="button" class="btn btn-xs btn-secondary shortcut-rebind-btn" data-rebind="${s.id}">Rebind</button>`
                  }
                </td>
              </tr>`
            ).join('')}
          </tbody>
        </table>
      `;

      wrap.querySelector('#btn-reset-shortcuts').addEventListener('click', () => {
        this.shortcuts.resetDefaults();
        this.ui.toolbar.updateShortcutTooltips();
        renderTable();
        this.notify('Keyboard shortcuts reset to defaults.', 'success');
      });

      wrap.querySelectorAll('[data-rebind]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.rebind;
          btn.textContent = 'Press key...';
          this.isCapturingShortcut = true;

          const onKey = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (ev.key === 'Escape') {
              this.isCapturingShortcut = false;
              window.removeEventListener('keydown', onKey, true);
              renderTable();
              return;
            }
            const combo = eventToCombo(ev);
            if (!combo) return;
            this.isCapturingShortcut = false;
            window.removeEventListener('keydown', onKey, true);
            const res = this.shortcuts.rebind(id, combo);
            if (!res.ok) {
              this.notify(res.error, 'error');
            } else {
              this.ui.toolbar.updateShortcutTooltips();
              this.notify(`Rebound to ${combo}`, 'success');
            }
            renderTable();
          };
          window.addEventListener('keydown', onKey, true);
        });
      });
    };

    renderTable();
    openModal('Keyboard Shortcuts Reference', wrap);
  }

  async openSavedProjectsModal() {
    try {
      const projects = await this.projectManager.listSaved();
      const wrap = document.createElement('div');
      if (projects.length === 0) {
        wrap.innerHTML = `<div class="empty-state-msg">No saved projects in IndexedDB yet. Upload an image and start measuring to autosave.</div>`;
      } else {
        const list = document.createElement('div');
        list.className = 'project-list';
        for (const p of projects) {
          const item = document.createElement('div');
          item.className = 'project-item';
          const dateStr = new Date(p.updatedAt || Date.now()).toLocaleString();
          item.innerHTML = `
            <div class="project-item-info">
              <div class="project-item-name">${this.escape(p.name)}</div>
              <div class="project-item-meta tabular-nums">${p.image?.width || 0}&times;${p.image?.height || 0} px &middot; ${p.lines?.length || 0} lines &middot; ${p.shapes?.length || 0} shapes &middot; ${p.angles?.length || 0} angles &middot; ${dateStr}</div>
            </div>
            <div class="project-item-actions">
              <button type="button" class="btn btn-sm btn-primary" data-open-id="${p.id}">Open</button>
              <button type="button" class="btn btn-sm btn-ghost-danger" data-del-id="${p.id}">Delete</button>
            </div>
          `;
          item.querySelector('[data-open-id]').addEventListener('click', async () => {
            try {
              const res = await this.projectManager.loadSaved(p.id);
              this.state = res.state;
              this.history.clear();
              this.showWorkspaceScreen();
              if (res.canvasView) {
                this.coords.zoom = res.canvasView.zoom;
                this.coords.panX = res.canvasView.panX;
                this.coords.panY = res.canvasView.panY;
              } else {
                this.fitToScreen();
              }
              this.onStateChanged({ skipHistory: true, skipAutosave: true });
              this.closeActiveModal();
              this.notify(`Opened "${this.state.projectName}".`, 'success');
            } catch (err) {
              this.notify(err.message, 'error');
            }
          });
          item.querySelector('[data-del-id]').addEventListener('click', async () => {
            await this.projectManager.deleteSaved(p.id);
            item.remove();
            if (!list.children.length) {
              wrap.innerHTML = `<div class="empty-state-msg">No saved projects remaining.</div>`;
            }
          });
          list.appendChild(item);
        }
        wrap.appendChild(list);
      }
      openModal('Saved Projects', wrap);
    } catch (err) {
      this.notify(err.message || 'Unable to access saved projects.', 'error');
    }
  }

  async loadDeserializedProject(jsonObj) {
    const res = await deserializeProject(jsonObj);
    this.state = res.state;
    this.history.clear();
    this.showWorkspaceScreen();
    if (res.canvasView) {
      this.coords.zoom = res.canvasView.zoom;
      this.coords.panX = res.canvasView.panX;
      this.coords.panY = res.canvasView.panY;
    } else {
      this.fitToScreen();
    }
    this.onStateChanged({ skipHistory: true });
  }

  closeActiveModal() {
    this.isCapturingShortcut = false;
    document.getElementById('modal-dialog')?.classList.remove('palette-dialog');
    closeModal();
  }

  bindModal() {
    document.getElementById('modal-close-btn').addEventListener('click', () => this.closeActiveModal());
    document.getElementById('modal-backdrop').addEventListener('click', (e) => {
      if (e.target.id === 'modal-backdrop') this.closeActiveModal();
    });
  }

  notify(msg, type = 'info') {
    showToast(msg, type);
  }

  escape(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.geoSketchApp = new GeoSketchApp();
});
