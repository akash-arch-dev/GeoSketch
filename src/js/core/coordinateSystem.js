/**
 * Coordinate System: Maps between Screen CSS Viewport coordinates and Image-Space coordinates.
 * Measurements are ALWAYS computed in Image-Space coordinates so zoom/pan never alters values.
 */

export class CoordinateSystem {
  constructor() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.viewportWidth = 800;
    this.viewportHeight = 600;
    this.minZoom = 0.05;
    this.maxZoom = 32;
  }

  setViewportSize(width, height) {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
  }

  screenToImage(sx, sy) {
    return {
      x: (sx - this.panX) / this.zoom,
      y: (sy - this.panY) / this.zoom,
    };
  }

  imageToScreen(ix, iy) {
    return {
      x: ix * this.zoom + this.panX,
      y: iy * this.zoom + this.panY,
    };
  }

  screenDistToImageDist(distPx) {
    return distPx / this.zoom;
  }

  zoomAtScreenPoint(newZoom, sx, sy) {
    const clamped = Math.max(this.minZoom, Math.min(this.maxZoom, newZoom));
    const imgPt = this.screenToImage(sx, sy);
    this.zoom = clamped;
    this.panX = sx - imgPt.x * this.zoom;
    this.panY = sy - imgPt.y * this.zoom;
    return this.zoom;
  }

  fitRect(rectX, rectY, rectW, rectH, padding = 36) {
    const availW = Math.max(40, this.viewportWidth - padding * 2);
    const availH = Math.max(40, this.viewportHeight - padding * 2);
    const w = Math.max(1, rectW);
    const h = Math.max(1, rectH);
    const scale = Math.min(availW / w, availH / h);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, scale));
    const cx = rectX + w * 0.5;
    const cy = rectY + h * 0.5;
    this.panX = this.viewportWidth * 0.5 - cx * this.zoom;
    this.panY = this.viewportHeight * 0.5 - cy * this.zoom;
  }

  resetZoomCentered(rectX, rectY, rectW, rectH) {
    this.zoom = 1;
    const cx = rectX + rectW * 0.5;
    const cy = rectY + rectH * 0.5;
    this.panX = this.viewportWidth * 0.5 - cx;
    this.panY = this.viewportHeight * 0.5 - cy;
  }
}
