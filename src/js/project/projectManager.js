/**
 * GeoSketch Project Lifecycle, Default Workspace State, Serialization & Autosave Manager
 */
import { createDefaultCrop } from '../image/cropManager.js';
import { loadImageFromDataUrl } from '../image/imageLoader.js';
import { createDefaultRenderConfig, createDefaultDisplaySettings } from '../core/renderConfig.js';
import { createDefaultSnappingConfig } from '../core/snapEngine.js';
import {
  saveProjectToDB,
  getProjectFromDB,
  listProjectsFromDB,
  deleteProjectFromDB,
  savePreferences,
  loadPreferences,
} from './storageManager.js';

export function createDefaultGuides() {
  return {
    grid: {
      visible: false,
      locked: false,
      mode: 'count', // 'count' | 'cellSize'
      rows: 4,
      columns: 4,
      cellWidth: 100,
      cellHeight: 100,
      offsetX: 0,
      offsetY: 0,
      color: '#38bdf8',
      opacity: 0.45,
      thickness: 1,
      style: 'solid', // 'solid' | 'dashed' | 'dotted'
    },
    hCenter: false,
    vCenter: false,
    diagonals: false,
    ruleOfThirds: false,
    goldenRatio: false,
    symmetry: {
      enabled: false,
      axis: 'vertical', // 'vertical' | 'horizontal' | 'both'
      offset: 0,
    },
    guideColor: '#f59e0b',
    guideOpacity: 0.65,
    guideThickness: 1,
    showCustomGuides: true,
    customLines: [],
  };
}

export function createInitialState(prefs = loadPreferences()) {
  return {
    projectId: `proj_${Date.now().toString(36)}`,
    projectName: 'Untitled Study',
    image: {
      element: null,
      dataUrl: null,
      name: '',
      mimeType: '',
      sizeBytes: 0,
      naturalWidth: 0,
      naturalHeight: 0,
      width: 0,
      height: 0,
      rotationSteps: 0,
      flipH: false,
      flipV: false,
      visible: true,
      opacity: 1,
      locked: true,
    },
    crop: createDefaultCrop(800, 600),
    calibration: {
      calibrated: false,
      p1: null,
      p2: null,
      pixelDistance: 0,
      realValue: 10,
      realUnit: 'cm',
      displayUnit: prefs.unit || 'px',
      precision: prefs.precision ?? 2,
    },
    guides: createDefaultGuides(),
    renderConfig: createDefaultRenderConfig(),
    display: createDefaultDisplaySettings(),
    snapping: createDefaultSnappingConfig(),
    lines: [],
    shapes: [],
    angles: [],
    selectedIds: [],
    ratioCompareIds: [],
    activeTool: 'select',
    subTools: {
      guides: 'grid', // 'grid' | 'customH' | 'customV' | 'customAngled'
      cropScale: 'crop', // 'crop' | 'scale'
      line: 'draw', // 'draw'
      shape: 'rectangle', // 'rectangle' | 'square' | 'circle' | 'ellipse' | 'triangle' | 'polygon' | 'customPolygon' | 'freehand'
      angle: 'threePoint', // 'threePoint' | 'twoLines' | 'fromLines'
    },
    toolDefaults: {
      lineColor: '#38bdf8',
      lineThickness: 2,
      lineOpacity: 1,
      shapeBorderColor: '#f59e0b',
      shapeFillColor: '#f59e0b',
      shapeFillOpacity: 0.1,
      shapeBorderThickness: 2,
      polygonSides: 5,
      angleArcColor: '#10b981',
      angleArcThickness: 2,
      angleArcRadius: 42,
      angleTextSize: 12,
      anglePrecision: 1,
    },
  };
}

