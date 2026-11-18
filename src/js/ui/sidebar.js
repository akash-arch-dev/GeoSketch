/**
 * Right Sidebar Manager: Coordinates Inspector, Measurements, and Layers Tabs.
 */
import { PropertiesPanel } from './propertiesPanel.js';
import { MeasurementPanel } from './measurementPanel.js';
import {
  toggleObjectVisibility,
  toggleObjectLock,
  deleteObjectById,
  duplicateObjectById,
  reorderLayer,
} from '../layers/layerManager.js';

export class SidebarUI {
  constructor(app) {
    this.app = app;
    this.activeTab = 'inspector';
    this.tabs = Array.from(document.querySelectorAll('.sidebar-tab'));
    this.inspectorEl = document.getElementById('panel-inspector');
    this.measurementsEl = document.getElementById('panel-measurements');
    this.layersEl = document.getElementById('panel-layers');

    this.propertiesPanel = new PropertiesPanel(app, this.inspectorEl);
    this.measurementPanel = new MeasurementPanel(app, this.measurementsEl);
  }

  bind() {
    for (const tab of this.tabs) {
      tab.addEventListener('click', () => {
        this.setActiveTab(tab.dataset.tab);
      });
    }
  }

  setActiveTab(tabName) {
    this.activeTab = tabName;
    for (const tab of this.tabs) {
      const isActive = tab.dataset.tab === tabName;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
    }
    this.inspectorEl.classList.toggle('active', tabName === 'inspector');
    this.measurementsEl.classList.toggle('active', tabName === 'measurements');
    this.layersEl.classList.toggle('active', tabName === 'layers');
    this.render(this.app.state);
  }

  render(state) {
    if (this.activeTab === 'inspector') {
      this.propertiesPanel.render(state);
    } else if (this.activeTab === 'measurements') {
      this.measurementPanel.render(state);
    } else if (this.activeTab === 'layers') {
      this.renderLayers(state);
    }
  }

  refreshInspectorLive() {
    // Live update only when dragging on canvas so inputs don't lose focus while typing
    if (this.activeTab === 'inspector') {
      this.propertiesPanel.render(this.app.state);
    } else if (this.activeTab === 'measurements') {
      this.measurementPanel.render(this.app.state);
    }
  }

  renderLayers(state) {
    const htmlParts = [];

    // 1. Original Image
    htmlParts.push(`
      <div class="layer-group">
        <div class="layer-group-header"><span>Original Image</span></div>
        <div class="layer-row">
          <span class="layer-swatch" style="background:#64748b;"></span>
          <span class="layer-name">${this.escape(state.image.name || 'Reference Image')}</span>
          <span class="layer-meta tabular-nums">${state.image.width}&times;${state.image.height}</span>
          <div class="layer-actions">
            <button type="button" class="layer-icon-btn ${state.image.visible === false ? 'hidden-state' : ''}" data-layer-img-vis title="Show/Hide Image">${state.image.visible === false ? '○' : '●'}</button>
          </div>
        </div>
      </div>
    `);

    // 2. Visual Guides
    const grid = state.guides.grid;
    htmlParts.push(`
      <div class="layer-group">
        <div class="layer-group-header"><span>Visual Guides</span></div>
        <div class="layer-row">
          <span class="layer-swatch" style="background:${grid.color};"></span>
          <span class="layer-name" data-jump-guides="true">Grid (${grid.mode === 'count' ? `${grid.rows}×${grid.columns}` : `${Math.round(grid.cellWidth)}×${Math.round(grid.cellHeight)}px`})</span>
          <div class="layer-actions">
            <button type="button" class="layer-icon-btn ${grid.visible ? '' : 'hidden-state'}" data-grid-vis title="Show/Hide Grid">${grid.visible ? '●' : '○'}</button>
            <button type="button" class="layer-icon-btn ${grid.locked ? 'active' : ''}" data-grid-lock title="Lock/Unlock Grid">${grid.locked ? '🔒' : '🔓'}</button>
          </div>
        </div>
        ${state.guides.customLines.map((g) => this.renderObjectLayerRow('guideLine', g, g.color, state)).join('')}
      </div>
    `);

    // 3. Measurement Lines
    htmlParts.push(this.renderCategoryGroup('Measurement Lines', 'line', state.lines, state));

    // 4. Shapes
    htmlParts.push(this.renderCategoryGroup('Shapes', 'shape', state.shapes, state));

    // 5. Angle Measurements
    htmlParts.push(this.renderCategoryGroup('Angle Measurements', 'angle', state.angles, state));

    this.layersEl.innerHTML = htmlParts.join('');
    this.bindLayerEvents(state);
  }

