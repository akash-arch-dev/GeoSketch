/**
 * Unit Conversion & Scale Calibration Engine
 */

// Base conversion factors relative to meters
const UNIT_TO_METERS = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: 0.0254,
  ft: 0.3048,
};

export const SUPPORTED_UNITS = ['px', 'mm', 'cm', 'm', 'in', 'ft'];

export function isPhysicalUnit(unit) {
  return unit !== 'px' && Object.prototype.hasOwnProperty.call(UNIT_TO_METERS, unit);
}

export function convertPhysicalValue(value, fromUnit, toUnit) {
  if (fromUnit === toUnit) return value;
  if (!isPhysicalUnit(fromUnit) || !isPhysicalUnit(toUnit)) return value;
  const meters = value * UNIT_TO_METERS[fromUnit];
  return meters / UNIT_TO_METERS[toUnit];
}

/**
 * Convert a pixel distance in image space into the target unit given calibration state.
 * Returns { value, unit, isCalibrated }.
 */
export function convertPixelsToUnit(pixelLength, targetUnit, calibration) {
  if (!calibration || !calibration.calibrated || targetUnit === 'px' || !isPhysicalUnit(targetUnit)) {
    return {
      value: pixelLength,
      unit: 'px',
      isCalibrated: Boolean(calibration && calibration.calibrated),
    };
  }

  // calibration stores pixelDistance corresponding to realValue in realUnit
  const baseUnit = calibration.realUnit || 'cm';
  const pxPerBaseUnit = calibration.pixelDistance / Math.max(1e-9, calibration.realValue);
  const valueInBaseUnit = pixelLength / pxPerBaseUnit;
  const converted = convertPhysicalValue(valueInBaseUnit, baseUnit, targetUnit);

  return {
    value: converted,
    unit: targetUnit,
    isCalibrated: true,
  };
}

/**
 * Convert a pixel^2 area into targetUnit^2.
 */
export function convertAreaToUnit(pixelArea, targetUnit, calibration) {
  if (!calibration || !calibration.calibrated || targetUnit === 'px' || !isPhysicalUnit(targetUnit)) {
    return { value: pixelArea, unit: 'px²' };
  }
  const linearScale = convertPixelsToUnit(1, targetUnit, calibration).value;
  return {
    value: pixelArea * linearScale * linearScale,
    unit: `${targetUnit}²`,
  };
}

/**
 * Convert a real-world value in targetUnit back to image-space pixels.
 */
export function convertUnitToPixels(value, fromUnit, calibration) {
  if (!calibration || !calibration.calibrated || fromUnit === 'px' || !isPhysicalUnit(fromUnit)) {
    return value;
  }
  const baseUnit = calibration.realUnit || 'cm';
  const valueInBase = convertPhysicalValue(value, fromUnit, baseUnit);
  const pxPerBaseUnit = calibration.pixelDistance / Math.max(1e-9, calibration.realValue);
  return valueInBase * pxPerBaseUnit;
}

export function formatLength(pixelLength, unit, calibration, precision = 2) {
  const { value, unit: actualUnit } = convertPixelsToUnit(pixelLength, unit, calibration);
  const p = actualUnit === 'px' ? Math.min(precision, 1) : precision;
  return `${value.toFixed(p)} ${actualUnit}`;
}

export function formatArea(pixelArea, unit, calibration, precision = 2) {
  const { value, unit: actualUnit } = convertAreaToUnit(pixelArea, unit, calibration);
  const p = actualUnit === 'px²' ? 0 : precision;
  return `${value.toFixed(p)} ${actualUnit}`;
}

export function formatNumber(val, precision = 2) {
  if (!Number.isFinite(val)) return '—';
  return Number(val).toFixed(precision);
}
