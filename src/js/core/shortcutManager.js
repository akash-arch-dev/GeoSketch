/**
 * Keyboard Shortcuts Registry, Customization & Conflict Detection
 */

const SHORTCUTS_STORAGE_KEY = 'geosketch_shortcuts_v1';

export const DEFAULT_SHORTCUTS = [
  { id: 'undo', label: 'Undo', category: 'Editing', combo: 'Ctrl+Z', fixed: false },
  { id: 'redo', label: 'Redo', category: 'Editing', combo: 'Ctrl+Shift+Z', fixed: false },
  { id: 'copy', label: 'Copy Selection', category: 'Editing', combo: 'Ctrl+C', fixed: false },
  { id: 'paste', label: 'Paste', category: 'Editing', combo: 'Ctrl+V', fixed: false },
  { id: 'duplicate', label: 'Duplicate Selection', category: 'Editing', combo: 'Ctrl+D', fixed: false },
  { id: 'selectAll', label: 'Select All Objects', category: 'Editing', combo: 'Ctrl+A', fixed: false },
  { id: 'delete', label: 'Delete Selection', category: 'Editing', combo: 'Delete', fixed: false },
  { id: 'cancel', label: 'Cancel / Clear Active Action', category: 'Editing', combo: 'Escape', fixed: true },

  { id: 'toolSelect', label: 'Select Tool', category: 'Tools', combo: 'V', fixed: false },
  { id: 'toolPan', label: 'Pan Tool', category: 'Tools', combo: 'H', fixed: false },
  { id: 'toolGuides', label: 'Visual Guides', category: 'Tools', combo: 'G', fixed: false },
  { id: 'toolCropScale', label: 'Crop & Scale Tool', category: 'Tools', combo: 'X', fixed: false },
  { id: 'toolLine', label: 'Line Measurement Tool', category: 'Tools', combo: 'L', fixed: false },
  { id: 'toolRect', label: 'Rectangle Shape Tool', category: 'Tools', combo: 'R', fixed: false },
  { id: 'toolCircle', label: 'Circle Shape Tool', category: 'Tools', combo: 'C', fixed: false },
  { id: 'toolEllipse', label: 'Ellipse Shape Tool', category: 'Tools', combo: 'E', fixed: false },
  { id: 'toolPolygon', label: 'Polygon Shape Tool', category: 'Tools', combo: 'P', fixed: false },
  { id: 'toolAngle', label: 'Angle Measurement Tool', category: 'Tools', combo: 'A', fixed: false },

  { id: 'fitScreen', label: 'Fit Image to Screen', category: 'Navigation', combo: '0', fixed: false },
  { id: 'zoom100', label: 'Reset Zoom to 100%', category: 'Navigation', combo: '1', fixed: false },
  { id: 'zoomIn', label: 'Zoom In', category: 'Navigation', combo: '=', fixed: false },
  { id: 'zoomOut', label: 'Zoom Out', category: 'Navigation', combo: '-', fixed: false },

  { id: 'saveProject', label: 'Save Project', category: 'Project & View', combo: 'Ctrl+S', fixed: false },
  { id: 'openProject', label: 'Open Saved Projects', category: 'Project & View', combo: 'Ctrl+O', fixed: false },
  { id: 'commandPalette', label: 'Open Command Palette', category: 'Project & View', combo: 'Ctrl+K', fixed: true },
  { id: 'shortcutsHelp', label: 'Show Keyboard Shortcuts', category: 'Project & View', combo: '?', fixed: false },
];

export function normalizeCombo(combo) {
  return String(combo || '')
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
    .join('+');
}

export function eventToCombo(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && e.key !== '?' && e.key !== '+') parts.push('Shift');

  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key === '+') key = '=';
  else if (key.length === 1 && key !== '?') key = key.toUpperCase();

  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null;
  parts.push(key);
  return parts.join('+');
}

export class ShortcutManager {
  constructor() {
    this.bindings = this.loadBindings();
  }

  loadBindings() {
    const map = {};
    for (const def of DEFAULT_SHORTCUTS) {
      map[def.id] = def.combo;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(SHORTCUTS_STORAGE_KEY) || '{}');
      for (const def of DEFAULT_SHORTCUTS) {
        if (!def.fixed && typeof saved[def.id] === 'string' && saved[def.id].trim()) {
          map[def.id] = normalizeCombo(saved[def.id]);
        }
      }
    } catch {
      // ignore storage errors
    }
    return map;
  }

  saveBindings() {
    try {
      localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(this.bindings));
    } catch {
      // ignore
    }
  }

  getCombo(id) {
    return this.bindings[id] || '';
  }

  findConflict(id, combo) {
    const norm = normalizeCombo(combo).toLowerCase();
    for (const def of DEFAULT_SHORTCUTS) {
      if (def.id === id) continue;
      if (normalizeCombo(this.bindings[def.id]).toLowerCase() === norm) {
        return def;
      }
    }
    return null;
  }

  rebind(id, combo) {
    const def = DEFAULT_SHORTCUTS.find((d) => d.id === id);
    if (!def || def.fixed) return { ok: false, error: 'This shortcut cannot be rebound.' };
    const norm = normalizeCombo(combo);
    if (!norm) return { ok: false, error: 'Invalid shortcut key.' };
    const conflict = this.findConflict(id, norm);
    if (conflict) {
      return { ok: false, error: `Conflicts with "${conflict.label}" (${norm}).` };
    }
    this.bindings[id] = norm;
    this.saveBindings();
    return { ok: true };
  }

  resetDefaults() {
    for (const def of DEFAULT_SHORTCUTS) {
      this.bindings[def.id] = def.combo;
    }
    this.saveBindings();
  }

  matchEvent(e) {
    const combo = eventToCombo(e);
    if (!combo) return null;
    const norm = combo.toLowerCase();
    // Handle Delete/Backspace equivalence for delete action if bound to Delete
    for (const def of DEFAULT_SHORTCUTS) {
      const bound = normalizeCombo(this.bindings[def.id]).toLowerCase();
      if (bound === norm) return def.id;
      if (def.id === 'delete' && bound === 'delete' && norm === 'backspace') return 'delete';
      if (def.id === 'redo' && norm === 'ctrl+y') return 'redo';
    }
    return null;
  }
}
