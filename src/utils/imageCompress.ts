// Client-side image compression — runs before upload.
// Goal: reduce phone photos (3-8 MB, 12 MP) to ~500 KB at ~1920px longest side.
// PDF embeds these at ~80mm width (~950px), so 1920px is 2x oversampled — visually
// indistinguishable from the original at any practical viewing size.
//
// Modern browsers honor EXIF orientation when decoding via Image(), so the canvas
// drawImage path produces a correctly-rotated bitmap and the compressed output
// no longer needs EXIF rotation downstream (orientation tag is dropped on encode).

export interface CompressOptions {
  maxLongestSide?: number; // px — longest dimension cap, default 1920
  quality?: number;        // 0..1 JPEG quality, default 0.85
  skipUnderBytes?: number; // skip compression if file already smaller, default 600 KB
}

const DEFAULTS: Required<CompressOptions> = {
  maxLongestSide: 1920,
  quality: 0.85,
  skipUnderBytes: 600 * 1024,
};

const COMPRESSIBLE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const isCompressibleImage = (file: File): boolean => {
  if (COMPRESSIBLE_TYPES.has(file.type.toLowerCase())) return true;
  // Some camera apps set application/octet-stream — fall back to extension.
  const ext = file.name.toLowerCase().split('.').pop() || '';
  return ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext);
};

const loadImage = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });

/**
 * Compress a single image File. Pass-through for non-images (e.g. PDFs) and for
 * images already under the size threshold. Always returns a File (never throws —
 * on failure, returns the original so upload still works).
 */
export async function compressImage(
  file: File,
  options: CompressOptions = {},
): Promise<File> {
  const opts = { ...DEFAULTS, ...options };

  if (!isCompressibleImage(file)) return file;
  if (file.size <= opts.skipUnderBytes) return file;

  try {
    const img = await loadImage(file);
    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = longest > opts.maxLongestSide ? opts.maxLongestSide / longest : 1;
    const targetW = Math.round(img.naturalWidth * scale);
    const targetH = Math.round(img.naturalHeight * scale);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    // White background — JPEG has no alpha, transparent PNGs would otherwise go black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', opts.quality),
    );
    if (!blob) return file;

    // Defensive: if compression ended up larger (tiny image, lossless source), keep original.
    if (blob.size >= file.size) return file;

    // Normalise filename to .jpg since output is always JPEG.
    const baseName = file.name.replace(/\.(png|webp|heic|heif|jpe?g)$/i, '');
    const newName = `${baseName}.jpg`;
    return new File([blob], newName, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch (err) {
    // Never block upload because compression failed — fall back to the original file.
    console.warn('Image compression failed, using original:', err);
    return file;
  }
}

/** Compress an array of files in parallel. Non-images pass through. */
export async function compressImages(
  files: File[],
  options: CompressOptions = {},
): Promise<File[]> {
  return Promise.all(files.map((f) => compressImage(f, options)));
}
