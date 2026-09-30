// Browser-only helpers. Phone photos are often 5–15 MB and sometimes HEIC;
// Vercel rejects request bodies over 4.5 MB, so every image is decoded and
// re-encoded as a compact JPEG before it is sent.

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?)$/i;

/** Some phones report an empty MIME type (common for HEIC on Android). Fall back to the extension. */
export function looksLikeImage(f: File) {
  return f.type ? f.type.startsWith('image/') : IMAGE_EXT.test(f.name);
}

async function decode(f: File): Promise<{ src: CanvasImageSource; w: number; h: number; done: () => void }> {
  // 1) createImageBitmap, honouring the EXIF rotation (portrait phone photos).
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
    return { src: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() };
  } catch {
    /* fall through */
  }
  // 2) <img> element: Safari can display HEIC here even when createImageBitmap can't.
  const url = URL.createObjectURL(f);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("This phone couldn't open that photo. Try another one, or take a screenshot of it and upload that.");
  }
}

/** Downscale to `maxEdge` and encode as JPEG, stepping quality down until it fits `maxBytes`. */
export async function shrinkImage(f: File, maxEdge = 1600, maxBytes = 3.8 * 1024 * 1024): Promise<Blob> {
  const { src, w, h, done } = await decode(f);
  try {
    for (const [edge, q] of [[maxEdge, 0.86], [maxEdge, 0.75], [Math.round(maxEdge * 0.75), 0.75]] as const) {
      const s = Math.min(1, edge / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * s));
      c.height = Math.max(1, Math.round(h * s));
      const ctx = c.getContext('2d');
      if (!ctx) break;
      ctx.fillStyle = '#ffffff'; // JPEG has no transparency
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(src, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', q));
      if (blob && blob.size <= maxBytes) return blob;
    }
  } finally {
    done();
  }
  throw new Error('That image is too large to process. Please choose a smaller one.');
}
