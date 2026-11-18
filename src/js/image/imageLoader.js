/**
 * Image Loader: Handles Drag & Drop, File Picker, Clipboard Paste, and Sample Loading.
 * Supports PNG, JPG, JPEG, WebP.
 */

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const ALLOWED_EXT = /\.(png|jpe?g|webp)$/i;

export function isSupportedImageFile(file) {
  if (!file) return false;
  if (file.type && ALLOWED_MIME.has(file.type.toLowerCase())) return true;
  if (file.name && ALLOWED_EXT.test(file.name)) return true;
  return false;
}

export function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    if (!isSupportedImageFile(file)) {
      reject(new Error('Unsupported format. Please choose a PNG, JPG, JPEG, or WebP image.'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => {
      const dataUrl = reader.result;
      loadImageFromDataUrl(dataUrl, {
        name: file.name || 'Pasted Image',
        mimeType: file.type || 'image/png',
        sizeBytes: file.size || 0,
      })
        .then(resolve)
        .catch(reject);
    };
    reader.readAsDataURL(file);
  });
}

export function loadImageFromDataUrl(dataUrl, meta = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        element: img,
        dataUrl,
        name: meta.name || 'Reference Image',
        mimeType: meta.mimeType || 'image/png',
        sizeBytes: meta.sizeBytes || dataUrl.length,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      });
    };
    img.onerror = () => reject(new Error('The selected file could not be decoded as an image.'));
    img.src = dataUrl;
  });
}

export async function loadImageFromUrl(url, name = 'Sample Study') {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Unable to load sample reference image.');
  const blob = await res.blob();
  const file = new File([blob], `${name}.jpg`, { type: blob.type || 'image/jpeg' });
  const loaded = await loadImageFromFile(file);
  loaded.name = name;
  return loaded;
}

export async function readClipboardImage() {
  if (!navigator.clipboard || !navigator.clipboard.read) {
    throw new Error('Clipboard API unavailable here. Press Ctrl+V to paste directly.');
  }
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const imageType = item.types.find((t) => ALLOWED_MIME.has(t));
    if (imageType) {
      const blob = await item.getType(imageType);
      const ext = imageType.split('/')[1] || 'png';
      const file = new File([blob], `clipboard-image.${ext}`, { type: imageType });
      return loadImageFromFile(file);
    }
  }
  throw new Error('No PNG, JPG, or WebP image found in clipboard.');
}
