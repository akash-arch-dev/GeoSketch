/**
 * Pure Ratio & Proportion Comparison Engine
 */

function gcd(a, b) {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

/**
 * Approximate a positive float as a clean small-integer ratio n : d using continued fractions.
 */
export function approximateIntegerRatio(a, b, maxDenom = 24, tolerance = 0.015) {
  if (a <= 1e-9 || b <= 1e-9) return null;
  const target = a / b;

  let bestNum = 1;
  let bestDen = 1;
  let bestErr = Infinity;

  for (let den = 1; den <= maxDenom; den++) {
    const num = Math.round(target * den);
    if (num < 1) continue;
    const err = Math.abs(num / den - target) / target;
    if (err < bestErr) {
      bestErr = err;
      bestNum = num;
      bestDen = den;
      if (err < 1e-5) break;
    }
  }

  if (bestErr <= tolerance) {
    const g = gcd(bestNum, bestDen);
    return {
      a: bestNum / g,
      b: bestDen / g,
      exact: bestErr < 1e-4,
      errorPct: bestErr * 100,
    };
  }
  return null;
}

/**
 * Compute pairwise and multi-line ratios for an array of { id, name, lengthPx } items.
 */
export function computeLineRatios(lines, precision = 2) {
  if (!lines || lines.length < 2) {
    return { pairs: [], multi: null };
  }

  const pairs = [];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const A = lines[i];
      const B = lines[j];
      const lenA = Math.max(1e-9, A.lengthPx);
      const lenB = Math.max(1e-9, B.lengthPx);

      const decAtoB = lenA / lenB;
      const decBtoA = lenB / lenA;
      const pctBofA = (lenB / lenA) * 100;
      const pctAofB = (lenA / lenB) * 100;

      const approx = approximateIntegerRatio(lenA, lenB, 20, 0.02);
      const simplifiedStr = approx
        ? `${approx.a} : ${approx.b}${approx.exact ? '' : ' (≈)'}`
        : `${decAtoB.toFixed(precision)} : 1`;

      pairs.push({
        lineA: A,
        lineB: B,
        decimalRatio: `${decAtoB.toFixed(precision)} : 1`,
        inverseDecimalRatio: `1 : ${decBtoA.toFixed(precision)}`,
        simplifiedRatio: simplifiedStr,
        pctAofB: `${pctAofB.toFixed(Math.min(precision, 1))}%`,
        pctBofA: `${pctBofA.toFixed(Math.min(precision, 1))}%`,
      });
    }
  }

  // Multi-line normalized ratio relative to shortest line
  const minLen = Math.max(1e-9, Math.min(...lines.map((l) => l.lengthPx)));
  const normalizedParts = lines.map((l) => l.lengthPx / minLen);
  const multiDecimal = normalizedParts.map((v) => v.toFixed(precision)).join(' : ');

  // Check if all scale nicely to small integers
  let multiSimplified = multiDecimal;
  for (let mult = 1; mult <= 12; mult++) {
    const scaled = normalizedParts.map((v) => v * mult);
    const rounded = scaled.map((v) => Math.round(v));
    const maxErr = Math.max(...scaled.map((v, idx) => Math.abs(v - rounded[idx]) / Math.max(1, v)));
    if (maxErr < 0.02 && rounded.every((r) => r >= 1 && r <= 64)) {
      let g = rounded[0];
      for (let k = 1; k < rounded.length; k++) g = gcd(g, rounded[k]);
      multiSimplified = rounded.map((r) => r / g).join(' : ') + (maxErr < 1e-4 ? '' : ' (≈)');
      break;
    }
  }

  const totalLen = lines.reduce((acc, l) => acc + l.lengthPx, 0);
  const breakdown = lines.map((l) => ({
    id: l.id,
    name: l.name,
    sharePct: totalLen > 0 ? (l.lengthPx / totalLen) * 100 : 0,
    relativeToFirstPct: lines[0].lengthPx > 0 ? (l.lengthPx / lines[0].lengthPx) * 100 : 0,
  }));

  return {
    pairs,
    multi: {
      names: lines.map((l) => l.name).join(' : '),
      decimal: multiDecimal,
      simplified: multiSimplified,
      breakdown,
    },
  };
}
