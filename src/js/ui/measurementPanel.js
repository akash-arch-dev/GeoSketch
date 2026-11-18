/**
 * Right Sidebar: Measurement Dashboard & Real-Time Line Ratio Calculator
 */
import { computeLineMetrics } from '../geometry/lines.js';
import { computeAngleMetrics } from '../geometry/angles.js';
import { computeShapeMeasurements } from '../geometry/transformations.js';
import { formatLength, formatArea } from '../geometry/measurements.js';
import { computeLineRatios } from '../geometry/ratios.js';

export class MeasurementPanel {
  constructor(app, containerEl) {
    this.app = app;
    this.container = containerEl;
  }

  render(state) {
    const cal = state.calibration;
    const unit = cal.displayUnit;
    const prec = cal.precision ?? 2;

    // 1. Summary Strip
    let html = `
      <div class="panel-section">
        <div class="section-header">
          <h3 class="section-title">Measurement Overview</h3>
          <span class="section-subtitle tabular-nums">${cal.calibrated ? `Calibrated (${unit})` : 'Pixels (px)'}</span>
        </div>
        <div class="summary-strip">
          <div class="summary-cell">
            <span class="summary-num tabular-nums">${state.lines.length}</span>
            <span class="summary-label">Lines</span>
          </div>
          <div class="summary-cell">
            <span class="summary-num tabular-nums">${state.shapes.length}</span>
            <span class="summary-label">Shapes</span>
          </div>
          <div class="summary-cell">
            <span class="summary-num tabular-nums">${state.angles.length}</span>
            <span class="summary-label">Angles</span>
          </div>
        </div>
      </div>
    `;

    // 2. Lines & Ratio Comparison Selection
    html += `
      <div class="panel-section">
        <div class="section-header">
          <h3 class="section-title">Lines &amp; Ratio Calculator</h3>
          <button type="button" class="btn btn-xs btn-secondary" data-action="select-all-ratios">Compare All</button>
        </div>
    `;

    if (state.lines.length === 0) {
      html += `<div class="empty-state-msg">No measurement lines yet. Use Line Measurement (L) to draw lines and compare ratios.</div>`;
    } else {
      html += `
        <table class="data-table">
          <thead>
            <tr>
              <th title="Include in Ratio Calculator">Cmp</th>
              <th>Line</th>
              <th class="num">Length</th>
              <th class="num">Angle</th>
            </tr>
          </thead>
          <tbody>
      `;

      for (const line of state.lines) {
        const m = computeLineMetrics(line.p1, line.p2);
        const checked = state.ratioCompareIds.includes(line.id) ? 'checked' : '';
        const selectedClass = state.selectedIds.includes(line.id) ? 'selected-row' : '';
        html += `
          <tr class="${selectedClass}" data-select-id="${line.id}">
            <td><input type="checkbox" class="ratio-check" data-line-id="${line.id}" ${checked} /></td>
            <td><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${line.color};margin-right:5px;"></span>${this.escape(line.name)}</td>
            <td class="num tabular-nums">${formatLength(m.lengthPx, unit, cal, prec)}</td>
            <td class="num tabular-nums">${m.horizontalAcuteDeg.toFixed(1)}°</td>
          </tr>
        `;
      }
      html += `</tbody></table>`;

      // Computed Ratios
      const comparedLines = state.lines
        .filter((l) => state.ratioCompareIds.includes(l.id))
        .map((l) => ({
          id: l.id,
          name: l.name,
          lengthPx: computeLineMetrics(l.p1, l.p2).lengthPx,
        }));

      if (comparedLines.length >= 2) {
        const { pairs, multi } = computeLineRatios(comparedLines, prec);
        html += `
          <div class="ratio-card">
            <div class="ratio-headline">
              <span>Multi-Line Ratio</span>
              <span class="tabular-nums">${multi.simplified}</span>
            </div>
            <div class="ratio-sub tabular-nums">${multi.names}</div>
            <div class="ratio-sub tabular-nums">Decimal: ${multi.decimal}</div>
          </div>
        `;

        for (const p of pairs) {
          html += `
            <div class="ratio-card">
              <div class="ratio-headline">
                <span>${this.escape(p.lineA.name)} : ${this.escape(p.lineB.name)}</span>
                <span class="tabular-nums">${p.simplifiedRatio}</span>
              </div>
              <div class="ratio-sub tabular-nums">
                Decimal: ${p.decimalRatio} &middot; ${this.escape(p.lineA.name)} is ${p.pctAofB} of ${this.escape(p.lineB.name)} &middot; ${this.escape(p.lineB.name)} is ${p.pctBofA} of ${this.escape(p.lineA.name)}
              </div>
            </div>
          `;
        }
      } else {
        html += `<div class="section-subtitle">Check 2 or more lines above to compare simplified, decimal, and percentage ratios.</div>`;
      }
    }
    html += `</div>`;

    // 3. Shapes Summary
    html += `
      <div class="panel-section">
        <div class="section-header">
          <h3 class="section-title">Shape Dimensions</h3>
        </div>
    `;
    if (state.shapes.length === 0) {
      html += `<div class="empty-state-msg">No geometric shapes yet. Use Shape Tools (S) to construct shapes.</div>`;
    } else {
      html += `
        <table class="data-table">
          <thead>
            <tr>
              <th>Shape</th>
              <th class="num">W &times; H</th>
              <th class="num">Aspect</th>
              <th class="num">Area</th>
            </tr>
          </thead>
          <tbody>
      `;
      for (const s of state.shapes) {
        const m = computeShapeMeasurements(s);
        const selectedClass = state.selectedIds.includes(s.id) ? 'selected-row' : '';
        const wStr = formatLength(m.displayed.widthPx, unit, cal, prec).replace(/ [a-z]+$/i, '');
        const hStr = formatLength(m.displayed.heightPx, unit, cal, prec);
        html += `
          <tr class="${selectedClass}" data-select-id="${s.id}">
            <td>${this.escape(s.name)}${m.isDistorted ? ' *' : ''}</td>
            <td class="num tabular-nums">${wStr} &times; ${hStr}</td>
            <td class="num tabular-nums">${m.displayed.aspectRatio.toFixed(prec)}</td>
            <td class="num tabular-nums">${formatArea(m.displayed.areaPx2, unit, cal, prec)}</td>
          </tr>
        `;
      }
      html += `</tbody></table>`;
    }
    html += `</div>`;

    // 4. Angles Summary
    html += `
      <div class="panel-section">
        <div class="section-header">
          <h3 class="section-title">Angle Measurements</h3>
        </div>
    `;
    if (state.angles.length === 0) {
      html += `<div class="empty-state-msg">No angles measured yet. Use Angle Measurement (A) to measure angles.</div>`;
    } else {
      html += `
        <table class="data-table">
          <thead>
            <tr>
              <th>Angle</th>
              <th class="num">Interior</th>
              <th class="num">Exterior</th>
              <th class="num">Type</th>
            </tr>
          </thead>
          <tbody>
      `;
      for (const a of state.angles) {
        const m = computeAngleMetrics(a.p1, a.vertex, a.p2);
        const ap = a.precision ?? 1;
        const selectedClass = state.selectedIds.includes(a.id) ? 'selected-row' : '';
        html += `
          <tr class="${selectedClass}" data-select-id="${a.id}">
            <td>${this.escape(a.name)}</td>
            <td class="num tabular-nums">${m.interiorDeg.toFixed(ap)}°</td>
            <td class="num tabular-nums">${m.exteriorDeg.toFixed(ap)}°</td>
            <td class="num">${m.classification}</td>
          </tr>
        `;
      }
      html += `</tbody></table>`;
    }
    html += `</div>`;

    this.container.innerHTML = html;
    this.bindEvents(state);
  }

  bindEvents(state) {
    const selectAllBtn = this.container.querySelector('[data-action="select-all-ratios"]');
    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', () => {
        if (state.ratioCompareIds.length === state.lines.length) {
          state.ratioCompareIds = [];
        } else {
          state.ratioCompareIds = state.lines.map((l) => l.id);
        }
        this.app.onStateChanged({ skipHistory: true });
      });
    }

    this.container.querySelectorAll('.ratio-check').forEach((chk) => {
      chk.addEventListener('click', (e) => e.stopPropagation());
      chk.addEventListener('change', () => {
        const id = chk.dataset.lineId;
        if (chk.checked) {
          if (!state.ratioCompareIds.includes(id)) state.ratioCompareIds.push(id);
        } else {
          state.ratioCompareIds = state.ratioCompareIds.filter((x) => x !== id);
        }
        this.app.onStateChanged({ skipHistory: true });
      });
    });

    this.container.querySelectorAll('tr[data-select-id]').forEach((row) => {
      row.addEventListener('click', () => {
        state.selectedIds = [row.dataset.selectId];
        this.app.onStateChanged({ skipHistory: true, skipAutosave: true });
      });
    });
  }

  escape(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
}