  renderCategoryGroup(title, category, items, state) {
    const reversed = [...items].reverse(); // Top-most layer first
    return `
      <div class="layer-group">
        <div class="layer-group-header">
          <span>${title}</span>
          <span class="tabular-nums">${items.length}</span>
        </div>
        ${
          reversed.length === 0
            ? `<div class="section-subtitle" style="padding:2px 4px;">None</div>`
            : reversed
                .map((item) => {
                  const color = item.color || item.borderColor || item.arcColor || '#38bdf8';
                  return this.renderObjectLayerRow(category, item, color, state);
                })
                .join('')
        }
      </div>
    `;
  }

  renderObjectLayerRow(category, item, color, state) {
    const isSel = state.selectedIds.includes(item.id);
    const vis = item.visible !== false;
    return `
      <div class="layer-row ${isSel ? 'selected' : ''}" data-cat="${category}" data-id="${item.id}">
        <span class="layer-swatch" style="background:${color};"></span>
        <span class="layer-name" data-layer-select="${item.id}" title="Click to select, double-click to rename">${this.escape(item.name)}</span>
        <div class="layer-actions">
          <button type="button" class="layer-icon-btn ${vis ? '' : 'hidden-state'}" data-act="vis" title="Show/Hide">${vis ? '●' : '○'}</button>
          <button type="button" class="layer-icon-btn ${item.locked ? 'active' : ''}" data-act="lock" title="Lock/Unlock">${item.locked ? '🔒' : '🔓'}</button>
          <button type="button" class="layer-icon-btn" data-act="up" title="Bring Forward">↑</button>
          <button type="button" class="layer-icon-btn" data-act="down" title="Send Backward">↓</button>
          <button type="button" class="layer-icon-btn" data-act="dup" title="Duplicate">⧉</button>
          <button type="button" class="layer-icon-btn" data-act="del" title="Delete">×</button>
        </div>
      </div>
    `;
  }

  bindLayerEvents(state) {
    this.layersEl.querySelector('[data-layer-img-vis]')?.addEventListener('click', () => {
      this.app.pushUndo('Toggle Image Visibility');
      state.image.visible = state.image.visible === false ? true : false;
      this.app.onStateChanged();
    });

    this.layersEl.querySelector('[data-jump-guides]')?.addEventListener('click', () => {
      this.app.setActiveTool('guides');
      this.setActiveTab('inspector');
    });
    this.layersEl.querySelector('[data-grid-vis]')?.addEventListener('click', () => {
      this.app.pushUndo('Toggle Grid');
      state.guides.grid.visible = !state.guides.grid.visible;
      this.app.onStateChanged();
    });
    this.layersEl.querySelector('[data-grid-lock]')?.addEventListener('click', () => {
      this.app.pushUndo('Toggle Grid Lock');
      state.guides.grid.locked = !state.guides.grid.locked;
      this.app.onStateChanged();
    });

    this.layersEl.querySelectorAll('.layer-row[data-cat]').forEach((row) => {
      const cat = row.dataset.cat;
      const id = row.dataset.id;

      const nameEl = row.querySelector('[data-layer-select]');
      nameEl?.addEventListener('click', (e) => {
        this.app.selection.select(state, id, e.shiftKey || e.ctrlKey);
        this.app.onStateChanged({ skipHistory: true, skipAutosave: true });
      });
      nameEl?.addEventListener('dblclick', () => {
        const found = this.app.selection.findObjectById(state, id);
        if (!found) return;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'input';
        input.style.height = '22px';
        input.value = found.item.name;
        nameEl.replaceWith(input);
        input.focus();
        input.select();
        const commit = () => {
          const v = input.value.trim();
          if (v && v !== found.item.name) {
            this.app.pushUndo('Rename Layer');
            found.item.name = v;
            this.app.onStateChanged();
          } else {
            this.renderLayers(state);
          }
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') input.blur();
          if (ev.key === 'Escape') this.renderLayers(state);
        });
      });

      row.querySelectorAll('[data-act]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const act = btn.dataset.act;
          if (act === 'vis') {
            this.app.pushUndo('Toggle Visibility');
            toggleObjectVisibility(state, cat, id);
          } else if (act === 'lock') {
            this.app.pushUndo('Toggle Lock');
            toggleObjectLock(state, cat, id);
          } else if (act === 'up') {
            this.app.pushUndo('Reorder Layer');
            reorderLayer(state, cat, id, 'up');
          } else if (act === 'down') {
            this.app.pushUndo('Reorder Layer');
            reorderLayer(state, cat, id, 'down');
          } else if (act === 'dup') {
            this.app.pushUndo('Duplicate Layer');
            duplicateObjectById(state, cat, id);
          } else if (act === 'del') {
            this.app.pushUndo('Delete Layer');
            deleteObjectById(state, cat, id);
          }
          this.app.onStateChanged();
        });
      });
    });
  }

  escape(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
}
