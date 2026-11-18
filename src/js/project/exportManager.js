/**
 * Export Manager: Project JSON, Annotated PNG, and Measurements CSV
 */
import { computeLineMetrics } from '../geometry/lines.js';
import { computeAngleMetrics } from '../geometry/angles.js';
import { computeShapeMeasurements } from '../geometry/transformations.js';
import { convertPixelsToUnit, convertAreaToUnit } from '../geometry/measurements.js';
import { computeLineRatios } from '../geometry/ratios.js';
import { serializeProject } from './projectManager.js';

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function sanitizeFilename(name) {
  return (name || 'imageratio-study')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'imageratio-study';
}

export function exportProjectJson(state, coords) {
  const payload = serializeProject(state, coords);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  triggerDownload(blob, `${sanitizeFilename(state.projectName)}.json`);
}

export function exportAnnotatedPng(state, canvasEngine) {
  if (!state.image.element) return;
  const offscreen = canvasEngine.renderExportCanvas(state);
  offscreen.toBlob((blob) => {
    if (!blob) return;
    triggerDownload(blob, `${sanitizeFilename(state.projectName)}-annotated.png`);
  }, 'image/png');
}

function csvCell(val) {
  const s = String(val ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportMeasurementsCsv(state) {
  const unit = state.calibration.displayUnit;
  const prec = state.calibration.precision ?? 2;
  const cal = state.calibration;

  const rows = [];
  rows.push(['ImageRatio Measurement Export']);
  rows.push(['Project Name', state.projectName]);
  rows.push(['Image File', state.image.name]);
  rows.push(['Image Dimensions (px)', `${state.image.width} x ${state.image.height}`]);
  rows.push([
    'Scale Calibration',
    cal.calibrated
      ? `${cal.pixelDistance.toFixed(2)} px = ${cal.realValue} ${cal.realUnit} (display unit: ${unit})`
      : 'Uncalibrated (measurements in px)',
  ]);
  rows.push([]);

  // Lines
  rows.push([
    'MEASUREMENT LINES',
    'Name',
    `Length (${cal.calibrated && unit !== 'px' ? unit : 'px'})`,
    'Length (px)',
    'Delta X (px)',
    'Delta Y (px)',
    'Angle Horizontal (deg)',
    'P1 (x, y)',
    'P2 (x, y)',
  ]);
  for (const l of state.lines) {
    const m = computeLineMetrics(l.p1, l.p2);
    const lenConv = convertPixelsToUnit(m.lengthPx, unit, cal);
    rows.push([
      'Line',
      l.name,
      lenConv.value.toFixed(prec),
      m.lengthPx.toFixed(2),
      m.absDx.toFixed(2),
      m.absDy.toFixed(2),
      m.horizontalAcuteDeg.toFixed(2),
      `(${l.p1.x.toFixed(1)}, ${l.p1.y.toFixed(1)})`,
      `(${l.p2.x.toFixed(1)}, ${l.p2.y.toFixed(1)})`,
    ]);
  }
  rows.push([]);

  // Ratios if >= 2 lines compared or available
  const ratioSource =
    state.ratioCompareIds.length >= 2
      ? state.lines.filter((l) => state.ratioCompareIds.includes(l.id))
      : state.lines;

  if (ratioSource.length >= 2) {
    const ratioItems = ratioSource.map((l) => ({
      id: l.id,
      name: l.name,
      lengthPx: computeLineMetrics(l.p1, l.p2).lengthPx,
    }));
    const { pairs, multi } = computeLineRatios(ratioItems, prec);
    rows.push(['LINE RATIOS', 'Pair', 'Simplified Ratio', 'Decimal Ratio', 'A % of B', 'B % of A']);
    for (const p of pairs) {
      rows.push([
        'Ratio',
        `${p.lineA.name} : ${p.lineB.name}`,
        p.simplifiedRatio,
        p.decimalRatio,
        p.pctAofB,
        p.pctBofA,
      ]);
    }
    if (multi) {
      rows.push(['Multi-Line Ratio', multi.names, multi.simplified, multi.decimal, '', '']);
    }
    rows.push([]);
  }

  // Shapes
  const lenUnitLabel = cal.calibrated && unit !== 'px' ? unit : 'px';
  const areaUnitLabel = cal.calibrated && unit !== 'px' ? `${unit}^2` : 'px^2';
  rows.push([
    'SHAPES',
    'Name',
    'Type',
    'Distorted',
    `Displayed Width (${lenUnitLabel})`,
    `Displayed Height (${lenUnitLabel})`,
    `Displayed Perimeter (${lenUnitLabel})`,
    `Displayed Area (${areaUnitLabel})`,
    'Displayed Aspect Ratio',
    `Original Width (${lenUnitLabel})`,
    `Original Height (${lenUnitLabel})`,
    'Side Lengths',
    'Internal Angles (deg)',
  ]);
  for (const s of state.shapes) {
    const m = computeShapeMeasurements(s);
    const dw = convertPixelsToUnit(m.displayed.widthPx, unit, cal).value.toFixed(prec);
    const dh = convertPixelsToUnit(m.displayed.heightPx, unit, cal).value.toFixed(prec);
    const dp = convertPixelsToUnit(m.displayed.perimeterPx, unit, cal).value.toFixed(prec);
    const da = convertAreaToUnit(m.displayed.areaPx2, unit, cal).value.toFixed(prec);
    const ow = convertPixelsToUnit(m.original.widthPx, unit, cal).value.toFixed(prec);
    const oh = convertPixelsToUnit(m.original.heightPx, unit, cal).value.toFixed(prec);
    const sides = m.displayed.sideLengthsPx
      .map((len) => convertPixelsToUnit(len, unit, cal).value.toFixed(prec))
      .join(' | ');
    const angles = m.displayed.internalAnglesDeg.map((a) => a.toFixed(1)).join(' | ');
    rows.push([
      'Shape',
      s.name,
      s.type,
      m.isDistorted ? 'Yes' : 'No',
      dw,
      dh,
      dp,
      da,
      m.displayed.aspectRatio.toFixed(prec),
      ow,
      oh,
      sides,
      angles,
    ]);
  }
  rows.push([]);

  // Angles
  rows.push([
    'ANGLE MEASUREMENTS',
    'Name',
    'Interior (deg)',
    'Exterior (deg)',
    'Reflex (deg)',
    'CW (deg)',
    'CCW (deg)',
    'Classification',
  ]);
  for (const a of state.angles) {
    const m = computeAngleMetrics(a.p1, a.vertex, a.p2);
    const ap = a.precision ?? 1;
    rows.push([
      'Angle',
      a.name,
      m.interiorDeg.toFixed(ap),
      m.exteriorDeg.toFixed(ap),
      m.reflexDeg.toFixed(ap),
      m.cwDeg.toFixed(ap),
      m.ccwDeg.toFixed(ap),
      m.classification,
    ]);
  }

  const csvContent = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, `${sanitizeFilename(state.projectName)}-measurements.csv`);
}
