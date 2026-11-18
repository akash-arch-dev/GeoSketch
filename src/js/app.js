/**
 * ImageRatio — Main Application Controller
 * Orchestrates Screen A (Upload), Screen B (Workspace), Tools, Canvas, History, and Project Persistence.
 */
import { CoordinateSystem } from './core/coordinateSystem.js';
import { HistoryManager } from './core/historyManager.js';
import { SelectionManager } from './core/selectionManager.js';
import { CanvasEngine } from './core/canvasEngine.js';
import { EventManager } from './core/eventManager.js';

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

class ImageRatioApp {
  constructor() {
    this.currentScreen = 'upload';
    this.pendingImage = null;

    this.coords = new CoordinateSystem();
    this.history = new HistoryManager();
    this.selection = new SelectionManager();
    this.projectManager = new ProjectManager();

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

    // Global JSON file import input
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

    // Global Ctrl+V clipboard paste on Upload screen
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

    // Sample Reference Studies
    document.querySelectorAll('.sample-card').forEach((card) => {
      card.addEventListener('click', async () => {
        this.clearUploadError();
        try {
          const loaded = await loadImageFromUrl(card.dataset.sampleSrc, card.dataset.sampleName);
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
    // If replacing image while keeping project or starting fresh:
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

  setActiveTool(toolName) {
    const prevTool = this.getActiveToolController();
    if (prevTool && prevTool.cancel) prevTool.cancel();

    this.state.activeTool = toolName;
    if (toolName === 'cropScale' && this.state.subTools.cropScale === 'crop') {
      this.state.crop.draftX = this.state.crop.x;
      this.state.crop.draftY = this.state.crop.y;
      this.state.crop.draftWidth = this.state.crop.width;
      this.state.crop.draftHeight = this.state.crop.height;
    }

    this.eventManager.updateCursor();
    this.onStateChanged({ skipHistory: true, skipAutosave: true });
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
    const created = this.selection.pasteClipboard(this.state, (cat) => `${cat}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`);
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
              closeModal();
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

  bindModal() {
    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('modal-backdrop').addEventListener('click', (e) => {
      if (e.target.id === 'modal-backdrop') closeModal();
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
  window.imageRatioApp = new ImageRatioApp();
});
