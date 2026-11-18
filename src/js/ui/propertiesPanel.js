/**
 * Right Sidebar: Contextual Tool & Selected Object Properties Inspector
 */
import { computeLineMetrics } from '../geometry/lines.js';
import { computeAngleMetrics } from '../geometry/angles.js';
import { computeShapeMeasurements } from '../geometry/transformations.js';
import {
  formatLength,
  formatArea,
  convertPixelsToUnit,
  convertUnitToPixels,
  SUPPORTED_UNITS,
} from '../geometry/measurements.js';
import {
  getTargetAspectRatio,
  enforceCropBoundsAndAspect,
  rotateWorkspace90,
  flipWorkspace,
} from '../image/cropManager.js';
import { toggleShapePerspective, resetShapeDistortion } from '../layers/objectManager.js';
import { deleteObjectById, duplicateObjectById } from '../layers/layerManager.js';

export class PropertiesPanel {
  constructor(app, containerEl) {
    this.app = app;
    this.container = containerEl;
  }

  render(state) {
    // Priority: if an object is selected in Select mode (or single object selected), show its properties + tool context
    const selectedFound =
      state.selectedIds.length === 1
        ? this.app.selection.findObjectById(state, state.selectedIds[0])
        : null;

    if (selectedFound && (state.activeTool === 'select' || !['guides', 'cropScale'].includes(state.activeTool))) {
      if (selectedFound.category === 'line') {
        this.renderLineInspector(state, selectedFound.item);
        return;
      }
      if (selectedFound.category === 'shape') {
        this.renderShapeInspector(state, selectedFound.item);
        return;
      }
      if (selectedFound.category === 'angle') {
        this.renderAngleInspector(state, selectedFound.item);
        return;
      }
      if (selectedFound.category === 'guideLine') {
        this.renderCustomGuideInspector(state, selectedFound.item);
        return;
      }
    }

    if (state.selectedIds.length > 1) {
      this.renderMultiSelectionInspector(state);
      return;
    }

    // Otherwise render active tool properties
    switch (state.activeTool) {
      case 'guides':
        this.renderVisualGuidesInspector(state);
        break;
      case 'cropScale':
        this.renderCropScaleInspector(state);
        break;
      case 'line':
        this.renderLineToolDefaults(state);
        break;
      case 'shape':
        this.renderShapeToolDefaults(state);
        break;
      case 'angle':
        this.renderAngleToolDefaults(state);
        break;
      default:
        this.renderWorkspaceOverviewInspector(state);
        break;
    }
  }

