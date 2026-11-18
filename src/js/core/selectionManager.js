/**
 * Object Selection, Hit-Testing, and Clipboard Manager
 */
import { distance } from '../geometry/points.js';
import { distanceToLineSegment } from '../geometry/lines.js';
import { pointInPolygon } from '../geometry/polygons.js';
import {
  getShapeWorldVertices,
  getAffineBoxCorners,
  getShapePerspectiveQuad,
} from '../geometry/transformations.js';

export class SelectionManager {
  constructor() {
    this.clipboard = [];
  }

  getAllObjects(state) {
    return [
      ...state.lines.map((o) => ({ ...o, category: 'line' })),
      ...state.shapes.map((o) => ({ ...o, category: 'shape' })),
      ...state.angles.map((o) => ({ ...o, category: 'angle' })),
      ...state.guides.customLines.map((o) => ({ ...o, category: 'guideLine' })),
    ];
  }

  findObjectById(state, id) {
    const l = state.lines.find((x) => x.id === id);
    if (l) return { category: 'line', item: l };
    const s = state.shapes.find((x) => x.id === id);
    if (s) return { category: 'shape', item: s };
    const a = state.angles.find((x) => x.id === id);
    if (a) return { category: 'angle', item: a };
    const g = state.guides.customLines.find((x) => x.id === id);
    if (g) return { category: 'guideLine', item: g };
    return null;
  }

  /**
   * Hit-test interactive handles of currently selected objects first (endpoints, corners, rotation, vertices).
   */
  hitTestSelectedHandles(state, imgPt, tolerancePx) {
    for (let i = state.selectedIds.length - 1; i >= 0; i--) {
      const id = state.selectedIds[i];
      const found = this.findObjectById(state, id);
      if (!found || found.item.visible === false || found.item.locked) continue;

      if (found.category === 'line') {
        const line = found.item;
        if (distance(imgPt, line.p1) <= tolerancePx) {
          return { objectId: id, category: 'line', handleType: 'p1' };
        }
        if (distance(imgPt, line.p2) <= tolerancePx) {
          return { objectId: id, category: 'line', handleType: 'p2' };
        }
      }

      if (found.category === 'angle') {
        const ang = found.item;
        if (distance(imgPt, ang.vertex) <= tolerancePx) {
          return { objectId: id, category: 'angle', handleType: 'vertex' };
        }
        if (distance(imgPt, ang.p1) <= tolerancePx) {
          return { objectId: id, category: 'angle', handleType: 'p1' };
        }
        if (distance(imgPt, ang.p2) <= tolerancePx) {
          return { objectId: id, category: 'angle', handleType: 'p2' };
        }
      }

      if (found.category === 'shape') {
        const shape = found.item;

        if (shape.perspectiveEnabled) {
          const quad = getShapePerspectiveQuad(shape);
          for (let c = 0; c < 4; c++) {
            if (distance(imgPt, quad[c]) <= tolerancePx) {
              return { objectId: id, category: 'shape', handleType: 'perspectiveCorner', index: c };
            }
          }
        } else {
          // Rotation handle above top-center of affine box
          const corners = getAffineBoxCorners(shape);
          const topMid = {
            x: (corners[0].x + corners[1].x) * 0.5,
            y: (corners[0].y + corners[1].y) * 0.5,
          };
          const cx = shape.x + shape.width * 0.5;
          const cy = shape.y + shape.height * 0.5;
          const rotRad = ((shape.rotation || 0) * Math.PI) / 180;
          const rotHandle = {
            x: topMid.x + Math.sin(rotRad) * (tolerancePx * 2.2),
            y: topMid.y - Math.cos(rotRad) * (tolerancePx * 2.2),
          };
          if (distance(imgPt, rotHandle) <= tolerancePx * 1.1) {
            return { objectId: id, category: 'shape', handleType: 'rotate', cx, cy };
          }

          // Corner resize handles
          for (let c = 0; c < 4; c++) {
            if (distance(imgPt, corners[c]) <= tolerancePx) {
              return { objectId: id, category: 'shape', handleType: 'resizeCorner', index: c };
            }
          }

          // Custom polygon editable vertices
          if ((shape.type === 'customPolygon' || shape.type === 'freehand') && shape.editVertices) {
            const verts = getShapeWorldVertices(shape);
            for (let v = 0; v < verts.length; v++) {
              if (distance(imgPt, verts[v]) <= tolerancePx) {
                return { objectId: id, category: 'shape', handleType: 'polyVertex', index: v };
              }
            }
          }
        }
      }
    }
    return null;
  }

