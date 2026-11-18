/**
 * Canvas Event Manager: Navigation (Zoom/Pan), Object Manipulation, Tool Delegation & Keyboard Shortcuts.
 */
import { constrainLineAngle } from '../geometry/lines.js';
import { getShapeWorldVertices } from '../geometry/transformations.js';
import { boundingBox, rotatePoint } from '../geometry/points.js';

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
    // Middle mouse button OR Space+LeftClick => Pan
    if (e.button === 1 || (this.spaceDown && e.button === 0)) {
      e.preventDefault();
      this.isPanning = true;
      this.panLast = sc;
      this.updateCursor();
      return;
    }

    if (e.button !== 0) return;

    const imgPt = this.app.coords.screenToImage(sc.x, sc.y);
    const state = this.app.state;
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
      this.app.history.commitBatch(state);
      this.selectDrag = null;
      this.app.onStateChanged();
      return;
    }

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

    // 3. Clicked empty space
    if (!additive && state.selectedIds.length > 0) {
      state.selectedIds = [];
      this.app.onStateChanged({ skipAutosave: true });
    }
  }

  handleSelectPointerMove(imgPt, e, state) {
    const drag = this.selectDrag;
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

      if (hit.category === 'line') {
        const other = hit.handleType === 'p1' ? item.p2 : item.p1;
        const target = e.shiftKey ? constrainLineAngle(other, imgPt, 45) : imgPt;
        item[hit.handleType].x = target.x;
        item[hit.handleType].y = target.y;
      } else if (hit.category === 'angle') {
        item[hit.handleType].x = imgPt.x;
        item[hit.handleType].y = imgPt.y;
      } else if (hit.category === 'shape') {
        if (hit.handleType === 'perspectiveCorner') {
          item.perspectiveCorners[hit.index] = { x: imgPt.x, y: imgPt.y };
        } else if (hit.handleType === 'rotate') {
          const cx = hit.cx;
          const cy = hit.cy;
          let deg = ((Math.atan2(imgPt.y - cy, imgPt.x - cx) * 180) / Math.PI) + 90;
          if (e.shiftKey) deg = Math.round(deg / 15) * 15;
          item.rotation = ((deg % 360) + 360) % 360;
        } else if (hit.handleType === 'polyVertex') {
          // Inverse affine if needed, or direct edit when unrotated
          const cx = item.x + item.width * 0.5;
          const cy = item.y + item.height * 0.5;
          const rotRad = -((item.rotation || 0) * Math.PI) / 180;
          const localPt =
            Math.abs(item.rotation || 0) > 1e-4 ? rotatePoint(imgPt, { x: cx, y: cy }, rotRad) : imgPt;
          item.points[hit.index] = { x: localPt.x, y: localPt.y };
          const b = boundingBox(item.points);
          item.x = b.minX;
          item.y = b.minY;
          item.width = Math.max(4, b.width);
          item.height = Math.max(4, b.height);
          item.localBounds = { ...b };
        } else if (hit.handleType === 'resizeCorner') {
          this.resizeShapeByCorner(item, init, hit.index, imgPt, e.shiftKey);
        }
      }

      this.app.renderCanvas();
      this.app.ui.refreshInspectorLive();
    }
  }

  resizeShapeByCorner(shape, init, cornerIdx, imgPt, shiftKey) {
    // Rotate cursor point back into shape's unrotated coordinate frame around initial center
    const icx = init.x + init.width * 0.5;
    const icy = init.y + init.height * 0.5;
    const rotRad = ((init.rotation || 0) * Math.PI) / 180;
    const localCursor = rotatePoint(imgPt, { x: icx, y: icy }, -rotRad);

    // Opposite corner in unrotated frame stays anchored
    const hw = init.width * 0.5;
    const hh = init.height * 0.5;
    const localCorners = [
      { x: icx - hw, y: icy - hh }, // 0 TL
      { x: icx + hw, y: icy - hh }, // 1 TR
      { x: icx + hw, y: icy + hh }, // 2 BR
      { x: icx - hw, y: icy + hh }, // 3 BL
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
    void getShapeWorldVertices;
  }

  onKeyDown(e) {
    if (this.app.currentScreen !== 'workspace') return;
    const tag = document.activeElement?.tagName;
    const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if (e.code === 'Space' && !isTyping) {
      e.preventDefault();
      if (!this.spaceDown) {
        this.spaceDown = true;
        this.updateCursor();
      }
      return;
    }

    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.app.redo();
      else this.app.undo();
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.app.redo();
      return;
    }

    if (isTyping) return;

    if (ctrl && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      const count = this.app.selection.copySelected(this.app.state);
      if (count > 0) this.app.notify(`Copied ${count} object${count > 1 ? 's' : ''}.`);
      return;
    }

    if (ctrl && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      this.app.pasteSelected();
      return;
    }

    if (ctrl && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      this.app.duplicateSelected();
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.app.deleteSelected();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      const tool = this.app.getActiveToolController();
      if (tool && tool.cancel) tool.cancel();
      this.selectDrag = null;
      this.app.renderCanvas();
      this.app.ui.updateHintBanner();
      return;
    }

    if (e.key === 'Enter') {
      if (this.app.state.activeTool === 'shape' && this.app.state.subTools.shape === 'customPolygon') {
        this.app.tools.shape.commitCustomPolygon(this.app.state);
      }
      return;
    }

    // Tool shortcuts
    const k = e.key.toLowerCase();
    if (k === 'v') this.app.setActiveTool('select');
    else if (k === 'g') this.app.setActiveTool('guides');
    else if (k === 'c') this.app.setActiveTool('cropScale');
    else if (k === 'l') this.app.setActiveTool('line');
    else if (k === 's') this.app.setActiveTool('shape');
    else if (k === 'a') this.app.setActiveTool('angle');
    else if (k === '0') this.app.fitToScreen();
    else if (k === '1') this.app.resetZoom();
    else if (k === '=' || k === '+') this.app.zoomBy(1.2);
    else if (k === '-') this.app.zoomBy(1 / 1.2);
  }

  onKeyUp(e) {
    if (e.code === 'Space') {
      this.spaceDown = false;
      this.updateCursor();
    }
  }

  updateCursor() {
    this.viewport.classList.remove('cursor-crosshair', 'cursor-grab', 'cursor-grabbing', 'cursor-move');
    if (this.isPanning) {
      this.viewport.classList.add('cursor-grabbing');
    } else if (this.spaceDown) {
      this.viewport.classList.add('cursor-grab');
    } else if (this.app.state.activeTool !== 'select') {
      this.viewport.classList.add('cursor-crosshair');
    }
  }
}
