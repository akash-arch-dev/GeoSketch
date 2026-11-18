/**
 * GeoSketch Canvas Event Manager
 * Handles Navigation (Zoom/Pan/Space+Drag/Middle-Click), Marquee & Object Selection,
 * Snapped Handle Manipulation, Tool Delegation, and Customizable Keyboard Shortcuts.
 */
import { constrainLineAngle } from '../geometry/lines.js';
import { getShapeWorldVertices } from '../geometry/transformations.js';
import { boundingBox, rotatePoint } from '../geometry/points.js';
import { resolveSnap } from './snapEngine.js';

export class EventManager {
  constructor(app, viewportEl) {
    this.app = app;
    this.viewport = viewportEl;
    this.spaceDown = false;
    this.isPanning = false;
    this.panLast = { x: 0, y: 0 };
    this.selectDrag = null;
    this.bound = false;
  }

  bind() {
    if (this.bound) return;
    this.bound = true;

    this.viewport.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.viewport.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    this.viewport.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.viewport.addEventListener('contextmenu', (e) => {
      if (e.button === 1) e.preventDefault();
    });

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
  }

  getScreenCoords(e) {
    const rect = this.viewport.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  onWheel(e) {
    if (this.app.currentScreen !== 'workspace') return;
    e.preventDefault();
    const sc = this.getScreenCoords(e);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    this.app.coords.zoomAtScreenPoint(this.app.coords.zoom * factor, sc.x, sc.y);
    this.app.renderCanvas();
    this.app.ui.updateZoomReadout();
  }

  onPointerDown(e) {
    if (this.app.currentScreen !== 'workspace') return;
    this.viewport.focus({ preventScroll: true });

    const sc = this.getScreenCoords(e);
    const state = this.app.state;

    // Navigation guard: Middle mouse OR Space+LeftClick OR Pan tool => Pan only, prevent accidental drawing
    if (e.button === 1 || ((this.spaceDown || state.activeTool === 'pan') && e.button === 0)) {
      e.preventDefault();
      this.isPanning = true;
      this.panLast = sc;
      this.updateCursor();
      return;
    }

    if (e.button !== 0) return;

    const imgPt = this.app.coords.screenToImage(sc.x, sc.y);
    const tol = this.app.coords.screenDistToImageDist(10);

    if (state.activeTool === 'select') {
      this.handleSelectPointerDown(imgPt, e, state, tol);
      return;
    }

    const tool = this.app.getActiveToolController();
    if (tool && tool.onPointerDown) {
      tool.onPointerDown(imgPt, e, state, tol);
    }
  }

  onPointerMove(e) {
    if (this.app.currentScreen !== 'workspace') return;
    const sc = this.getScreenCoords(e);
    const imgPt = this.app.coords.screenToImage(sc.x, sc.y);
    this.app.ui.updateStatusCoords(imgPt);

    if (this.isPanning) {
      const dx = sc.x - this.panLast.x;
      const dy = sc.y - this.panLast.y;
      this.panLast = sc;
      this.app.coords.panX += dx;
      this.app.coords.panY += dy;
      this.app.renderCanvas();
      return;
    }

    const state = this.app.state;
    if (state.activeTool === 'select' && this.selectDrag) {
      this.handleSelectPointerMove(imgPt, e, state);
      return;
    }

    if (state.activeTool === 'pan' || this.spaceDown) return;

    const tool = this.app.getActiveToolController();
    if (tool && tool.onPointerMove) {
      const preview = tool.onPointerMove(imgPt, e, state);
      if (preview !== undefined) {
        this.app.renderCanvas(preview);
      }
    }
  }

  onPointerUp(e) {
    if (this.app.currentScreen !== 'workspace') return;
    if (this.isPanning) {
      this.isPanning = false;
      this.updateCursor();
      return;
    }

    const sc = this.getScreenCoords(e);
    const imgPt = this.app.coords.screenToImage(sc.x, sc.y);
    const state = this.app.state;

    if (state.activeTool === 'select' && this.selectDrag) {
      if (this.selectDrag.mode === 'marquee') {
        this.commitMarqueeSelection(this.selectDrag, e, state);
        this.selectDrag = null;
        this.app.onStateChanged({ skipHistory: true, skipAutosave: true });
        return;
      }
      this.app.history.commitBatch(state);
      this.selectDrag = null;
      this.app.onStateChanged();
      return;
    }

    if (state.activeTool === 'pan') return;

    const tool = this.app.getActiveToolController();
    if (tool && tool.onPointerUp) {
      tool.onPointerUp(imgPt, e, state);
    }
  }

  onDoubleClick(e) {
    if (this.app.currentScreen !== 'workspace') return;
    const tool = this.app.getActiveToolController();
    if (tool && tool.onDoubleClick) {
      tool.onDoubleClick(this.app.state, e);
    }
  }

  handleSelectPointerDown(imgPt, e, state, tol) {
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;

    // 1. Check handles of currently selected objects
    const handleHit = this.app.selection.hitTestSelectedHandles(state, imgPt, tol);
    if (handleHit) {
      this.app.history.beginBatch(state, 'Edit Object Handle');
      const found = this.app.selection.findObjectById(state, handleHit.objectId);
      this.selectDrag = {
        mode: 'handle',
        hit: handleHit,
        startPt: { ...imgPt },
        initialObj: JSON.parse(JSON.stringify(found.item)),
      };
      return;
    }

    // 2. Hit-test object bodies
    const bodyHit = this.app.selection.hitTestObjectBody(state, imgPt, tol);
    if (bodyHit) {
      if (additive) {
        this.app.selection.select(state, bodyHit.id, true);
        this.app.onStateChanged({ skipAutosave: true });
        return;
      }

      if (!state.selectedIds.includes(bodyHit.id)) {
        this.app.selection.select(state, bodyHit.id, false);
        this.app.onStateChanged({ skipAutosave: true });
      }

      if (!bodyHit.item.locked) {
        this.app.history.beginBatch(state, 'Move Object');
        const movingItems = state.selectedIds
          .map((id) => this.app.selection.findObjectById(state, id))
          .filter((f) => f && !f.item.locked)
          .map((f) => ({
            id: f.item.id,
            category: f.category,
            initial: JSON.parse(JSON.stringify(f.item)),
          }));
        this.selectDrag = {
          mode: 'move',
          startPt: { ...imgPt },
          movingItems,
        };
      }
      return;
    }

    // 3. Clicked empty space -> start marquee box selection
    if (!additive && state.selectedIds.length > 0) {
      state.selectedIds = [];
      this.app.onStateChanged({ skipHistory: true, skipAutosave: true });
    }
    this.selectDrag = {
      mode: 'marquee',
      startPt: { ...imgPt },
      currPt: { ...imgPt },
    };
  }

  handleSelectPointerMove(imgPt, e, state) {
    const drag = this.selectDrag;

    if (drag.mode === 'marquee') {
      drag.currPt = { ...imgPt };
      const rect = {
        x: Math.min(drag.startPt.x, drag.currPt.x),
        y: Math.min(drag.startPt.y, drag.currPt.y),
        width: Math.abs(drag.currPt.x - drag.startPt.x),
        height: Math.abs(drag.currPt.y - drag.startPt.y),
      };
      this.app.renderCanvas({ type: 'marquee', rect });
      return;
    }

    const dx = imgPt.x - drag.startPt.x;
    const dy = imgPt.y - drag.startPt.y;

    if (drag.mode === 'move') {
      for (const entry of drag.movingItems) {
        const found = this.app.selection.findObjectById(state, entry.id);
        if (!found) continue;
        const item = found.item;
        const init = entry.initial;

        if (entry.category === 'line') {
          item.p1.x = init.p1.x + dx;
          item.p1.y = init.p1.y + dy;
          item.p2.x = init.p2.x + dx;
          item.p2.y = init.p2.y + dy;
        } else if (entry.category === 'angle') {
          item.p1.x = init.p1.x + dx;
          item.p1.y = init.p1.y + dy;
          item.vertex.x = init.vertex.x + dx;
          item.vertex.y = init.vertex.y + dy;
          item.p2.x = init.p2.x + dx;
          item.p2.y = init.p2.y + dy;
        } else if (entry.category === 'shape') {
          item.x = init.x + dx;
          item.y = init.y + dy;
          if (init.points) {
            item.points = init.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
          }
          if (init.perspectiveCorners) {
            item.perspectiveCorners = init.perspectiveCorners.map((p) => ({
              x: p.x + dx,
              y: p.y + dy,
            }));
          }
        } else if (entry.category === 'guideLine') {
          if (init.orientation === 'horizontal') item.position = init.position + dy;
          else if (init.orientation === 'vertical') item.position = init.position + dx;
          else if (init.p1 && init.p2) {
            item.p1.x = init.p1.x + dx;
            item.p1.y = init.p1.y + dy;
            item.p2.x = init.p2.x + dx;
            item.p2.y = init.p2.y + dy;
          }
        }
      }
      this.app.renderCanvas();
      this.app.ui.refreshInspectorLive();
      return;
    }

    if (drag.mode === 'handle') {
      const hit = drag.hit;
      const found = this.app.selection.findObjectById(state, hit.objectId);
      if (!found) return;
      const item = found.item;
      const init = drag.initialObj;

      let snapPreview = null;
      const snapped = resolveSnap(imgPt, state, this.app.coords, {
        bypass: e.altKey,
        excludeIds: [item.id],
      });

      if (hit.category === 'line') {
        const other = hit.handleType === 'p1' ? item.p2 : item.p1;
        const target = e.shiftKey ? constrainLineAngle(other, snapped, 45) : snapped;
        item[hit.handleType].x = target.x;
        item[hit.handleType].y = target.y;
        snapPreview = snapped.snapped ? { type: 'snapOnly', snap: snapped } : null;
      } else if (hit.category === 'angle') {
        item[hit.handleType].x = snapped.x;
        item[hit.handleType].y = snapped.y;
        snapPreview = snapped.snapped ? { type: 'snapOnly', snap: snapped } : null;
      } else if (hit.category === 'shape') {
        if (hit.handleType === 'perspectiveCorner') {
          item.perspectiveCorners[hit.index] = { x: snapped.x, y: snapped.y };
          snapPreview = snapped.snapped ? { type: 'snapOnly', snap: snapped } : null;
        } else if (hit.handleType === 'rotate') {
          const cx = hit.cx;
          const cy = hit.cy;
          let deg = (Math.atan2(imgPt.y - cy, imgPt.x - cx) * 180) / Math.PI + 90;
          if (e.shiftKey) deg = Math.round(deg / 15) * 15;
          item.rotation = ((deg % 360) + 360) % 360;
        } else if (hit.handleType === 'polyVertex') {
          const cx = item.x + item.width * 0.5;
          const cy = item.y + item.height * 0.5;
          const rotRad = -((item.rotation || 0) * Math.PI) / 180;
          const localPt =
            Math.abs(item.rotation || 0) > 1e-4 ? rotatePoint(snapped, { x: cx, y: cy }, rotRad) : snapped;
          item.points[hit.index] = { x: localPt.x, y: localPt.y };
          const b = boundingBox(item.points);
          item.x = b.minX;
          item.y = b.minY;
          item.width = Math.max(4, b.width);
          item.height = Math.max(4, b.height);
          item.localBounds = { ...b };
          snapPreview = snapped.snapped ? { type: 'snapOnly', snap: snapped } : null;
        } else if (hit.handleType === 'resizeCorner') {
          this.resizeShapeByCorner(item, init, hit.index, imgPt, e.shiftKey);
        }
      }

      this.app.renderCanvas(snapPreview);
      this.app.ui.refreshInspectorLive();
    }
  }

  commitMarqueeSelection(drag, e, state) {
    const minX = Math.min(drag.startPt.x, drag.currPt.x);
    const maxX = Math.max(drag.startPt.x, drag.currPt.x);
    const minY = Math.min(drag.startPt.y, drag.currPt.y);
    const maxY = Math.max(drag.startPt.y, drag.currPt.y);
    if (maxX - minX < 4 && maxY - minY < 4) return;

    const inBox = (pt) => pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY;
    const hits = [];

    for (const l of state.lines) {
      if (l.visible !== false && (inBox(l.p1) || inBox(l.p2))) hits.push(l.id);
    }
    for (const s of state.shapes) {
      if (s.visible === false) continue;
      const verts = getShapeWorldVertices(s);
      const b = boundingBox(verts);
      if (!(b.maxX < minX || b.minX > maxX || b.maxY < minY || b.minY > maxY)) {
        hits.push(s.id);
      }
    }
    for (const a of state.angles) {
      if (a.visible !== false && (inBox(a.p1) || inBox(a.vertex) || inBox(a.p2))) hits.push(a.id);
    }

    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      for (const id of hits) {
        if (!state.selectedIds.includes(id)) state.selectedIds.push(id);
      }
    } else {
      state.selectedIds = hits;
    }
  }

