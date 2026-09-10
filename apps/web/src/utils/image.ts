/**
 * Client-side image compression for chat uploads: downscale to a max edge
 * and re-encode as JPEG until it fits the inline message budget (~200KB).
 */
const MAX_EDGE = 1280;
const TARGET_CHARS = 200_000; // ≈ 150KB image as a data URL

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed to load"));
    img.src = src;
  });
}

function drawToDataUrl(img: HTMLImageElement, maxEdge: number, quality: number): string {
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

/** Compress an image File/Blob to a data URL that fits the chat budget. */
export async function compressImage(file: Blob): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    let quality = 0.75;
    let out = drawToDataUrl(img, MAX_EDGE, quality);
    while (out.length > TARGET_CHARS && quality > 0.3) {
      quality -= 0.15;
      out = drawToDataUrl(img, MAX_EDGE, quality);
    }
    if (out.length > TARGET_CHARS) out = drawToDataUrl(img, 800, 0.5);
    return out;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** True when a data URL is an image type the chat accepts. */
export function isSupportedImageDataUrl(url: string): boolean {
  return /^data:image\/(png|jpe?g|webp);base64,/.test(url);
}