  /**
   * Hit-test object bodies in reverse stacking order (top-most first).
   */
  hitTestObjectBody(state, imgPt, tolerancePx) {
    // 1. Angles (rays or vertex)
    for (let i = state.angles.length - 1; i >= 0; i--) {
      const a = state.angles[i];
      if (a.visible === false) continue;
      if (
        distance(imgPt, a.vertex) <= tolerancePx ||
        distanceToLineSegment(imgPt, a.vertex, a.p1) <= tolerancePx ||
        distanceToLineSegment(imgPt, a.vertex, a.p2) <= tolerancePx
      ) {
        return { id: a.id, category: 'angle', item: a };
      }
    }

    // 2. Lines
    for (let i = state.lines.length - 1; i >= 0; i--) {
      const l = state.lines[i];
      if (l.visible === false) continue;
      if (distanceToLineSegment(imgPt, l.p1, l.p2) <= tolerancePx) {
        return { id: l.id, category: 'line', item: l };
      }
    }

    // 3. Shapes (edges first, then interior)
    for (let i = state.shapes.length - 1; i >= 0; i--) {
      const s = state.shapes[i];
      if (s.visible === false) continue;
      const verts = getShapeWorldVertices(s);
      if (verts.length < 2) continue;
      for (let k = 0; k < verts.length; k++) {
        if (distanceToLineSegment(imgPt, verts[k], verts[(k + 1) % verts.length]) <= tolerancePx) {
          return { id: s.id, category: 'shape', item: s };
        }
      }
      if (pointInPolygon(imgPt, verts)) {
        return { id: s.id, category: 'shape', item: s };
      }
    }

    // 4. Custom Guide Lines
    if (state.guides.showCustomGuides) {
      const w = state.image.width || 1000;
      const h = state.image.height || 1000;
      for (let i = state.guides.customLines.length - 1; i >= 0; i--) {
        const g = state.guides.customLines[i];
        if (g.visible === false) continue;
        if (g.orientation === 'horizontal' && Math.abs(imgPt.y - g.position) <= tolerancePx) {
          return { id: g.id, category: 'guideLine', item: g };
        }
        if (g.orientation === 'vertical' && Math.abs(imgPt.x - g.position) <= tolerancePx) {
          return { id: g.id, category: 'guideLine', item: g };
        }
        if (g.orientation === 'angled' && g.p1 && g.p2) {
          if (distanceToLineSegment(imgPt, g.p1, g.p2) <= tolerancePx) {
            return { id: g.id, category: 'guideLine', item: g };
          }
        }
        void w;
        void h;
      }
    }

    return null;
  }

  select(state, id, additive = false) {
    if (!id) {
      if (!additive) state.selectedIds = [];
      return;
    }
    if (additive) {
      const idx = state.selectedIds.indexOf(id);
      if (idx >= 0) {
        state.selectedIds.splice(idx, 1);
      } else {
        state.selectedIds.push(id);
      }
    } else {
      state.selectedIds = [id];
    }
  }

  copySelected(state) {
    const copied = [];
    for (const id of state.selectedIds) {
      const found = this.findObjectById(state, id);
      if (found && found.category !== 'guideLine') {
        copied.push({
          category: found.category,
          data: JSON.parse(JSON.stringify(found.item)),
        });
      }
    }
    this.clipboard = copied;
    return copied.length;
  }

  pasteClipboard(state, createIdFn, offsetPx = 24) {
    if (!this.clipboard.length) return [];
    const newIds = [];
    for (const entry of this.clipboard) {
      const clone = JSON.parse(JSON.stringify(entry.data));
      clone.id = createIdFn(entry.category);
      clone.name = `${clone.name} Copy`;
      clone.locked = false;

      if (entry.category === 'line') {
        clone.p1.x += offsetPx;
        clone.p1.y += offsetPx;
        clone.p2.x += offsetPx;
        clone.p2.y += offsetPx;
        state.lines.push(clone);
      } else if (entry.category === 'shape') {
        clone.x += offsetPx;
        clone.y += offsetPx;
        if (clone.points) {
          clone.points = clone.points.map((p) => ({ x: p.x + offsetPx, y: p.y + offsetPx }));
        }
        if (clone.perspectiveCorners) {
          clone.perspectiveCorners = clone.perspectiveCorners.map((p) => ({
            x: p.x + offsetPx,
            y: p.y + offsetPx,
          }));
        }
        state.shapes.push(clone);
      } else if (entry.category === 'angle') {
        clone.p1.x += offsetPx;
        clone.p1.y += offsetPx;
        clone.vertex.x += offsetPx;
        clone.vertex.y += offsetPx;
        clone.p2.x += offsetPx;
        clone.p2.y += offsetPx;
        state.angles.push(clone);
      }
      newIds.push(clone.id);
    }
    state.selectedIds = newIds;
    return newIds;
  }
}
