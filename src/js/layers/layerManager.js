/**
 * Layer Management: Handles visibility, lock, rename, duplicate, delete, and stacking order.
 */
import { createObjectId } from './objectManager.js';

export function getLayerCollection(state, category) {
  if (category === 'line') return state.lines;
  if (category === 'shape') return state.shapes;
  if (category === 'angle') return state.angles;
  if (category === 'guideLine') return state.guides.customLines;
  return null;
}

export function toggleObjectVisibility(state, category, id) {
  const arr = getLayerCollection(state, category);
  const item = arr?.find((x) => x.id === id);
  if (!item) return false;
  item.visible = item.visible === false ? true : false;
  return true;
}

export function toggleObjectLock(state, category, id) {
  const arr = getLayerCollection(state, category);
  const item = arr?.find((x) => x.id === id);
  if (!item) return false;
  item.locked = !item.locked;
  return true;
}

export function renameObject(state, category, id, newName) {
  const trimmed = String(newName || '').trim();
  if (!trimmed) return false;
  const arr = getLayerCollection(state, category);
  const item = arr?.find((x) => x.id === id);
  if (!item) return false;
  item.name = trimmed;
  return true;
}

export function deleteObjectById(state, category, id) {
  const arr = getLayerCollection(state, category);
  if (!arr) return false;
  const idx = arr.findIndex((x) => x.id === id);
  if (idx === -1) return false;
  arr.splice(idx, 1);
  state.selectedIds = state.selectedIds.filter((s) => s !== id);
  state.ratioCompareIds = state.ratioCompareIds.filter((s) => s !== id);
  return true;
}

export function duplicateObjectById(state, category, id, offsetPx = 20) {
  const arr = getLayerCollection(state, category);
  const item = arr?.find((x) => x.id === id);
  if (!item) return null;

  const clone = JSON.parse(JSON.stringify(item));
  clone.id = createObjectId(category);
  clone.name = `${item.name} Copy`;
  clone.locked = false;

  if (category === 'line') {
    clone.p1.x += offsetPx;
    clone.p1.y += offsetPx;
    clone.p2.x += offsetPx;
    clone.p2.y += offsetPx;
  } else if (category === 'shape') {
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
  } else if (category === 'angle') {
    clone.p1.x += offsetPx;
    clone.p1.y += offsetPx;
    clone.vertex.x += offsetPx;
    clone.vertex.y += offsetPx;
    clone.p2.x += offsetPx;
    clone.p2.y += offsetPx;
  } else if (category === 'guideLine') {
    if (clone.orientation === 'horizontal' || clone.orientation === 'vertical') {
      clone.position += offsetPx;
    } else if (clone.p1 && clone.p2) {
      clone.p1.x += offsetPx;
      clone.p1.y += offsetPx;
      clone.p2.x += offsetPx;
      clone.p2.y += offsetPx;
    }
  }

  arr.push(clone);
  state.selectedIds = [clone.id];
  return clone;
}

export function reorderLayer(state, category, id, direction) {
  const arr = getLayerCollection(state, category);
  if (!arr) return false;
  const idx = arr.findIndex((x) => x.id === id);
  if (idx === -1) return false;

  // Higher index renders on top; "up" moves toward front (+1), "down" moves back (-1)
  const targetIdx = direction === 'up' ? idx + 1 : idx - 1;
  if (targetIdx < 0 || targetIdx >= arr.length) return false;
  const [moved] = arr.splice(idx, 1);
  arr.splice(targetIdx, 0, moved);
  return true;
}
