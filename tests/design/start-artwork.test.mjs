import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { Window } from 'happy-dom';

test('production mini map and wordmark retain semantics, silhouettes and wrapped journeys', async () => {
  const window = new Window();
  const globals = ['document', 'DOMParser', 'HTMLAnchorElement'];
  const previous = globals.map((key) => globalThis[key]);
  globals.forEach((key) => { globalThis[key] = key === 'document' ? window.document : window[key]; });
  const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: 'custom' });
  try {
    const { miniMap, wordmark } = await server.ssrLoadModule('/src/ui/screens/start.ts');
    const mark = wordmark();
    assert.equal(mark.textContent, 'MuseumGuessr');
    assert.equal(mark.querySelector('.wordmark__glyphs').getAttribute('aria-hidden'), 'true');
    assert.equal(mark.querySelectorAll('.pin--made,.pin--kept').length, 2);
    assert.equal(mark.querySelectorAll('.pin--combined').length, 0);
    for (const [made, kept] of [
      [{lat:36.1,lng:43.3}, {lat:40.8,lng:-74}],
      [{lat:-20,lng:179}, {lat:25,lng:-179}],
      [{lat:25,lng:-179}, {lat:-20,lng:179}],
      [{lat:90,lng:0}, {lat:-90,lng:180}],
      [{lat:0,lng:0}, {lat:0,lng:0}],
    ]) {
      const map = miniMap(made, kept, 'Accessible journey');
      assert.equal(map.getAttribute('role'), 'img');
      assert.equal(map.getAttribute('aria-label'), 'Accessible journey');
      assert.equal(map.querySelectorAll('.minimap__land path').length, 3);
      for (const name of ['made', 'kept']) {
        const glyph = map.querySelector(`.minimap__${name}`);
        assert.ok(glyph.querySelector('path'));
        assert.equal(glyph.getAttribute('aria-hidden'), 'true');
        assert.ok(Number(glyph.getAttribute('x')) >= 0 && Number(glyph.getAttribute('x')) <= 304);
        assert.ok(Number(glyph.getAttribute('y')) >= -20);
      }
      const coords = map.querySelector('.minimap__line').getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number);
      assert.ok(Math.abs(coords[4] - coords[0]) <= 160, 'always the nearest world copy');
      if (Math.abs(made.lng - kept.lng) > 350) assert.ok(Math.abs(coords[4] - coords[0]) < 2, 'short antimeridian crossing');
    }
  } finally {
    await server.close();
    globals.forEach((key, i) => { if (previous[i] === undefined) delete globalThis[key]; else globalThis[key] = previous[i]; });
    await window.happyDOM.close();
  }
});