  renderWorkspaceOverviewInspector(state) {
    const cal = state.calibration;
    this.container.innerHTML = `
      <div class="panel-section">
        <div class="section-header">
          <h3 class="section-title">Reference Image</h3>
          <span class="section-subtitle">${this.escape(state.image.mimeType.replace('image/', '').toUpperCase())}</span>
        </div>
        <div class="kv-table">
          <div class="kv-row"><span class="kv-key">File</span><span class="kv-val">${this.escape(state.image.name)}</span></div>
          <div class="kv-row"><span class="kv-key">Working Size</span><span class="kv-val tabular-nums">${state.image.width} &times; ${state.image.height} px</span></div>
          <div class="kv-row"><span class="kv-key">Crop State</span><span class="kv-val">${state.crop.applied ? `Cropped (${Math.round(state.crop.width)} &times; ${Math.round(state.crop.height)})` : 'Full Image'}</span></div>
          <div class="kv-row"><span class="kv-key">Scale Reference</span><span class="kv-val tabular-nums">${cal.calibrated ? `${cal.pixelDistance.toFixed(1)} px = ${cal.realValue} ${cal.realUnit}` : 'Uncalibrated (px)'}</span></div>
        </div>
        <div class="field-inline" style="margin-top:4px;">
          <label for="img-opacity-range">Image Opacity</label>
          <input id="img-opacity-range" type="range" min="0.1" max="1" step="0.05" value="${state.image.opacity ?? 1}" class="range-input" style="max-width:140px;" />
        </div>
      </div>
      <div class="panel-section">
        <h3 class="section-title">Quick Actions</h3>
        <div class="action-row">
          <button type="button" class="btn btn-sm btn-secondary" data-jump-tool="guides">Configure Grid</button>
          <button type="button" class="btn btn-sm btn-secondary" data-jump-tool="cropScale" data-jump-sub="scale">Calibrate Scale</button>
          <button type="button" class="btn btn-sm btn-secondary" data-jump-tool="line">Draw Line</button>
          <button type="button" class="btn btn-sm btn-secondary" data-jump-tool="shape">Draw Shape</button>
        </div>
      </div>
    `;

    this.container.querySelector('#img-opacity-range')?.addEventListener('input', (e) => {
      state.image.opacity = Number(e.target.value);
      this.app.renderCanvas();
    });
    this.container.querySelector('#img-opacity-range')?.addEventListener('change', () => {
      this.app.onStateChanged({ skipHistory: true });
    });

    this.container.querySelectorAll('[data-jump-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.jumpSub) {
          state.subTools[btn.dataset.jumpTool] = btn.dataset.jumpSub;
        }
        this.app.setActiveTool(btn.dataset.jumpTool);
      });
    });
  }

  renderMultiSelectionInspector(state) {
    const selectedLines = state.lines.filter((l) => state.selectedIds.includes(l.id));
    this.container.innerHTML = `
      <div class="panel-section">
        <div class="section-header">
          <h3 class="section-title">Multiple Selection</h3>
          <span class="section-subtitle tabular-nums">${state.selectedIds.length} objects</span>
        </div>
        <div class="action-row">
          <button type="button" class="btn btn-sm btn-secondary" id="btn-multi-dup">Duplicate</button>
          <button type="button" class="btn btn-sm btn-ghost-danger" id="btn-multi-del">Delete Selected</button>
        </div>
        ${
          selectedLines.length >= 2
            ? `<div class="action-row" style="margin-top:6px;">
                <button type="button" class="btn btn-sm btn-primary" id="btn-multi-compare-ratios">Compare Line Ratios</button>
                ${selectedLines.length === 2 ? `<button type="button" class="btn btn-sm btn-secondary" id="btn-multi-angle">Measure Angle Between Lines</button>` : ''}
              </div>`
            : ''
        }
      </div>
    `;

    this.container.querySelector('#btn-multi-dup')?.addEventListener('click', () => this.app.duplicateSelected());
    this.container.querySelector('#btn-multi-del')?.addEventListener('click', () => this.app.deleteSelected());
    this.container.querySelector('#btn-multi-compare-ratios')?.addEventListener('click', () => {
      state.ratioCompareIds = selectedLines.map((l) => l.id);
      this.app.ui.sidebar.setActiveTab('measurements');
      this.app.onStateChanged({ skipHistory: true });
    });
    this.container.querySelector('#btn-multi-angle')?.addEventListener('click', () => {
      this.app.tools.angle.createAngleFromSelectedLines(state);
    });
  }

  renderVisualGuidesInspector(state) {
    const g = state.guides;
    const gr = g.grid;
    const lockedAttr = gr.locked ? 'disabled' : '';
    const unit = state.calibration.displayUnit;
    const cal = state.calibration;

    // Convert cell width/height for display if calibrated
    const cwDisplay = convertPixelsToUnit(gr.cellWidth, unit, cal).value;
    const chDisplay = convertPixelsToUnit(gr.cellHeight, unit, cal).value;
    const cellUnitLabel = cal.calibrated && unit !== 'px' ? unit : 'px';

    this.container.innerHTML = `
      <div class="panel-section">
        <div class="section-header">
          <h3 class="section-title">Grid System</h3>
          <div class="action-row">
            <button type="button" class="btn btn-xs btn-secondary" id="btn-grid-lock">${gr.locked ? 'Unlock' : 'Lock'}</button>
            <button type="button" class="btn btn-xs btn-secondary" id="btn-grid-reset">Reset</button>
          </div>
        </div>
        <label class="checkbox-row">
          <span>Show Grid</span>
          <input type="checkbox" id="chk-grid-visible" ${gr.visible ? 'checked' : ''} />
        </label>
        <div class="segmented" id="seg-grid-mode">
          <button type="button" class="segmented-btn ${gr.mode === 'count' ? 'active' : ''}" data-mode="count" ${lockedAttr}>Rows &times; Cols</button>
          <button type="button" class="segmented-btn ${gr.mode === 'cellSize' ? 'active' : ''}" data-mode="cellSize" ${lockedAttr}>Cell Size (${cellUnitLabel})</button>
        </div>

        ${
          gr.mode === 'count'
            ? `<div class="prop-grid-2">
                <div class="field"><span class="field-label">Rows</span><input id="inp-grid-rows" type="number" min="1" max="100" class="input input-mono" value="${gr.rows}" ${lockedAttr} /></div>
                <div class="field"><span class="field-label">Columns</span><input id="inp-grid-cols" type="number" min="1" max="100" class="input input-mono" value="${gr.columns}" ${lockedAttr} /></div>
              </div>`
            : `<div class="prop-grid-2">
                <div class="field"><span class="field-label">Cell Width (${cellUnitLabel})</span><input id="inp-grid-cw" type="number" min="1" step="any" class="input input-mono" value="${Number(cwDisplay.toFixed(2))}" ${lockedAttr} /></div>
                <div class="field"><span class="field-label">Cell Height (${cellUnitLabel})</span><input id="inp-grid-ch" type="number" min="1" step="any" class="input input-mono" value="${Number(chDisplay.toFixed(2))}" ${lockedAttr} /></div>
              </div>`
        }

        <div class="prop-grid-3">
          <div class="field"><span class="field-label">Color</span><input id="inp-grid-color" type="color" class="color-input" value="${gr.color}" ${lockedAttr} /></div>
          <div class="field"><span class="field-label">Thickness</span><input id="inp-grid-thick" type="number" min="0.5" max="6" step="0.5" class="input input-mono" value="${gr.thickness}" ${lockedAttr} /></div>
          <div class="field"><span class="field-label">Style</span>
            <select id="sel-grid-style" class="select" ${lockedAttr}>
              <option value="solid" ${gr.style === 'solid' ? 'selected' : ''}>Solid</option>
              <option value="dashed" ${gr.style === 'dashed' ? 'selected' : ''}>Dashed</option>
              <option value="dotted" ${gr.style === 'dotted' ? 'selected' : ''}>Dotted</option>
            </select>
          </div>
        </div>
        <div class="field-inline">
          <label for="inp-grid-opacity">Grid Opacity (${Math.round(gr.opacity * 100)}%)</label>
          <input id="inp-grid-opacity" type="range" min="0.05" max="1" step="0.05" value="${gr.opacity}" class="range-input" style="max-width:130px;" ${lockedAttr} />
        </div>
      </div>

      <div class="panel-section">
        <div class="section-header">
          <h3 class="section-title">Composition &amp; Symmetry Guides</h3>
        </div>
        <label class="checkbox-row"><span>Horizontal Center Line</span><input type="checkbox" data-guide-toggle="hCenter" ${g.hCenter ? 'checked' : ''} /></label>
        <label class="checkbox-row"><span>Vertical Center Line</span><input type="checkbox" data-guide-toggle="vCenter" ${g.vCenter ? 'checked' : ''} /></label>
        <label class="checkbox-row"><span>Diagonals</span><input type="checkbox" data-guide-toggle="diagonals" ${g.diagonals ? 'checked' : ''} /></label>
        <label class="checkbox-row"><span>Rule of Thirds</span><input type="checkbox" data-guide-toggle="ruleOfThirds" ${g.ruleOfThirds ? 'checked' : ''} /></label>
        <label class="checkbox-row"><span>Golden Ratio (&phi; = 1.618)</span><input type="checkbox" data-guide-toggle="goldenRatio" ${g.goldenRatio ? 'checked' : ''} /></label>
        <label class="checkbox-row"><span>Symmetry Axis Guide</span><input type="checkbox" id="chk-sym-enabled" ${g.symmetry.enabled ? 'checked' : ''} /></label>
        ${
          g.symmetry.enabled
            ? `<div class="prop-grid-2">
                <div class="field"><span class="field-label">Symmetry Axis</span>
                  <select id="sel-sym-axis" class="select">
                    <option value="vertical" ${g.symmetry.axis === 'vertical' ? 'selected' : ''}>Vertical</option>
                    <option value="horizontal" ${g.symmetry.axis === 'horizontal' ? 'selected' : ''}>Horizontal</option>
                    <option value="both" ${g.symmetry.axis === 'both' ? 'selected' : ''}>Both</option>
                  </select>
                </div>
                <div class="field"><span class="field-label">Offset (px)</span>
                  <input id="inp-sym-offset" type="number" step="1" class="input input-mono" value="${g.symmetry.offset}" />
                </div>
              </div>`
            : ''
        }
        <div class="prop-grid-3" style="margin-top:4px;">
          <div class="field"><span class="field-label">Guide Color</span><input id="inp-guide-color" type="color" class="color-input" value="${g.guideColor}" /></div>
          <div class="field"><span class="field-label">Thickness</span><input id="inp-guide-thick" type="number" min="0.5" max="5" step="0.5" class="input input-mono" value="${g.guideThickness}" /></div>
          <div class="field"><span class="field-label">Opacity</span><input id="inp-guide-opacity" type="number" min="0.1" max="1" step="0.1" class="input input-mono" value="${g.guideOpacity}" /></div>
        </div>
      </div>

      <div class="panel-section">
        <div class="section-header">
          <h3 class="section-title">Custom Guide Lines (${g.customLines.length})</h3>
          <label class="checkbox-row" style="gap:6px;"><span>Show</span><input type="checkbox" id="chk-custom-guides" ${g.showCustomGuides ? 'checked' : ''} /></label>
        </div>
        <div class="action-row">
          <button type="button" class="btn btn-xs btn-secondary" data-sub="customH">+ Horizontal</button>
          <button type="button" class="btn btn-xs btn-secondary" data-sub="customV">+ Vertical</button>
          <button type="button" class="btn btn-xs btn-secondary" data-sub="customAngled">+ Angled</button>
        </div>
      </div>
    `;

    // Event bindings
    this.container.querySelector('#chk-grid-visible')?.addEventListener('change', (e) => {
      this.app.pushUndo('Toggle Grid');
      gr.visible = e.target.checked;
      this.app.onStateChanged();
    });
    this.container.querySelector('#btn-grid-lock')?.addEventListener('click', () => {
      this.app.pushUndo('Toggle Grid Lock');
      gr.locked = !gr.locked;
      this.app.onStateChanged();
    });
    this.container.querySelector('#btn-grid-reset')?.addEventListener('click', () => {
      this.app.tools.guides.resetGrid(state);
    });
    this.container.querySelectorAll('#seg-grid-mode .segmented-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.app.pushUndo('Change Grid Mode');
        gr.mode = btn.dataset.mode;
        this.app.onStateChanged();
      });
    });

    this.bindNumInput('#inp-grid-rows', (v) => {
      gr.rows = Math.max(1, Math.min(100, Math.round(v)));
    }, 'Grid Rows');
    this.bindNumInput('#inp-grid-cols', (v) => {
      gr.columns = Math.max(1, Math.min(100, Math.round(v)));
    }, 'Grid Columns');
    this.bindNumInput('#inp-grid-cw', (v) => {
      const px = cal.calibrated && unit !== 'px' ? convertUnitToPixels(v, unit, cal) : v;
      gr.cellWidth = Math.max(4, px);
    }, 'Grid Cell Width');
    this.bindNumInput('#inp-grid-ch', (v) => {
      const px = cal.calibrated && unit !== 'px' ? convertUnitToPixels(v, unit, cal) : v;
      gr.cellHeight = Math.max(4, px);
    }, 'Grid Cell Height');

    this.container.querySelector('#inp-grid-color')?.addEventListener('input', (e) => {
      gr.color = e.target.value;
      this.app.renderCanvas();
    });
    this.container.querySelector('#inp-grid-color')?.addEventListener('change', () => this.app.onStateChanged());

    this.bindNumInput('#inp-grid-thick', (v) => {
      gr.thickness = Math.max(0.5, Math.min(6, v));
    }, 'Grid Thickness');

    this.container.querySelector('#sel-grid-style')?.addEventListener('change', (e) => {
      this.app.pushUndo('Grid Style');
      gr.style = e.target.value;
      this.app.onStateChanged();
    });

    this.container.querySelector('#inp-grid-opacity')?.addEventListener('input', (e) => {
      gr.opacity = Number(e.target.value);
      this.app.renderCanvas();
    });
    this.container.querySelector('#inp-grid-opacity')?.addEventListener('change', () => this.app.onStateChanged());

    this.container.querySelectorAll('[data-guide-toggle]').forEach((chk) => {
      chk.addEventListener('change', () => {
        this.app.pushUndo('Toggle Guide');
        g[chk.dataset.guideToggle] = chk.checked;
        this.app.onStateChanged();
      });
    });

    this.container.querySelector('#chk-sym-enabled')?.addEventListener('change', (e) => {
      this.app.pushUndo('Toggle Symmetry Guide');
      g.symmetry.enabled = e.target.checked;
      this.app.onStateChanged();
    });
    this.container.querySelector('#sel-sym-axis')?.addEventListener('change', (e) => {
      this.app.pushUndo('Symmetry Axis');
      g.symmetry.axis = e.target.value;
      this.app.onStateChanged();
    });
    this.bindNumInput('#inp-sym-offset', (v) => {
      g.symmetry.offset = v;
    }, 'Symmetry Offset');

    this.container.querySelector('#inp-guide-color')?.addEventListener('input', (e) => {
      g.guideColor = e.target.value;
      this.app.renderCanvas();
    });
    this.container.querySelector('#inp-guide-color')?.addEventListener('change', () => this.app.onStateChanged());
    this.bindNumInput('#inp-guide-thick', (v) => {
      g.guideThickness = Math.max(0.5, Math.min(5, v));
    }, 'Guide Thickness');
    this.bindNumInput('#inp-guide-opacity', (v) => {
      g.guideOpacity = Math.max(0.05, Math.min(1, v));
    }, 'Guide Opacity');

    this.container.querySelector('#chk-custom-guides')?.addEventListener('change', (e) => {
      this.app.pushUndo('Toggle Custom Guides');
      g.showCustomGuides = e.target.checked;
      this.app.onStateChanged();
    });
    this.container.querySelectorAll('[data-sub]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.subTools.guides = btn.dataset.sub;
        this.app.onStateChanged({ skipHistory: true, skipAutosave: true });
      });
    });
  }

  renderCropScaleInspector(state) {
    const c = state.crop;
    const cal = state.calibration;
    const pxDist = cal.p1 && cal.p2 ? Math.hypot(cal.p2.x - cal.p1.x, cal.p2.y - cal.p1.y) : 0;

    this.container.innerHTML = `
      <div class="panel-section">
        <div class="section-header">
          <h3 class="section-title">Non-Destructive Crop</h3>
          <span class="section-subtitle">${c.applied ? 'Active' : 'Full Frame'}</span>
        </div>
        <div class="field">
          <span class="field-label">Aspect Ratio Preset</span>
          <select id="sel-crop-aspect" class="select">
            <option value="free" ${c.aspectPreset === 'free' ? 'selected' : ''}>Free Crop</option>
            <option value="1:1" ${c.aspectPreset === '1:1' ? 'selected' : ''}>1 : 1 (Square)</option>
            <option value="4:3" ${c.aspectPreset === '4:3' ? 'selected' : ''}>4 : 3</option>
            <option value="3:2" ${c.aspectPreset === '3:2' ? 'selected' : ''}>3 : 2</option>
            <option value="16:9" ${c.aspectPreset === '16:9' ? 'selected' : ''}>16 : 9</option>
            <option value="custom" ${c.aspectPreset === 'custom' ? 'selected' : ''}>Custom Ratio</option>
          </select>
        </div>
        ${
          c.aspectPreset === 'custom'
            ? `<div class="prop-grid-2">
                <div class="field"><span class="field-label">Aspect W</span><input id="inp-crop-cw" type="number" min="0.1" step="0.1" class="input input-mono" value="${c.customW}" /></div>
                <div class="field"><span class="field-label">Aspect H</span><input id="inp-crop-ch" type="number" min="0.1" step="0.1" class="input input-mono" value="${c.customH}" /></div>
              </div>`
            : ''
        }
        <div class="prop-grid-2">
          <div class="field"><span class="field-label">Crop X (px)</span><input id="inp-crop-x" type="number" class="input input-mono" value="${Math.round(c.draftX)}" /></div>
          <div class="field"><span class="field-label">Crop Y (px)</span><input id="inp-crop-y" type="number" class="input input-mono" value="${Math.round(c.draftY)}" /></div>
          <div class="field"><span class="field-label">Width (px)</span><input id="inp-crop-w" type="number" class="input input-mono" value="${Math.round(c.draftWidth)}" /></div>
          <div class="field"><span class="field-label">Height (px)</span><input id="inp-crop-h" type="number" class="input input-mono" value="${Math.round(c.draftHeight)}" /></div>
        </div>
        <div class="action-row">
          <button type="button" class="btn btn-sm btn-primary" id="btn-crop-apply">Apply Crop</button>
          <button type="button" class="btn btn-sm btn-secondary" id="btn-crop-cancel">Cancel</button>
          <button type="button" class="btn btn-sm btn-ghost-danger" id="btn-crop-reset">Reset Crop</button>
        </div>
      </div>

      <div class="panel-section">
        <h3 class="section-title">Image Orientation</h3>
        <div class="action-row">
          <button type="button" class="btn btn-xs btn-secondary" id="btn-rot-ccw">Rotate -90°</button>
          <button type="button" class="btn btn-xs btn-secondary" id="btn-rot-cw">Rotate +90°</button>
          <button type="button" class="btn btn-xs btn-secondary" id="btn-flip-h">Flip H</button>
          <button type="button" class="btn btn-xs btn-secondary" id="btn-flip-v">Flip V</button>
        </div>
      </div>

      <div class="panel-section">
        <div class="section-header">
          <h3 class="section-title">Measurement Scale Reference</h3>
          <span class="section-subtitle">${cal.calibrated ? 'Calibrated' : 'Uncalibrated'}</span>
        </div>
        <div class="kv-table">
          <div class="kv-row"><span class="kv-key">Reference Distance</span><span class="kv-val tabular-nums">${pxDist > 0 ? `${pxDist.toFixed(2)} px` : 'Not selected'}</span></div>
        </div>
        <div class="prop-grid-2">
          <div class="field">
            <span class="field-label">Known Length</span>
            <input id="inp-cal-val" type="number" min="0.0001" step="any" class="input input-mono" value="${cal.realValue || 10}" />
          </div>
          <div class="field">
            <span class="field-label">Reference Unit</span>
            <select id="sel-cal-unit" class="select">
              ${SUPPORTED_UNITS.filter((u) => u !== 'px')
                .map((u) => `<option value="${u}" ${cal.realUnit === u ? 'selected' : ''}>${u}</option>`)
                .join('')}
            </select>
          </div>
        </div>
        <div class="action-row">
          <button type="button" class="btn btn-sm btn-primary" id="btn-cal-pick">Pick 2 Points on Canvas</button>
          <button type="button" class="btn btn-sm btn-secondary" id="btn-cal-apply" ${pxDist > 0 ? '' : 'disabled'}>Set Scale</button>
          ${cal.calibrated ? `<button type="button" class="btn btn-sm btn-ghost-danger" id="btn-cal-clear">Clear</button>` : ''}
        </div>
        <div class="callout-note">
          A scale calibrated from one image dimension serves as an <strong>image measurement reference</strong>. It does not guarantee physical accuracy across depth planes when a photograph contains perspective distortion.
        </div>
      </div>
    `;

    // Crop bindings
    this.container.querySelector('#sel-crop-aspect')?.addEventListener('change', (e) => {
      c.aspectPreset = e.target.value;
      const ratio = getTargetAspectRatio(c);
      if (ratio) {
        const res = enforceCropBoundsAndAspect(
          { x: c.draftX, y: c.draftY, width: c.draftWidth, height: c.draftHeight },
          state.image.width,
          state.image.height,
          ratio
        );
        c.draftX = res.x;
        c.draftY = res.y;
        c.draftWidth = res.width;
        c.draftHeight = res.height;
      }
      this.app.onStateChanged({ skipHistory: true, skipAutosave: true });
    });

    this.bindNumInput('#inp-crop-cw', (v) => {
      c.customW = Math.max(0.1, v);
    }, 'Crop Aspect W', true);
    this.bindNumInput('#inp-crop-ch', (v) => {
      c.customH = Math.max(0.1, v);
    }, 'Crop Aspect H', true);

    this.bindNumInput('#inp-crop-x', (v) => {
      c.draftX = Math.max(0, Math.min(state.image.width - c.draftWidth, v));
    }, 'Crop X', true);
    this.bindNumInput('#inp-crop-y', (v) => {
      c.draftY = Math.max(0, Math.min(state.image.height - c.draftHeight, v));
    }, 'Crop Y', true);
    this.bindNumInput('#inp-crop-w', (v) => {
      c.draftWidth = Math.max(20, Math.min(state.image.width - c.draftX, v));
    }, 'Crop Width', true);
    this.bindNumInput('#inp-crop-h', (v) => {
      c.draftHeight = Math.max(20, Math.min(state.image.height - c.draftY, v));
    }, 'Crop Height', true);

    this.container.querySelector('#btn-crop-apply')?.addEventListener('click', () => {
      this.app.tools.cropScale.applyCrop(state);
    });
    this.container.querySelector('#btn-crop-cancel')?.addEventListener('click', () => {
      this.app.tools.cropScale.cancelCrop(state);
    });
    this.container.querySelector('#btn-crop-reset')?.addEventListener('click', () => {
      this.app.tools.cropScale.resetCrop(state);
    });

    this.container.querySelector('#btn-rot-ccw')?.addEventListener('click', () => {
      this.app.pushUndo('Rotate Image -90°');
      rotateWorkspace90(state, -1);
      this.app.fitToScreen();
      this.app.onStateChanged();
    });
    this.container.querySelector('#btn-rot-cw')?.addEventListener('click', () => {
      this.app.pushUndo('Rotate Image +90°');
      rotateWorkspace90(state, 1);
      this.app.fitToScreen();
      this.app.onStateChanged();
    });
    this.container.querySelector('#btn-flip-h')?.addEventListener('click', () => {
      this.app.pushUndo('Flip Horizontal');
      flipWorkspace(state, 'h');
      this.app.onStateChanged();
    });
    this.container.querySelector('#btn-flip-v')?.addEventListener('click', () => {
      this.app.pushUndo('Flip Vertical');
      flipWorkspace(state, 'v');
      this.app.onStateChanged();
    });

    // Scale bindings
    this.container.querySelector('#btn-cal-pick')?.addEventListener('click', () => {
      state.subTools.cropScale = 'scale';
      this.app.tools.cropScale.cancel();
      this.app.onStateChanged({ skipHistory: true, skipAutosave: true });
    });

    this.container.querySelector('#btn-cal-apply')?.addEventListener('click', () => {
      const val = Number(this.container.querySelector('#inp-cal-val').value);
      const u = this.container.querySelector('#sel-cal-unit').value;
      if (!Number.isFinite(val) || val <= 0) {
        this.app.notify('Enter a valid positive reference length.', 'error');
        return;
      }
      if (!cal.p1 || !cal.p2) {
        this.app.notify('Select two points on the image first.', 'error');
        return;
      }
      this.app.pushUndo('Calibrate Scale');
      cal.pixelDistance = Math.hypot(cal.p2.x - cal.p1.x, cal.p2.y - cal.p1.y);
      cal.realValue = val;
      cal.realUnit = u;
      cal.displayUnit = u;
      cal.calibrated = true;
      this.app.notify(`Scale calibrated: ${cal.pixelDistance.toFixed(1)} px = ${val} ${u}`, 'success');
      this.app.onStateChanged();
    });

    this.container.querySelector('#btn-cal-clear')?.addEventListener('click', () => {
      this.app.pushUndo('Clear Calibration');
      cal.calibrated = false;
      cal.displayUnit = 'px';
      this.app.onStateChanged();
    });
  }

  renderLineToolDefaults(state) {
    const td = state.toolDefaults;
    this.container.innerHTML = `
      <div class="panel-section">
        <h3 class="section-title">Line Measurement Defaults</h3>
        <div class="prop-grid-3">
          <div class="field"><span class="field-label">Color</span><input id="def-line-color" type="color" class="color-input" value="${td.lineColor}" /></div>
          <div class="field"><span class="field-label">Thickness</span><input id="def-line-thick" type="number" min="1" max="10" step="0.5" class="input input-mono" value="${td.lineThickness}" /></div>
          <div class="field"><span class="field-label">Opacity</span><input id="def-line-op" type="number" min="0.1" max="1" step="0.1" class="input input-mono" value="${td.lineOpacity}" /></div>
        </div>
        <p class="section-subtitle">Click two points or drag on the canvas to draw a line. Hold Shift to snap to 45° increments.</p>
      </div>
    `;
    this.container.querySelector('#def-line-color')?.addEventListener('input', (e) => {
      td.lineColor = e.target.value;
    });
    this.container.querySelector('#def-line-thick')?.addEventListener('change', (e) => {
      td.lineThickness = Math.max(1, Number(e.target.value) || 2);
    });
    this.container.querySelector('#def-line-op')?.addEventListener('change', (e) => {
      td.lineOpacity = Math.max(0.1, Math.min(1, Number(e.target.value) || 1));
    });
  }

  renderShapeToolDefaults(state) {
    const td = state.toolDefaults;
    this.container.innerHTML = `
      <div class="panel-section">
        <h3 class="section-title">Shape Construction Defaults</h3>
        <div class="prop-grid-2">
          <div class="field"><span class="field-label">Border Color</span><input id="def-sh-bcolor" type="color" class="color-input" value="${td.shapeBorderColor}" /></div>
          <div class="field"><span class="field-label">Fill Color</span><input id="def-sh-fcolor" type="color" class="color-input" value="${td.shapeFillColor}" /></div>
          <div class="field"><span class="field-label">Border Width</span><input id="def-sh-thick" type="number" min="1" max="12" step="0.5" class="input input-mono" value="${td.shapeBorderThickness}" /></div>
          <div class="field"><span class="field-label">Fill Opacity</span><input id="def-sh-fop" type="number" min="0" max="1" step="0.05" class="input input-mono" value="${td.shapeFillOpacity}" /></div>
        </div>
        ${
          state.subTools.shape === 'polygon'
            ? `<div class="field"><span class="field-label">Polygon Sides</span><input id="def-sh-sides" type="number" min="3" max="16" class="input input-mono" value="${td.polygonSides}" /></div>`
            : ''
        }
      </div>
    `;
    this.container.querySelector('#def-sh-bcolor')?.addEventListener('input', (e) => (td.shapeBorderColor = e.target.value));
    this.container.querySelector('#def-sh-fcolor')?.addEventListener('input', (e) => (td.shapeFillColor = e.target.value));
    this.container.querySelector('#def-sh-thick')?.addEventListener('change', (e) => (td.shapeBorderThickness = Math.max(1, Number(e.target.value) || 2)));
    this.container.querySelector('#def-sh-fop')?.addEventListener('change', (e) => (td.shapeFillOpacity = Math.max(0, Math.min(1, Number(e.target.value)))));
    this.container.querySelector('#def-sh-sides')?.addEventListener('change', (e) => (td.polygonSides = Math.max(3, Math.min(16, Math.round(Number(e.target.value) || 5)))));
  }

  renderAngleToolDefaults(state) {
    const td = state.toolDefaults;
    const selectedLines = state.lines.filter((l) => state.selectedIds.includes(l.id));
    this.container.innerHTML = `
      <div class="panel-section">
        <h3 class="section-title">Angle Measurement Defaults</h3>
        <div class="prop-grid-2">
          <div class="field"><span class="field-label">Arc Color</span><input id="def-ang-color" type="color" class="color-input" value="${td.angleArcColor}" /></div>
          <div class="field"><span class="field-label">Arc Thickness</span><input id="def-ang-thick" type="number" min="1" max="8" step="0.5" class="input input-mono" value="${td.angleArcThickness}" /></div>
          <div class="field"><span class="field-label">Arc Radius (px)</span><input id="def-ang-rad" type="number" min="14" max="160" class="input input-mono" value="${td.angleArcRadius}" /></div>
          <div class="field"><span class="field-label">Decimals</span><input id="def-ang-prec" type="number" min="0" max="3" class="input input-mono" value="${td.anglePrecision}" /></div>
        </div>
        ${
          state.subTools.angle === 'fromLines'
            ? `<div class="action-row" style="margin-top:6px;">
                <button type="button" class="btn btn-sm btn-primary" id="btn-create-angle-lines" ${selectedLines.length === 2 ? '' : 'disabled'}>
                  Measure Angle (${selectedLines.length}/2 lines selected)
                </button>
              </div>`
            : ''
        }
      </div>
    `;
    this.container.querySelector('#def-ang-color')?.addEventListener('input', (e) => (td.angleArcColor = e.target.value));
    this.container.querySelector('#def-ang-thick')?.addEventListener('change', (e) => (td.angleArcThickness = Math.max(1, Number(e.target.value) || 2)));
    this.container.querySelector('#def-ang-rad')?.addEventListener('change', (e) => (td.angleArcRadius = Math.max(14, Number(e.target.value) || 42)));
    this.container.querySelector('#def-ang-prec')?.addEventListener('change', (e) => (td.anglePrecision = Math.max(0, Math.min(3, Math.round(Number(e.target.value) || 1)))));
    this.container.querySelector('#btn-create-angle-lines')?.addEventListener('click', () => {
      this.app.tools.angle.createAngleFromSelectedLines(state);
    });
  }

  renderLineInspector(state, line) {
    const m = computeLineMetrics(line.p1, line.p2);
    const cal = state.calibration;
    const unit = cal.displayUnit;
    const prec = cal.precision ?? 2;
    const lockedAttr = line.locked ? 'disabled' : '';

    this.container.innerHTML = `
      <div class="panel-section">
        <div class="section-header">
          <h3 class="section-title">Line Properties</h3>
          <div class="action-row">
            <button type="button" class="btn btn-xs btn-secondary" id="btn-obj-dup">Duplicate</button>
            <button type="button" class="btn btn-xs btn-ghost-danger" id="btn-obj-del">Delete</button>
          </div>
        </div>
        <div class="field">
          <span class="field-label">Name</span>
          <input id="inp-line-name" type="text" class="input" value="${this.escape(line.name)}" />
        </div>
        <div class="prop-grid-3">
          <div class="field"><span class="field-label">Color</span><input id="inp-line-color" type="color" class="color-input" value="${line.color}" /></div>
          <div class="field"><span class="field-label">Thickness</span><input id="inp-line-thick" type="number" min="1" max="12" step="0.5" class="input input-mono" value="${line.thickness}" /></div>
          <div class="field"><span class="field-label">Opacity</span><input id="inp-line-op" type="number" min="0.1" max="1" step="0.05" class="input input-mono" value="${line.opacity}" /></div>
        </div>
        <div class="action-row">
          <label class="checkbox-row" style="flex:1;"><span>Visible</span><input id="chk-line-vis" type="checkbox" ${line.visible !== false ? 'checked' : ''} /></label>
          <label class="checkbox-row" style="flex:1;"><span>Locked</span><input id="chk-line-lock" type="checkbox" ${line.locked ? 'checked' : ''} /></label>
        </div>
      </div>

      <div class="panel-section">
        <h3 class="section-title">Line Measurements</h3>
        <div class="kv-table">
          <div class="kv-row"><span class="kv-key">Total Length</span><span class="kv-val tabular-nums">${formatLength(m.lengthPx, unit, cal, prec)}</span></div>
          <div class="kv-row"><span class="kv-key">Pixel Length</span><span class="kv-val tabular-nums">${m.lengthPx.toFixed(2)} px</span></div>
          <div class="kv-row"><span class="kv-key">Horizontal (&Delta;X)</span><span class="kv-val tabular-nums">${formatLength(m.absDx, unit, cal, prec)}</span></div>
          <div class="kv-row"><span class="kv-key">Vertical (&Delta;Y)</span><span class="kv-val tabular-nums">${formatLength(m.absDy, unit, cal, prec)}</span></div>
          <div class="kv-row"><span class="kv-key">Angle (Horizontal)</span><span class="kv-val tabular-nums">${m.horizontalAcuteDeg.toFixed(2)}° (${m.angleDeg.toFixed(1)}°)</span></div>
        </div>
      </div>

      <div class="panel-section">
        <h3 class="section-title">Endpoints (Image Space px)</h3>
        <div class="prop-grid-2">
          <div class="field"><span class="field-label">P1 X</span><input id="inp-l-p1x" type="number" step="0.5" class="input input-mono" value="${line.p1.x.toFixed(1)}" ${lockedAttr} /></div>
          <div class="field"><span class="field-label">P1 Y</span><input id="inp-l-p1y" type="number" step="0.5" class="input input-mono" value="${line.p1.y.toFixed(1)}" ${lockedAttr} /></div>
          <div class="field"><span class="field-label">P2 X</span><input id="inp-l-p2x" type="number" step="0.5" class="input input-mono" value="${line.p2.x.toFixed(1)}" ${lockedAttr} /></div>
          <div class="field"><span class="field-label">P2 Y</span><input id="inp-l-p2y" type="number" step="0.5" class="input input-mono" value="${line.p2.y.toFixed(1)}" ${lockedAttr} /></div>
        </div>
      </div>
    `;

    this.container.querySelector('#btn-obj-dup')?.addEventListener('click', () => {
      this.app.pushUndo('Duplicate Line');
      duplicateObjectById(state, 'line', line.id);
      this.app.onStateChanged();
    });
    this.container.querySelector('#btn-obj-del')?.addEventListener('click', () => {
      this.app.pushUndo('Delete Line');
      deleteObjectById(state, 'line', line.id);
      this.app.onStateChanged();
    });
    this.container.querySelector('#inp-line-name')?.addEventListener('change', (e) => {
      this.app.pushUndo('Rename Line');
      line.name = e.target.value.trim() || line.name;
      this.app.onStateChanged();
    });
    this.container.querySelector('#inp-line-color')?.addEventListener('input', (e) => {
      line.color = e.target.value;
      this.app.renderCanvas();
    });
    this.container.querySelector('#inp-line-color')?.addEventListener('change', () => this.app.onStateChanged());
    this.bindNumInput('#inp-line-thick', (v) => (line.thickness = Math.max(0.5, v)), 'Line Thickness');
    this.bindNumInput('#inp-line-op', (v) => (line.opacity = Math.max(0.05, Math.min(1, v))), 'Line Opacity');
    this.container.querySelector('#chk-line-vis')?.addEventListener('change', (e) => {
      this.app.pushUndo('Toggle Line Visibility');
      line.visible = e.target.checked;
      this.app.onStateChanged();
    });
    this.container.querySelector('#chk-line-lock')?.addEventListener('change', (e) => {
      this.app.pushUndo('Toggle Line Lock');
      line.locked = e.target.checked;
      this.app.onStateChanged();
    });

    this.bindNumInput('#inp-l-p1x', (v) => (line.p1.x = v), 'Move Line Point');
    this.bindNumInput('#inp-l-p1y', (v) => (line.p1.y = v), 'Move Line Point');
    this.bindNumInput('#inp-l-p2x', (v) => (line.p2.x = v), 'Move Line Point');
    this.bindNumInput('#inp-l-p2y', (v) => (line.p2.y = v), 'Move Line Point');
  }

  renderShapeInspector(state, shape) {
    const m = computeShapeMeasurements(shape);
    const cal = state.calibration;
    const unit = cal.displayUnit;
    const prec = cal.precision ?? 2;
    const lockedAttr = shape.locked ? 'disabled' : '';

    this.container.innerHTML = `
      <div class="panel-section">
        <div class="section-header">
          <h3 class="section-title">Shape Properties</h3>
          <div class="action-row">
            <button type="button" class="btn btn-xs btn-secondary" id="btn-obj-dup">Duplicate</button>
            <button type="button" class="btn btn-xs btn-ghost-danger" id="btn-obj-del">Delete</button>
          </div>
        </div>
        <div class="field">
          <span class="field-label">Name</span>
          <input id="inp-sh-name" type="text" class="input" value="${this.escape(shape.name)}" />
        </div>
        <div class="prop-grid-2">
          <div class="field"><span class="field-label">X (px)</span><input id="inp-sh-x" type="number" step="0.5" class="input input-mono" value="${shape.x.toFixed(1)}" ${lockedAttr} /></div>
          <div class="field"><span class="field-label">Y (px)</span><input id="inp-sh-y" type="number" step="0.5" class="input input-mono" value="${shape.y.toFixed(1)}" ${lockedAttr} /></div>
          <div class="field"><span class="field-label">Width (px)</span><input id="inp-sh-w" type="number" min="2" step="0.5" class="input input-mono" value="${shape.width.toFixed(1)}" ${lockedAttr} /></div>
          <div class="field"><span class="field-label">Height (px)</span><input id="inp-sh-h" type="number" min="2" step="0.5" class="input input-mono" value="${shape.height.toFixed(1)}" ${lockedAttr} /></div>
        </div>
        <div class="prop-grid-3">
          <div class="field"><span class="field-label">Rotation (°)</span><input id="inp-sh-rot" type="number" step="1" class="input input-mono" value="${(shape.rotation || 0).toFixed(1)}" ${lockedAttr} /></div>
          <div class="field"><span class="field-label">Scale X</span><input id="inp-sh-sx" type="number" min="0.1" max="10" step="0.05" class="input input-mono" value="${(shape.scaleX ?? 1).toFixed(2)}" ${lockedAttr} /></div>
          <div class="field"><span class="field-label">Scale Y</span><input id="inp-sh-sy" type="number" min="0.1" max="10" step="0.05" class="input input-mono" value="${(shape.scaleY ?? 1).toFixed(2)}" ${lockedAttr} /></div>
        </div>
        <div class="prop-grid-2">
          <div class="field"><span class="field-label">Skew X (°)</span><input id="inp-sh-kx" type="number" min="-75" max="75" step="1" class="input input-mono" value="${(shape.skewX || 0).toFixed(1)}" ${lockedAttr} /></div>
          <div class="field"><span class="field-label">Skew Y (°)</span><input id="inp-sh-ky" type="number" min="-75" max="75" step="1" class="input input-mono" value="${(shape.skewY || 0).toFixed(1)}" ${lockedAttr} /></div>
        </div>
        ${
          shape.type === 'polygon'
            ? `<div class="field"><span class="field-label">Polygon Sides</span><input id="inp-sh-sides" type="number" min="3" max="16" class="input input-mono" value="${shape.sides || 5}" ${lockedAttr} /></div>`
            : ''
        }
        <div class="prop-grid-2">
          <div class="field"><span class="field-label">Border Color</span><input id="inp-sh-bc" type="color" class="color-input" value="${shape.borderColor}" /></div>
          <div class="field"><span class="field-label">Fill Color</span><input id="inp-sh-fc" type="color" class="color-input" value="${shape.fillColor}" /></div>
          <div class="field"><span class="field-label">Border px</span><input id="inp-sh-bt" type="number" min="0.5" max="14" step="0.5" class="input input-mono" value="${shape.borderThickness}" /></div>
          <div class="field"><span class="field-label">Fill Opacity</span><input id="inp-sh-fo" type="number" min="0" max="1" step="0.05" class="input input-mono" value="${shape.fillOpacity}" /></div>
        </div>
        <div class="action-row">
          <label class="checkbox-row" style="flex:1;"><span>Lock Aspect</span><input id="chk-sh-aspect" type="checkbox" ${shape.aspectLocked ? 'checked' : ''} /></label>
          <label class="checkbox-row" style="flex:1;"><span>Locked</span><input id="chk-sh-lock" type="checkbox" ${shape.locked ? 'checked' : ''} /></label>
        </div>
      </div>

      <div class="panel-section">
        <div class="section-header">
          <h3 class="section-title">Perspective &amp; Distortion</h3>
        </div>
        <label class="checkbox-row">
          <span>4-Corner Perspective Homography</span>
          <input id="chk-sh-persp" type="checkbox" ${shape.perspectiveEnabled ? 'checked' : ''} ${lockedAttr} />
        </label>
        <label class="checkbox-row">
          <span>Show Internal Construction Grid</span>
          <input id="chk-sh-pgrid" type="checkbox" ${shape.showPerspectiveGrid ? 'checked' : ''} />
        </label>
        ${
          shape.type === 'customPolygon' || shape.type === 'freehand'
            ? `<label class="checkbox-row"><span>Edit Individual Vertices</span><input id="chk-sh-editverts" type="checkbox" ${shape.editVertices ? 'checked' : ''} /></label>`
            : ''
        }
        <div class="action-row">
          <button type="button" class="btn btn-xs btn-secondary" id="btn-sh-reset-dist" ${lockedAttr}>Reset Distortion</button>
        </div>
      </div>

      <div class="panel-section">
        <div class="section-header">
          <h3 class="section-title">${m.isDistorted ? 'Displayed (Distorted) Geometry' : 'Shape Measurements'}</h3>
        </div>
        <div class="kv-table">
          <div class="kv-row"><span class="kv-key">Width &times; Height</span><span class="kv-val tabular-nums">${formatLength(m.displayed.widthPx, unit, cal, prec)} &times; ${formatLength(m.displayed.heightPx, unit, cal, prec)}</span></div>
          <div class="kv-row"><span class="kv-key">Aspect Ratio</span><span class="kv-val tabular-nums">${m.displayed.aspectRatio.toFixed(prec)} : 1</span></div>
          <div class="kv-row"><span class="kv-key">Perimeter</span><span class="kv-val tabular-nums">${formatLength(m.displayed.perimeterPx, unit, cal, prec)}</span></div>
          <div class="kv-row"><span class="kv-key">Area</span><span class="kv-val tabular-nums">${formatArea(m.displayed.areaPx2, unit, cal, prec)}</span></div>
          ${
            m.displayed.diagonalsPx.length
              ? `<div class="kv-row"><span class="kv-key">Diagonals</span><span class="kv-val tabular-nums">${m.displayed.diagonalsPx.slice(0, 2).map((d) => formatLength(d.lengthPx, unit, cal, prec)).join(' / ')}</span></div>`
              : ''
          }
          ${
            m.displayed.sideLengthsPx.length && m.displayed.sideLengthsPx.length <= 8
              ? `<div class="kv-row"><span class="kv-key">Side Lengths</span><span class="kv-val tabular-nums">${m.displayed.sideLengthsPx.map((s) => formatLength(s, unit, cal, prec)).join(', ')}</span></div>`
              : ''
          }
          ${
            m.displayed.internalAnglesDeg.length && m.displayed.internalAnglesDeg.length <= 8
              ? `<div class="kv-row"><span class="kv-key">Internal Angles</span><span class="kv-val tabular-nums">${m.displayed.internalAnglesDeg.map((a) => `${a.toFixed(1)}°`).join(', ')}</span></div>`
              : ''
          }
        </div>
        ${
          m.isDistorted
            ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle);">
                <div class="section-subtitle" style="margin-bottom:4px;">Original (Unwarped) Geometry</div>
                <div class="kv-table">
                  <div class="kv-row"><span class="kv-key">Orig W &times; H</span><span class="kv-val tabular-nums">${formatLength(m.original.widthPx, unit, cal, prec)} &times; ${formatLength(m.original.heightPx, unit, cal, prec)}</span></div>
                  <div class="kv-row"><span class="kv-key">Orig Aspect</span><span class="kv-val tabular-nums">${m.original.aspectRatio.toFixed(prec)} : 1</span></div>
                  <div class="kv-row"><span class="kv-key">Orig Area</span><span class="kv-val tabular-nums">${formatArea(m.original.areaPx2, unit, cal, prec)}</span></div>
                </div>
              </div>`
            : ''
        }
      </div>
    `;

    this.container.querySelector('#btn-obj-dup')?.addEventListener('click', () => {
      this.app.pushUndo('Duplicate Shape');
      duplicateObjectById(state, 'shape', shape.id);
      this.app.onStateChanged();
    });
    this.container.querySelector('#btn-obj-del')?.addEventListener('click', () => {
      this.app.pushUndo('Delete Shape');
      deleteObjectById(state, 'shape', shape.id);
      this.app.onStateChanged();
    });
    this.container.querySelector('#inp-sh-name')?.addEventListener('change', (e) => {
      this.app.pushUndo('Rename Shape');
      shape.name = e.target.value.trim() || shape.name;
      this.app.onStateChanged();
    });

    this.bindNumInput('#inp-sh-x', (v) => (shape.x = v), 'Shape X');
    this.bindNumInput('#inp-sh-y', (v) => (shape.y = v), 'Shape Y');
    this.bindNumInput('#inp-sh-w', (v) => {
      const oldW = shape.width;
      const newW = Math.max(2, v);
      if (shape.aspectLocked && oldW > 0) shape.height = shape.height * (newW / oldW);
      shape.width = newW;
    }, 'Shape Width');
    this.bindNumInput('#inp-sh-h', (v) => {
      const oldH = shape.height;
      const newH = Math.max(2, v);
      if (shape.aspectLocked && oldH > 0) shape.width = shape.width * (newH / oldH);
      shape.height = newH;
    }, 'Shape Height');
    this.bindNumInput('#inp-sh-rot', (v) => (shape.rotation = ((v % 360) + 360) % 360), 'Shape Rotation');
    this.bindNumInput('#inp-sh-sx', (v) => (shape.scaleX = Math.max(0.05, v)), 'Shape Scale X');
    this.bindNumInput('#inp-sh-sy', (v) => (shape.scaleY = Math.max(0.05, v)), 'Shape Scale Y');
    this.bindNumInput('#inp-sh-kx', (v) => (shape.skewX = Math.max(-75, Math.min(75, v))), 'Shape Skew X');
    this.bindNumInput('#inp-sh-ky', (v) => (shape.skewY = Math.max(-75, Math.min(75, v))), 'Shape Skew Y');
    this.bindNumInput('#inp-sh-sides', (v) => (shape.sides = Math.max(3, Math.min(16, Math.round(v)))), 'Polygon Sides');

    this.container.querySelector('#inp-sh-bc')?.addEventListener('input', (e) => {
      shape.borderColor = e.target.value;
      this.app.renderCanvas();
    });
    this.container.querySelector('#inp-sh-bc')?.addEventListener('change', () => this.app.onStateChanged());
    this.container.querySelector('#inp-sh-fc')?.addEventListener('input', (e) => {
      shape.fillColor = e.target.value;
      this.app.renderCanvas();
    });
    this.container.querySelector('#inp-sh-fc')?.addEventListener('change', () => this.app.onStateChanged());
    this.bindNumInput('#inp-sh-bt', (v) => (shape.borderThickness = Math.max(0.5, v)), 'Border Width');
    this.bindNumInput('#inp-sh-fo', (v) => (shape.fillOpacity = Math.max(0, Math.min(1, v))), 'Fill Opacity');

    this.container.querySelector('#chk-sh-aspect')?.addEventListener('change', (e) => {
      shape.aspectLocked = e.target.checked;
      this.app.onStateChanged({ skipHistory: true });
    });
    this.container.querySelector('#chk-sh-lock')?.addEventListener('change', (e) => {
      this.app.pushUndo('Toggle Shape Lock');
      shape.locked = e.target.checked;
      this.app.onStateChanged();
    });
    this.container.querySelector('#chk-sh-persp')?.addEventListener('change', (e) => {
      this.app.pushUndo('Toggle Perspective Distortion');
      toggleShapePerspective(shape, e.target.checked);
      this.app.onStateChanged();
    });
    this.container.querySelector('#chk-sh-pgrid')?.addEventListener('change', (e) => {
      this.app.pushUndo('Toggle Construction Grid');
      shape.showPerspectiveGrid = e.target.checked;
      this.app.onStateChanged();
    });
    this.container.querySelector('#chk-sh-editverts')?.addEventListener('change', (e) => {
      shape.editVertices = e.target.checked;
      this.app.onStateChanged({ skipHistory: true, skipAutosave: true });
    });
    this.container.querySelector('#btn-sh-reset-dist')?.addEventListener('click', () => {
      this.app.pushUndo('Reset Shape Distortion');
      resetShapeDistortion(shape);
      this.app.onStateChanged();
    });
  }

  renderAngleInspector(state, ang) {
    const m = computeAngleMetrics(ang.p1, ang.vertex, ang.p2);
    const ap = ang.precision ?? 1;

    this.container.innerHTML = `
      <div class="panel-section">
        <div class="section-header">
          <h3 class="section-title">Angle Properties</h3>
          <div class="action-row">
            <button type="button" class="btn btn-xs btn-secondary" id="btn-obj-dup">Duplicate</button>
            <button type="button" class="btn btn-xs btn-ghost-danger" id="btn-obj-del">Delete</button>
          </div>
        </div>
        <div class="field">
          <span class="field-label">Name</span>
          <input id="inp-ang-name" type="text" class="input" value="${this.escape(ang.name)}" />
        </div>
        <div class="prop-grid-2">
          <div class="field"><span class="field-label">Arc Color</span><input id="inp-ang-col" type="color" class="color-input" value="${ang.arcColor}" /></div>
          <div class="field"><span class="field-label">Arc Thickness</span><input id="inp-ang-thick" type="number" min="1" max="8" step="0.5" class="input input-mono" value="${ang.arcThickness}" /></div>
          <div class="field"><span class="field-label">Arc Radius</span><input id="inp-ang-rad" type="number" min="12" max="180" class="input input-mono" value="${ang.arcRadius}" /></div>
          <div class="field"><span class="field-label">Text Size</span><input id="inp-ang-tsize" type="number" min="9" max="24" class="input input-mono" value="${ang.textSize || 12}" /></div>
          <div class="field"><span class="field-label">Label Position</span>
            <select id="sel-ang-lpos" class="select">
              <option value="auto" ${ang.labelPosition === 'auto' ? 'selected' : ''}>Auto</option>
              <option value="inside" ${ang.labelPosition === 'inside' ? 'selected' : ''}>Inside Arc</option>
              <option value="outside" ${ang.labelPosition === 'outside' ? 'selected' : ''}>Outside Arc</option>
            </select>
          </div>
          <div class="field"><span class="field-label">Decimals</span><input id="inp-ang-prec" type="number" min="0" max="3" class="input input-mono" value="${ap}" /></div>
        </div>
        <label class="checkbox-row"><span>Show Reflex Arc</span><input id="chk-ang-reflex" type="checkbox" ${ang.showReflex ? 'checked' : ''} /></label>
        <label class="checkbox-row"><span>Show Exterior Label</span><input id="chk-ang-ext" type="checkbox" ${ang.showExterior ? 'checked' : ''} /></label>
        <label class="checkbox-row"><span>Locked</span><input id="chk-ang-lock" type="checkbox" ${ang.locked ? 'checked' : ''} /></label>
      </div>

      <div class="panel-section">
        <h3 class="section-title">Angle Calculations</h3>
        <div class="kv-table">
          <div class="kv-row"><span class="kv-key">Interior Angle</span><span class="kv-val tabular-nums">${m.interiorDeg.toFixed(ap)}° (${m.classification})</span></div>
          <div class="kv-row"><span class="kv-key">Exterior (Suppl.)</span><span class="kv-val tabular-nums">${m.exteriorDeg.toFixed(ap)}°</span></div>
          <div class="kv-row"><span class="kv-key">Acute Equivalent</span><span class="kv-val tabular-nums">${m.acuteDeg.toFixed(ap)}°</span></div>
          <div class="kv-row"><span class="kv-key">Obtuse Equivalent</span><span class="kv-val tabular-nums">${m.obtuseDeg.toFixed(ap)}°</span></div>
          <div class="kv-row"><span class="kv-key">Reflex Angle</span><span class="kv-val tabular-nums">${m.reflexDeg.toFixed(ap)}°</span></div>
          <div class="kv-row"><span class="kv-key">Clockwise Sweep</span><span class="kv-val tabular-nums">${m.cwDeg.toFixed(ap)}°</span></div>
          <div class="kv-row"><span class="kv-key">Counterclockwise</span><span class="kv-val tabular-nums">${m.ccwDeg.toFixed(ap)}°</span></div>
        </div>
      </div>
    `;

    this.container.querySelector('#btn-obj-dup')?.addEventListener('click', () => {
      this.app.pushUndo('Duplicate Angle');
      duplicateObjectById(state, 'angle', ang.id);
      this.app.onStateChanged();
    });
    this.container.querySelector('#btn-obj-del')?.addEventListener('click', () => {
      this.app.pushUndo('Delete Angle');
      deleteObjectById(state, 'angle', ang.id);
      this.app.onStateChanged();
    });
    this.container.querySelector('#inp-ang-name')?.addEventListener('change', (e) => {
      this.app.pushUndo('Rename Angle');
      ang.name = e.target.value.trim() || ang.name;
      this.app.onStateChanged();
    });
    this.container.querySelector('#inp-ang-col')?.addEventListener('input', (e) => {
      ang.arcColor = e.target.value;
      this.app.renderCanvas();
    });
    this.container.querySelector('#inp-ang-col')?.addEventListener('change', () => this.app.onStateChanged());
    this.bindNumInput('#inp-ang-thick', (v) => (ang.arcThickness = Math.max(0.5, v)), 'Arc Thickness');
    this.bindNumInput('#inp-ang-rad', (v) => (ang.arcRadius = Math.max(10, v)), 'Arc Radius');
    this.bindNumInput('#inp-ang-tsize', (v) => (ang.textSize = Math.max(9, Math.min(28, v))), 'Text Size');
    this.bindNumInput('#inp-ang-prec', (v) => (ang.precision = Math.max(0, Math.min(3, Math.round(v)))), 'Angle Precision');
    this.container.querySelector('#sel-ang-lpos')?.addEventListener('change', (e) => {
      this.app.pushUndo('Angle Label Position');
      ang.labelPosition = e.target.value;
      this.app.onStateChanged();
    });
    this.container.querySelector('#chk-ang-reflex')?.addEventListener('change', (e) => {
      ang.showReflex = e.target.checked;
      this.app.onStateChanged();
    });
    this.container.querySelector('#chk-ang-ext')?.addEventListener('change', (e) => {
      ang.showExterior = e.target.checked;
      this.app.onStateChanged();
    });
    this.container.querySelector('#chk-ang-lock')?.addEventListener('change', (e) => {
      this.app.pushUndo('Toggle Angle Lock');
      ang.locked = e.target.checked;
      this.app.onStateChanged();
    });
  }

  renderCustomGuideInspector(state, guide) {
    this.container.innerHTML = `
      <div class="panel-section">
        <div class="section-header">
          <h3 class="section-title">Custom Guide Line</h3>
          <button type="button" class="btn btn-xs btn-ghost-danger" id="btn-obj-del">Delete</button>
        </div>
        <div class="field"><span class="field-label">Name</span><input id="inp-g-name" type="text" class="input" value="${this.escape(guide.name)}" /></div>
        ${
          guide.orientation !== 'angled'
            ? `<div class="field"><span class="field-label">Position (px)</span><input id="inp-g-pos" type="number" step="1" class="input input-mono" value="${guide.position.toFixed(1)}" ${guide.locked ? 'disabled' : ''} /></div>`
            : ''
        }
        <div class="prop-grid-3">
          <div class="field"><span class="field-label">Color</span><input id="inp-g-col" type="color" class="color-input" value="${guide.color}" /></div>
          <div class="field"><span class="field-label">Thickness</span><input id="inp-g-th" type="number" min="0.5" max="5" step="0.5" class="input input-mono" value="${guide.thickness}" /></div>
          <div class="field"><span class="field-label">Style</span>
            <select id="sel-g-st" class="select">
              <option value="solid" ${guide.style === 'solid' ? 'selected' : ''}>Solid</option>
              <option value="dashed" ${guide.style === 'dashed' ? 'selected' : ''}>Dashed</option>
              <option value="dotted" ${guide.style === 'dotted' ? 'selected' : ''}>Dotted</option>
            </select>
          </div>
        </div>
      </div>
    `;
    this.container.querySelector('#btn-obj-del')?.addEventListener('click', () => {
      this.app.pushUndo('Delete Guide');
      deleteObjectById(state, 'guideLine', guide.id);
      this.app.onStateChanged();
    });
    this.container.querySelector('#inp-g-name')?.addEventListener('change', (e) => {
      guide.name = e.target.value.trim() || guide.name;
      this.app.onStateChanged();
    });
    this.bindNumInput('#inp-g-pos', (v) => (guide.position = v), 'Move Guide');
    this.container.querySelector('#inp-g-col')?.addEventListener('input', (e) => {
      guide.color = e.target.value;
      this.app.renderCanvas();
    });
    this.bindNumInput('#inp-g-th', (v) => (guide.thickness = Math.max(0.5, v)), 'Guide Thickness');
    this.container.querySelector('#sel-g-st')?.addEventListener('change', (e) => {
      guide.style = e.target.value;
      this.app.onStateChanged();
    });
  }

  bindNumInput(selector, setterFn, undoLabel, skipPush = false) {
    const el = this.container.querySelector(selector);
    if (!el) return;
    el.addEventListener('change', () => {
      const val = Number(el.value);
      if (!Number.isFinite(val)) return;
      if (!skipPush) this.app.pushUndo(undoLabel);
      setterFn(val);
      this.app.onStateChanged(skipPush ? { skipHistory: true, skipAutosave: true } : {});
    });
  }

  escape(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
}
