#!/usr/bin/env node
// Builds the bundled map data from Natural Earth (public domain):
//   src/map/data/countries.json  fallback map outlines (1:110m), coordinates rounded
//   src/map/data/places.json     ~2,000 populated places for "Near X" labels and pin snapping
// Run: node scripts/map-data.mjs   (downloads from the Natural Earth GitHub mirror)

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = `${ROOT}src/map/data/`;
const UA = 'MuseumGuessr/0.1 (https://github.com/aule-games/museumguessr; content tooling)';
const SRC = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';

async function get(name) {
  const res = await fetch(`${SRC}${name}.geojson`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
const roundCoords = (c, d) => (typeof c[0] === 'number' ? [round(c[0], d), round(c[1], d)] : c.map((x) => roundCoords(x, d)));

const countries = await get('ne_110m_admin_0_countries');
const outlines = {
  type: 'FeatureCollection',
  features: countries.features.map((f) => ({
    type: 'Feature',
    properties: { name: f.properties.NAME_EN || f.properties.NAME },
    geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates, 2) },
  })),
};

const populated = await get('ne_10m_populated_places_simple');
const keep = populated.features
  .map((f) => f.properties)
  .filter((p) => p.scalerank <= 5 || p.pop_max >= 300000 || p.adm0cap === 1 || p.worldcity === 1)
  .sort((a, b) => a.scalerank - b.scalerank || b.pop_max - a.pop_max);
// [name, country, lat, lng, rank] — rank orders labels on the fallback map (lower = more important)
const places = keep.map((p) => [p.name, p.adm0name, round(p.latitude, 3), round(p.longitude, 3), p.scalerank]);

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}countries.json`, JSON.stringify(outlines));
writeFileSync(
  `${OUT}places.json`,
  JSON.stringify({ source: 'Natural Earth 1:10m populated places (public domain)', fields: ['name', 'country', 'lat', 'lng', 'rank'], places }),
);
console.log(`countries: ${outlines.features.length} features; places: ${places.length}`);
