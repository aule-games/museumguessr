// The share block (V1-19, V1-20): an "Add a name" disclosure, one Share
// button and a "Copy link" text link. Share opens the phone's share sheet
// when the browser can share this text and link; otherwise, or when the
// sheet fails, a chooser with WhatsApp, X and Copy link that returns focus
// to Share. A cancelled sheet sends nothing. "Link copied" is announced only
// after the clipboard write succeeded; when it fails the text is shown,
// selected, to copy by hand.

import type { ShareKind, ShareMedium } from '../challenge/link.ts';
import { t, type CopyKey } from '../copy.ts';
import { cleanName } from '../game/names.ts';
import type { ShareTexts } from '../game/text.ts';
import type { ShareMethod } from '../state/reducer.ts';
import { h, s } from './dom.ts';
import { closeDialog, openDialog } from './overlay.ts';

export interface ShareSetup {
  kind: ShareKind;
  /** The texts and link for a channel and the name to carry (null for none). */
  texts(medium: ShareMedium, name: string | null): ShareTexts & { url: string };
  /** The name stored on this device, or null. */
  storedName: string | null;
  onName(name: string | null): void;
  onShared(method: ShareMethod): void;
}

let counter = 0;

function shareGlyph(): SVGSVGElement {
  return s(
    'svg',
    { class: 'share__glyph', viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': 'true', focusable: 'false' },
    s('path', {
      fill: 'currentColor',
      d: 'M12 2.6 7.3 7.3l1.4 1.4L11 6.4V15h2V6.4l2.3 2.3 1.4-1.4L12 2.6ZM5 11v9.4h14V11h-2v7.4H7V11H5Z',
    }),
  );
}

export function shareBlock(p: ShareSetup, label: CopyKey = 'share.button'): HTMLElement {
  const n = ++counter;
  const ids = { panel: `share-name-${n}`, input: `share-input-${n}`, help: `share-help-${n}`, err: `share-err-${n}` };
  const status = h('p', { class: 'share__status', 'aria-live': 'polite', 'data-test': 'copied' });
  const manual = h('div', { class: 'share__manual', hidden: true });

  const input = h('input', {
    id: ids.input,
    class: 'field__input',
    type: 'text',
    autocomplete: 'nickname',
    autocapitalize: 'words',
    enterkeyhint: 'send',
    spellcheck: 'false',
    maxlength: 40,
    'aria-describedby': ids.help,
    'data-test': 'name-input',
  });
  input.value = p.storedName ?? '';
  const error = h('p', { class: 'field__error', id: ids.err, hidden: true }, t('name.rule'));
  const without = h('button', { type: 'button', class: 'link', hidden: true, 'data-test': 'share-without-name' }, t('name.without'));
  const panel = h(
    'div',
    { class: 'field share__name', id: ids.panel, hidden: !p.storedName },
    h('label', { class: 'field__label', for: ids.input }, h('bdi', {}, t('name.label'))),
    input,
    h('p', { class: 'field__help', id: ids.help }, t('name.help')),
    error,
    without,
  );
  const disclosure = h(
    'button',
    { type: 'button', class: 'link share__add', 'aria-expanded': String(!!p.storedName), 'aria-controls': ids.panel, 'data-test': 'add-name', hidden: !!p.storedName },
    t('name.add'),
  );
  disclosure.addEventListener('click', () => {
    panel.hidden = false;
    disclosure.hidden = true;
    disclosure.setAttribute('aria-expanded', 'true');
    input.focus();
  });

  const setError = (on: boolean) => {
    error.hidden = !on;
    without.hidden = !on;
    input.setAttribute('aria-invalid', String(on));
    input.setAttribute('aria-describedby', on ? `${ids.help} ${ids.err}` : ids.help);
  };
  input.addEventListener('input', () => setError(false));

  /** The name to share: null for none; undefined when the typed name breaks the rules. */
  const currentName = (): string | null | undefined => {
    const raw = panel.hidden ? '' : input.value;
    if (!raw.trim()) return null;
    return cleanName(raw) ?? undefined;
  };

  const shareBtn = h('button', { type: 'button', class: 'btn btn--primary share__btn', 'data-test': 'share' }, shareGlyph(), h('span', {}, t(label)));

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      manual.hidden = true;
      status.textContent = '';
      // a fresh node, so a second copy is announced again
      requestAnimationFrame(() => (status.textContent = t('share.copied')));
      p.onShared('copy');
    } catch {
      const area = h('textarea', { class: 'share__text', readonly: true, rows: 8, 'aria-label': t('share.copyManual') });
      area.value = text;
      manual.replaceChildren(h('p', {}, t('share.copyManual')), area);
      manual.hidden = false;
      area.focus();
      area.select();
      p.onShared('manual');
    }
  };

  const chooser = (name: string | null) => {
    const link = (medium: 'whatsapp' | 'x', href: string, key: CopyKey) =>
      h('a', {
        class: 'btn btn--secondary btn--wide share__target',
        href,
        target: '_blank',
        'data-test': `share-${medium}`,
        onclick: () => {
          p.onShared(medium);
          closeDialog(dlg);
        },
      }, t(key));
    const copyBtn = h('button', { type: 'button', class: 'btn btn--secondary btn--wide share__target', 'data-test': 'share-copy' }, t('share.copyLink'));
    const dlg = openDialog(
      t('share.chooser'),
      [
        h(
          'div',
          { class: 'share__targets' },
          link('whatsapp', `https://wa.me/?text=${encodeURIComponent(p.texts('whatsapp', name).long)}`, 'share.whatsapp'),
          link('x', `https://x.com/intent/post?text=${encodeURIComponent(p.texts('x', name).short)}`, 'share.x'),
          copyBtn,
        ),
      ],
      shareBtn,
      'dialog--share',
    );
    copyBtn.addEventListener('click', () => closeDialog(dlg, () => void copy(p.texts('copy', name).long)));
  };

  const share = async (name: string | null) => {
    p.onName(name);
    const native = p.texts('native', name);
    const data = { text: native.sheet, url: native.url };
    if (typeof navigator.share === 'function' && navigator.canShare?.(data)) {
      try {
        await navigator.share(data);
        p.onShared('native');
        return;
      } catch (err) {
        if ((err as DOMException | null)?.name === 'AbortError') return;
        // any other refusal (NotAllowedError, a missing target) falls back to the chooser
      }
    }
    chooser(name);
  };

  const go = (useName: boolean) => {
    const name = useName ? currentName() : null;
    if (name === undefined) {
      setError(true);
      input.focus();
      return;
    }
    setError(false);
    void share(name);
  };
  shareBtn.addEventListener('click', () => go(true));
  without.addEventListener('click', () => go(false));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go(true);
  });

  const copyLink = h('button', { type: 'button', class: 'link share__copy', 'data-test': 'copy-link' }, t('share.copyLink'));
  copyLink.addEventListener('click', () => {
    const name = currentName();
    if (name === undefined) {
      setError(true);
      input.focus();
      return;
    }
    p.onName(name);
    void copy(p.texts('copy', name).long);
  });

  return h(
    'section',
    { class: 'share', 'data-test': 'share-block' },
    disclosure,
    panel,
    h('div', { class: 'share__row' }, shareBtn, copyLink),
    status,
    manual,
  );
}
