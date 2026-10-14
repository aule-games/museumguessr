// Full-screen photo with pinch-zoom (DS1, ENG17). PhotoSwipe is loaded on
// first use; its own history handling is not used: we push one entry so Back
// closes it.

import { pushOverlay } from './overlay.ts';

export async function openLightbox(img: HTMLImageElement, opener: HTMLElement) {
  if (!img.naturalWidth) return;
  const [{ default: PhotoSwipe }] = await Promise.all([import('photoswipe'), import('photoswipe/style.css')]);
  const pswp = new PhotoSwipe({
    dataSource: [{ src: img.currentSrc || img.src, width: img.naturalWidth, height: img.naturalHeight, alt: img.alt }],
    index: 0,
    bgOpacity: 0.92,
    showHideAnimationType: 'none',
    returnFocus: false,
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
