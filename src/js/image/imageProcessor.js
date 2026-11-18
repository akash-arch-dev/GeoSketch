/**
 * Image Processor: Computes working image dimensions and renders non-destructive
 * rotations and horizontal/vertical flips onto Canvas2D contexts.
 */

export function getWorkingImageDimensions(imageState) {
  const nw = imageState.naturalWidth || 0;
  const nh = imageState.naturalHeight || 0;
  const steps = ((imageState.rotationSteps || 0) % 4 + 4) % 4;
  if (steps === 1 || steps === 3) {
    return { width: nh, height: nw };
  }
  return { width: nw, height: nh };
}

/**
 * Draw the uploaded HTMLImageElement onto ctx in working-image space (0..width, 0..height),
 * applying rotationSteps (0,1,2,3 * 90deg) and flipH / flipV non-destructively.
 */
export function drawTransformedImage(ctx, imgElement, imageState) {
  if (!imgElement) return;
  const { width, height } = getWorkingImageDimensions(imageState);
  const nw = imageState.naturalWidth;
  const nh = imageState.naturalHeight;
  const steps = ((imageState.rotationSteps || 0) % 4 + 4) % 4;

  ctx.save();
  ctx.globalAlpha = imageState.opacity ?? 1;
  ctx.translate(width * 0.5, height * 0.5);
  if (imageState.flipH) ctx.scale(-1, 1);
  if (imageState.flipV) ctx.scale(1, -1);
  if (steps !== 0) ctx.rotate((steps * Math.PI) / 2);
  ctx.drawImage(imgElement, -nw * 0.5, -nh * 0.5, nw, nh);
  ctx.restore();
}
