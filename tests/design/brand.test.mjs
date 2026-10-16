import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';
import { fontFiles, ogSvg, renderOg, renderIcon } from '../../scripts/og.mjs';
const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const dimensions = (png) => {
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
};
test('share image renders a 1200×630 PNG with the credited whole sample photo', () => {
  const svg = ogSvg();
  const sample = JSON.parse(read('data/sample.json')).items.find((item) => item.id === '00');
  for (const text of ['Museum', 'Guessr', 'Made here.', 'Kept there.', 'Guess both.', sample.title, `Photo: ${sample.photo.author}, ${sample.photo.licence}`, 'Nimrud', 'New York']) assert.ok(svg.includes(text), text);
  assert.match(read('src/assets/og/share.svg').toString(), /preserveAspectRatio="xMidYMid meet"/);
  assert.ok(!svg.includes('slice'), 'optimised SVG keeps the default meet behaviour');
  assert.ok(svg.includes(read('images/00.jpg').toString('base64')));
  assert.doesNotMatch(svg, /\{\{|<script|<foreignObject/);
  assert.deepEqual(dimensions(renderOg()), [1200, 630]);
});
test('all share fonts render actual glyphs without any system fonts', () => {
  const files = fontFiles();
  for (const [family, weight] of [['Bricolage Grotesque', 800], ['Instrument Sans', 400], ['Instrument Sans', 600]]) {
    const renderer = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="80"><text x="0" y="60" font-family="${family}" font-size="40" font-weight="${weight}">Made here. Kept there.</text></svg>`, { font: { loadSystemFonts: false, fontFiles: files } });
    assert.ok(renderer.innerBBox()?.width > 100, `${family} ${weight}: text must not silently disappear`);
  }
  for (const file of files) {
    const ttf = readFileSync(file);
    let sum = 0;
    for (let i = 0; i < ttf.length; i += 4) sum = (sum + ttf.readUInt32BE(i)) >>> 0;
    assert.equal(sum, 0xb1b0afba, 'reconstructed sfnt checksum');
  }
});
test('committed favicon PNGs are exact resvg derivatives of the same SVG', () => {
  const svg = read('public/favicon.svg').toString();
  assert.doesNotMatch(svg, /<image|<text|<script/);
  for (const [size, file] of [[32, 'public/favicon.png'], [180, 'public/apple-touch-icon.png']]) {
    const png = read(file);
    assert.deepEqual(dimensions(png), [size, size]);
    assert.deepEqual(png, renderIcon(size));
  }
});
test('the simplified Natural Earth land asset stays below 15 KB gzip', () => {
  const world = read('src/assets/maps/world.svg');
  assert.ok(gzipSync(world).length < 15 * 1024);
  assert.match(world.toString(), /viewBox="0 0 320 160"/);
  assert.doesNotMatch(world.toString(), /<image|<script|<text/);
});
test('head tags declare the share size, description, and base-aware icons', () => {
  const html = read('index.html').toString();
  for (const [property, content] of [['og:image:width', '1200'], ['og:image:height', '630']]) assert.ok(html.includes(`property="${property}" content="${content}"`));
  assert.match(html, /property="og:image:alt" content="[^"]*Human-headed winged lion \(lamassu\)/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  for (const file of ['favicon.svg', 'favicon.png', 'apple-touch-icon.png']) assert.ok(html.includes(`%BASE_URL%${file}`));
});
