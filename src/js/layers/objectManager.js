/**
 * Object Factory & CRUD Operations for Lines, Shapes, Angles, and Custom Guides
 */
import { boundingBox } from '../geometry/points.js';
import { getAffineBoxCorners } from '../geometry/transformations.js';

let idCounter = 1;
export function createObjectId(prefix = 'obj') {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

export function createMeasurementLine(p1, p2, count = 1, overrides = {}) {
  return {
    id: createObjectId('line'),
    name: `Line ${count}`,
    p1: { x: p1.x, y: p1.y },
    p2: { x: p2.x, y: p2.y },
    color: '#38bdf8',
    thickness: 2,
    opacity: 1,
    visible: true,
    locked: false,
    ...overrides,
  };
}

export function createShapeObject(type, bounds, count = 1, overrides = {}) {
  const shape = {
    id: createObjectId('shape'),
    type,
    name: `${capitalizeShapeType(type)} ${count}`,
    x: bounds.x,
    y: bounds.y,
    width: Math.max(2, bounds.width),
    height: Math.max(2, bounds.height),
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
    skewY: 0,
    sides: type === 'polygon' ? 5 : type === 'triangle' ? 3 : 4,
    aspectLocked: type === 'square' || type === 'circle',
    borderColor: '#f59e0b',
    borderThickness: 2,
    fillColor: '#f59e0b',
    fillOpacity: 0.1,
    visible: true,
    locked: false,
    perspectiveEnabled: false,
    perspectiveCorners: null,
    showPerspectiveGrid: false,
    editVertices: type === 'customPolygon' || type === 'freehand',
    points: null,
    localBounds: null,
    ...overrides,
  };

  if (shape.points && shape.points.length >= 2) {
    const b = boundingBox(shape.points);
    shape.x = b.minX;
    shape.y = b.minY;
    shape.width = Math.max(4, b.width);
    shape.height = Math.max(4, b.height);
    shape.localBounds = { ...b };
  }

  return shape;
}

export function toggleShapePerspective(shape, enable) {
  if (enable) {
    if (!shape.perspectiveCorners || shape.perspectiveCorners.length !== 4) {
      shape.perspectiveCorners = getAffineBoxCorners(shape);
    }
    shape.perspectiveEnabled = true;
  } else {
    shape.perspectiveEnabled = false;
  }
}

export function resetShapeDistortion(shape) {
  shape.scaleX = 1;
  shape.scaleY = 1;
  shape.skewX = 0;
  shape.skewY = 0;
  shape.perspectiveEnabled = false;
  shape.perspectiveCorners = null;
}

export function createAngleObject(p1, vertex, p2, count = 1, overrides = {}) {
  return {
    id: createObjectId('angle'),
    name: `Angle ${count}`,
    p1: { x: p1.x, y: p1.y },
    vertex: { x: vertex.x, y: vertex.y },
    p2: { x: p2.x, y: p2.y },
    arcColor: '#10b981',
    arcThickness: 2,
    arcRadius: 42,
    labelPosition: 'auto', // 'auto' | 'inside' | 'outside'
    textSize: 12,
    precision: 1,
    showReflex: false,
    showExterior: false,
    visible: true,
    locked: false,
    ...overrides,
  };
}

export function createCustomGuideLine(orientation, position, count = 1, p1 = null, p2 = null) {
  return {
    id: createObjectId('guide'),
    name: `Guide ${count}`,
    orientation, // 'horizontal' | 'vertical' | 'angled'
    position,
    p1,
    p2,
    color: '#a78bfa',
    opacity: 0.75,
    thickness: 1,
    style: 'dashed',
    visible: true,
    locked: false,
  };
}

function capitalizeShapeType(t) {
  const map = {
    rectangle: 'Rectangle',
    square: 'Square',
    circle: 'Circle',
    ellipse: 'Ellipse',
    triangle: 'Triangle',
    polygon: 'Polygon',
    customPolygon: 'Custom Polygon',
    freehand: 'Freehand Shape',
  };
  return map[t] || 'Shape';
}