export function serializeProject(state, coords) {
  return {
    version: 2,
    id: state.projectId,
    name: state.projectName || 'Untitled Study',
    updatedAt: Date.now(),
    image: {
      dataUrl: state.image.dataUrl,
      name: state.image.name,
      mimeType: state.image.mimeType,
      sizeBytes: state.image.sizeBytes,
      naturalWidth: state.image.naturalWidth,
      naturalHeight: state.image.naturalHeight,
      width: state.image.width,
      height: state.image.height,
      rotationSteps: state.image.rotationSteps,
      flipH: state.image.flipH,
      flipV: state.image.flipV,
      visible: state.image.visible,
      opacity: state.image.opacity,
      locked: state.image.locked,
    },
    crop: JSON.parse(JSON.stringify(state.crop)),
    calibration: JSON.parse(JSON.stringify(state.calibration)),
    guides: JSON.parse(JSON.stringify(state.guides)),
    renderConfig: JSON.parse(JSON.stringify(state.renderConfig)),
    display: JSON.parse(JSON.stringify(state.display)),
    snapping: JSON.parse(JSON.stringify(state.snapping)),
    lines: JSON.parse(JSON.stringify(state.lines)),
    shapes: JSON.parse(JSON.stringify(state.shapes)),
    angles: JSON.parse(JSON.stringify(state.angles)),
    ratioCompareIds: [...state.ratioCompareIds],
    canvasView: coords
      ? { zoom: coords.zoom, panX: coords.panX, panY: coords.panY }
      : null,
  };
}

export async function deserializeProject(jsonObj, currentPrefs = loadPreferences()) {
  if (!jsonObj || !jsonObj.image || !jsonObj.image.dataUrl) {
    throw new Error('Invalid project file: missing reference image data.');
  }

  const loaded = await loadImageFromDataUrl(jsonObj.image.dataUrl, {
    name: jsonObj.image.name,
    mimeType: jsonObj.image.mimeType,
    sizeBytes: jsonObj.image.sizeBytes,
  });

  const state = createInitialState(currentPrefs);
  state.projectId = jsonObj.id || `proj_${Date.now().toString(36)}`;
  state.projectName = jsonObj.name || 'Imported Study';
  state.image = {
    ...state.image,
    ...jsonObj.image,
    element: loaded.element,
    naturalWidth: loaded.naturalWidth,
    naturalHeight: loaded.naturalHeight,
    width: jsonObj.image.width || loaded.naturalWidth,
    height: jsonObj.image.height || loaded.naturalHeight,
  };

  if (jsonObj.crop) state.crop = { ...createDefaultCrop(state.image.width, state.image.height), ...jsonObj.crop, editing: false };
  if (jsonObj.calibration) state.calibration = { ...state.calibration, ...jsonObj.calibration };
  if (jsonObj.guides) {
    const defGuides = createDefaultGuides();
    state.guides = {
      ...defGuides,
      ...jsonObj.guides,
      grid: { ...defGuides.grid, ...(jsonObj.guides.grid || {}) },
      symmetry: { ...defGuides.symmetry, ...(jsonObj.guides.symmetry || {}) },
      customLines: Array.isArray(jsonObj.guides.customLines) ? jsonObj.guides.customLines : [],
    };
  }
  if (jsonObj.renderConfig) state.renderConfig = { ...state.renderConfig, ...jsonObj.renderConfig };
  if (jsonObj.display) state.display = { ...state.display, ...jsonObj.display };
  if (jsonObj.snapping) state.snapping = { ...state.snapping, ...jsonObj.snapping };

  state.lines = Array.isArray(jsonObj.lines) ? jsonObj.lines : [];
  state.shapes = Array.isArray(jsonObj.shapes) ? jsonObj.shapes : [];
  state.angles = Array.isArray(jsonObj.angles) ? jsonObj.angles : [];
  state.ratioCompareIds = Array.isArray(jsonObj.ratioCompareIds) ? jsonObj.ratioCompareIds : [];

  return { state, canvasView: jsonObj.canvasView || null };
}

export class ProjectManager {
  constructor() {
    this.autosaveTimer = null;
  }

  async save(state, coords) {
    if (!state.image.dataUrl) return null;
    const record = serializeProject(state, coords);
    await saveProjectToDB(record);
    const prefs = loadPreferences();
    savePreferences({
      ...prefs,
      unit: state.calibration.displayUnit,
      precision: state.calibration.precision,
      lastProjectId: state.projectId,
    });
    return record;
  }

  scheduleAutosave(state, coords, onStatusChange) {
    if (!state.image.dataUrl) return;
    if (onStatusChange) onStatusChange('Saving...');
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(async () => {
      try {
        await this.save(state, coords);
        if (onStatusChange) onStatusChange('Saved');
      } catch {
        if (onStatusChange) onStatusChange('Autosave error');
      }
    }, 1000);
  }

  async listSaved() {
    return listProjectsFromDB();
  }

  async loadSaved(id) {
    const rec = await getProjectFromDB(id);
    if (!rec) throw new Error('Saved project not found.');
    return deserializeProject(rec);
  }

  async deleteSaved(id) {
    await deleteProjectFromDB(id);
  }
}