  resizeShapeByCorner(shape, init, cornerIdx, imgPt, shiftKey) {
    const icx = init.x + init.width * 0.5;
    const icy = init.y + init.height * 0.5;
    const rotRad = ((init.rotation || 0) * Math.PI) / 180;
    const localCursor = rotatePoint(imgPt, { x: icx, y: icy }, -rotRad);

    const hw = init.width * 0.5;
    const hh = init.height * 0.5;
    const localCorners = [
      { x: icx - hw, y: icy - hh },
      { x: icx + hw, y: icy - hh },
      { x: icx + hw, y: icy + hh },
      { x: icx - hw, y: icy + hh },
    ];
    const anchor = localCorners[(cornerIdx + 2) % 4];
    let newW = Math.max(6, Math.abs(localCursor.x - anchor.x));
    let newH = Math.max(6, Math.abs(localCursor.y - anchor.y));

    if (shiftKey || shape.aspectLocked) {
      const aspect = init.height > 1e-4 ? init.width / init.height : 1;
      if (newW / newH > aspect) newH = newW / aspect;
      else newW = newH * aspect;
    }

    const dirX = localCursor.x >= anchor.x ? 1 : -1;
    const dirY = localCursor.y >= anchor.y ? 1 : -1;
    const newLocalCenter = {
      x: anchor.x + dirX * newW * 0.5,
      y: anchor.y + dirY * newH * 0.5,
    };
    const newWorldCenter = rotatePoint(newLocalCenter, { x: icx, y: icy }, rotRad);

    shape.width = newW;
    shape.height = newH;
    shape.x = newWorldCenter.x - newW * 0.5;
    shape.y = newWorldCenter.y - newH * 0.5;

    if (init.points && init.points.length >= 3) {
      const b = boundingBox(init.points);
      const sx = newW / Math.max(1, b.width);
      const sy = newH / Math.max(1, b.height);
      shape.points = init.points.map((p) => ({
        x: newWorldCenter.x + (p.x - b.cx) * sx,
        y: newWorldCenter.y + (p.y - b.cy) * sy,
      }));
      shape.localBounds = boundingBox(shape.points);
    }
  }

