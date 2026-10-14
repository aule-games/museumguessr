// Rebuild the decorative equirectangular mini map from the bundled Natural
// Earth 1:110m countries (public domain). No network or scoring geometry.
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { optimize } from 'svgo';
const root = new URL('../../', import.meta.url);
const countries = JSON.parse(readFileSync(new URL('src/map/data/countries.json', root), 'utf8'));
const point = ([lng, lat]) => [(lng + 180) * 320 / 360, (90 - lat) * 160 / 180];
function simplify(points, tolerance = 0.22) {
  if (points.length <= 2) return points;
  const [ax, ay] = points[0];
  const [bx, by] = points.at(-1);
  let max = tolerance ** 2, at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2) || 0));
    const d = (x - ax - t * (bx - ax)) ** 2 + (y - ay - t * (by - ay)) ** 2;
    if (d > max) { max = d; at = i; }
  }
  return at ? [...simplify(points.slice(0, at + 1), tolerance).slice(0, -1), ...simplify(points.slice(at), tolerance)] : [points[0], points.at(-1)];
}
const rings = countries.features.flatMap(({ geometry: g }) => g.type === 'Polygon' ? g.coordinates : g.coordinates.flat());
const d = rings.map((ring) => simplify(ring.map(point))).filter((ring) => ring.length > 3)
  .map((ring) => `M${ring.map((p) => p.map((n) => +n.toFixed(1)).join(',')).join('L')}Z`).join('');
const svg = optimize(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 160"><path fill="currentColor" d="${d}"/></svg>`, { multipass: true }).data;
writeFileSync(new URL('src/assets/maps/world.svg', root), svg + '\n');
console.log(`Static world: ${Buffer.byteLength(svg)} bytes; ${gzipSync(svg).length} bytes gzip`);
