// Deterministic, offline brand rendering. Only the existing credited photo
// is embedded; all other visuals are SVG geometry. No system font discovery.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { optimize } from 'svgo';
const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const pathData = (path) => read(path).match(/ d="([^"]+)"/)[1];
const token = JSON.parse(read('src/design/tokens.json'));
// resvg's native font loader rejects WOFF/WOFF2. Restore the installed
// Fontsource WOFF1 tables to TTF, then pass explicit file paths. This is only
// container decompression, not font editing: https://www.w3.org/TR/WOFF/.
// No extra dependency, external font, or system-font fallback is needed.
export function unpackFont(woff) {
  if (woff.toString('ascii', 0, 4) !== 'wOFF') throw new Error('Expected WOFF1 font');
  const count = woff.readUInt16BE(12);
  const ttf = Buffer.alloc(woff.readUInt32BE(16));
  woff.copy(ttf, 0, 4, 8);
  ttf.writeUInt16BE(count, 4);
  const power = Math.floor(Math.log2(count));
  ttf.writeUInt16BE(2 ** power * 16, 6);
  ttf.writeUInt16BE(power, 8);
  ttf.writeUInt16BE(count * 16 - 2 ** power * 16, 10);
  let offset = 12 + count * 16, head = 0;
  for (let i = 0; i < count; i++) {
    const source = 44 + i * 20, target = 12 + i * 16;
    const start = woff.readUInt32BE(source + 4);
    const compressed = woff.readUInt32BE(source + 8);
    const length = woff.readUInt32BE(source + 12);
    const bytes = woff.subarray(start, start + compressed);
    const table = compressed < length ? inflateSync(bytes) : bytes;
    if (table.length !== length) throw new Error('Incorrect font table size');
    woff.copy(ttf, target, source, source + 4);
    woff.copy(ttf, target + 4, source + 16, source + 20);
    ttf.writeUInt32BE(offset, target + 8);
    ttf.writeUInt32BE(length, target + 12);
    table.copy(ttf, offset);
    if (woff.toString('ascii', source, source + 4) === 'head') head = offset;
    offset += (length + 3) & ~3;
  }
  if (offset !== ttf.length || !head) throw new Error('Invalid reconstructed font');
  ttf.writeUInt32BE(0, head + 8);
  let sum = 0;
  for (let i = 0; i < ttf.length; i += 4) sum = (sum + ttf.readUInt32BE(i)) >>> 0;
  ttf.writeUInt32BE((0xb1b0afba - sum) >>> 0, head + 8);
  return ttf;
}
export function fontFiles() {
  const cache = new URL('node_modules/.cache/share-fonts/', root);
  mkdirSync(cache, { recursive: true });
  return [
    ['barlow-condensed', 700], ['ibm-plex-sans', 400], ['ibm-plex-sans', 500], ['ibm-plex-mono', 400],
  ].map(([family, weight]) => {
    const name = `${family}-latin-${weight}-normal`;
    const source = new URL(`node_modules/@fontsource/${family}/files/${name}.woff`, root);
    const target = new URL(`${name}.ttf`, cache);
    writeFileSync(target, unpackFont(readFileSync(source)));
    return fileURLToPath(target);
  });
}
export function ogSvg() {
  const sample = JSON.parse(read('data/sample.json')).items.find((item) => item.id === '00');
  const p = ({ lat, lng }) => [(lng + 180) * 320 / 360, (90 - lat) * 160 / 180];
  const a = p(sample.made), b = p(sample.kept);
  const values = {
    made: pathData('src/assets/pins/made.svg'), kept: pathData('src/assets/pins/kept.svg'),
    world: pathData('src/assets/maps/world.svg'),
    photo: `data:image/jpeg;base64,${readFileSync(new URL('images/00.jpg', root)).toString('base64')}`,
    madePoint: a.join(' '), keptPoint: b.join(' '),
    madeAnchor: [a[0] - 16 * .55, a[1] - 37 * .55].join(' '),
    keptAnchor: [b[0] - 16 * .55, b[1] - 37 * .55].join(' '),
  };
  const svg = read('src/assets/og/share.svg').replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const [group, name] = key.split('.');
    const value = name ? token[group]?.[name] : values[key];
    if (value === undefined) throw new Error(`Unknown share-image slot: ${key}`);
    return value;
  });
  return optimize(svg, { multipass: true }).data;
}
export function renderOg() {
  return new Resvg(ogSvg(), { font: { loadSystemFonts: false, fontFiles: fontFiles() } }).render().asPng();
}
export function renderIcon(size) {
  return new Resvg(read('public/favicon.svg'), { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } }).render().asPng();
}
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--icons')) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="4" fill="${token.color.bg}"/><path d="${pathData('src/assets/pins/made.svg')}" transform="translate(3 12) scale(.8)" fill="${token.color.made}"/><path d="M29 26h5" stroke="${token.color['answer-line']}" stroke-width="2"/><path d="${pathData('src/assets/pins/kept.svg')}" transform="translate(35 12) scale(.8)" fill="${token.color.kept}"/></svg>`;
  writeFileSync(new URL('public/favicon.svg', root), optimize(svg, { multipass: true }).data + '\n');
  writeFileSync(new URL('public/favicon.png', root), renderIcon(32));
  writeFileSync(new URL('public/apple-touch-icon.png', root), renderIcon(180));
  console.log('Rendered favicon.svg, favicon.png (32px), apple-touch-icon.png (180px)');
}