  onKeyDown(e) {
    // Allow shortcut rebind capture modal to intercept if active
    if (this.app.isCapturingShortcut) return;

    const modalOpen = !document.getElementById('modal-backdrop')?.classList.contains('hidden');
    if (modalOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.app.closeActiveModal();
      }
      return;
    }

    if (this.app.currentScreen !== 'workspace') return;

    const activeEl = document.activeElement;
    const tag = activeEl?.tagName;
    const isTyping =
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      Boolean(activeEl?.isContentEditable);

    if (e.code === 'Space' && !isTyping) {
      e.preventDefault();
      if (!this.spaceDown) {
        this.spaceDown = true;
        this.updateCursor();
      }
      return;
    }

    if (e.key === 'Enter' && !isTyping) {
      if (this.app.state.activeTool === 'shape' && this.app.state.subTools.shape === 'customPolygon') {
        this.app.tools.shape.commitCustomPolygon(this.app.state);
      }
      return;
    }

    // Ignore non-modifier shortcuts while typing inside inputs
    const hasModifier = e.ctrlKey || e.metaKey || e.altKey;
    if (isTyping && !hasModifier && e.key !== 'Escape') return;
    if (isTyping && (e.key === 'Delete' || e.key === 'Backspace')) return;

    const actionId = this.app.shortcuts.matchEvent(e);
    if (!actionId) return;

    // Allow browser text copy/paste/select-all inside inputs
    if (isTyping && ['copy', 'paste', 'selectAll', 'undo', 'redo'].includes(actionId)) {
      return;
    }

    e.preventDefault();
    this.app.executeAction(actionId);
  }

  onKeyUp(e) {
    if (e.code === 'Space') {
      this.spaceDown = false;
      this.updateCursor();
    }
  }

  cancelActiveDrag() {
    this.selectDrag = null;
  }

  updateCursor() {
    this.viewport.classList.remove('cursor-crosshair', 'cursor-grab', 'cursor-grabbing', 'cursor-move');
    if (this.isPanning) {
      this.viewport.classList.add('cursor-grabbing');
    } else if (this.spaceDown || this.app.state.activeTool === 'pan') {
      this.viewport.classList.add('cursor-grab');
    } else if (this.app.state.activeTool !== 'select') {
      this.viewport.classList.add('cursor-crosshair');
    }
  }
}
