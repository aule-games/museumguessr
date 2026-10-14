// Map styles (ENG9, ENG32, DX32). Colours come from the single token source.
// The main style uses OpenFreeMap vector tiles through their TileJSON URL
// (never dated tile URLs); the fallback style uses bundled Natural Earth
// outlines and needs no network and no glyphs (city labels are DOM markers).

import type { StyleSpecification } from 'maplibre-gl';
import tokens from '../design/tokens.json';

export const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
export const GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const FONT = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];

const m = tokens.map;
const NAME_EN: ['coalesce', ['get', string], ['get', string]] = ['coalesce', ['get', 'name:en'], ['get', 'name']];

export function mainStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'museumguessr-main',
    glyphs: GLYPHS_URL,
    sources: {
      openmaptiles: { type: 'vector', url: TILEJSON_URL },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': m.land } },
      {
        id: 'landcover-ice',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['==', ['get', 'class'], 'ice'],
        paint: { 'fill-color': m.landcover, 'fill-opacity': 0.6 },
      },
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': m.water } },
      {
        id: 'roads-major',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 6,
        filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], true, false],
        paint: { 'line-color': m.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 12, 2] },
      },
      {
        id: 'boundary-minor',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'boundary',
        minzoom: 4,
        filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': m['border-minor'], 'line-width': 0.6, 'line-dasharray': [2, 2] },
      },
      {
        id: 'boundary-country',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'boundary',
        filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': m.border, 'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.6, 6, 1.4] },
      },
      {
        id: 'label-country',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        maxzoom: 7,
        filter: ['==', ['get', 'class'], 'country'],
        layout: {
          'text-field': NAME_EN,
          'text-font': FONT_BOLD,
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, 10, 6, 14],
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.08,
          'text-max-width': 8,
        },
        paint: { 'text-color': m.label, 'text-halo-color': m['label-halo'], 'text-halo-width': 1.4 },
      },
      {
        id: 'label-city',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        minzoom: 3,
        filter: ['match', ['get', 'class'], ['city', 'town'], true, false],
        layout: {
          'text-field': NAME_EN,
          'text-font': FONT,
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, 11, 10, 15],
          'text-max-width': 8,
          'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
        },
        paint: { 'text-color': m['label-city'], 'text-halo-color': m['label-halo'], 'text-halo-width': 1.4 },
      },
    ],
  };
}

export function fallbackStyle(countries: GeoJSON.FeatureCollection): StyleSpecification {
  return {
    version: 8,
    name: 'museumguessr-fallback',
    sources: {
      countries: { type: 'geojson', data: countries },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': m.water } },
      { id: 'land', type: 'fill', source: 'countries', paint: { 'fill-color': m.land } },
      { id: 'borders', type: 'line', source: 'countries', paint: { 'line-color': m.border, 'line-width': 0.8 } },
    ],
  };
}
