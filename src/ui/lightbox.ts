// Full-screen photo with pinch-zoom (DS1, ENG17). PhotoSwipe is loaded on
// first use; its own history handling is not used: we push one entry so Back
// closes it. Time keeps running while the photo is open, so its top bar
// repeats the clock beside Close (R2).

import { clockMirror } from './clock.ts';
import { pushOverlay } from './overlay.ts';

export async function openLightbox(img: HTMLImageElement, opener: HTMLElement, caption?: string) {
  if (!img.naturalWidth) return;
  const [{ default: PhotoSwipe }] = await Promise.all([import('photoswipe'), import('photoswipe/style.css')]);
  const pswp = new PhotoSwipe({
    dataSource: [{ src: img.currentSrc || img.src, width: img.naturalWidth, height: img.naturalHeight, alt: img.alt }],
    index: 0,
    bgOpacity: 0.92,
    showHideAnimationType: 'none',
    returnFocus: false,
  });
  pswp.on('uiRegister', () => {
    // the round's neutral caption sits under the enlarged photo (DS37); text only (SEC1)
    if (caption) pswp.ui?.registerElement({ name: 'caption', appendTo: 'root', onInit: (el) => { el.textContent = caption; } });
    pswp.ui?.registerElement({ name: 'clock', appendTo: 'bar', order: 15, onInit: (el) => el.append(clockMirror()) });
  });
  let closedByHistory = false;
  const requestClose = pushOverlay(() => {
    closedByHistory = true;
    pswp.close();
  });
  pswp.on('close', () => {
    if (!closedByHistory) requestClose();
    opener.focus({ preventScroll: true });
  });
  pswp.init();
}
