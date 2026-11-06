import type { ImagePart } from './ai';

/** A picked photo, scaled down (max 1600 px) and re-encoded as JPEG for the AI. */
export async function fileToImagePart(file: File, max = 1600): Promise<{ part: ImagePart; preview: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not read that image.'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL('image/jpeg', 0.85);
    return { part: { mime: 'image/jpeg', data: dataUrl.split(',')[1] }, preview: dataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}
