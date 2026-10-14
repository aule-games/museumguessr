import { describe, expect, it } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import countries from '../../src/map/data/countries.json';
import placesFile from '../../src/map/data/places.json';
import { countryAt, dropLabel, nearestPlace, snapTarget, type Place } from '../../src/map/places';
import { fallbackStyle, mainStyle, TILEJSON_URL } from '../../src/map/styles';

const places = placesFile.places as unknown as Place[];
const fc = countries as GeoJSON.FeatureCollection;

describe('[DS4] drop label', () => {
  it('names the nearest bundled city', () => {
    expect(dropLabel({ lat: 52.53, lng: 13.38 }, places, fc)).toEqual({ kind: 'near', place: 'Berlin', country: 'Germany' });
  });
  it('[ENG25] says the country or open sea beyond 250 km of any place', () => {
    const sea = dropLabel({ lat: -40, lng: -130 }, places, fc);
    expect(sea).toEqual({ kind: 'sea' });
    const far = nearestPlace({ lat: -40, lng: -130 }, places);
    expect(far?.km).toBeGreaterThan(250);
    expect(countryAt({ lat: 46.8, lng: 2.4 }, fc)).toBe('France');
  });
});

describe('[DS33] pin snapping', () => {
  it('snaps within 30 px and not beyond', () => {
    const berlin = { lat: 52.52, lng: 13.405 };
    expect(snapTarget({ lat: 52.6, lng: 13.5 }, places, () => 12)).toMatchObject({ lat: expect.closeTo(52.52, 1) });
    expect(snapTarget({ lat: 52.6, lng: 13.5 }, places, () => 45)).toBeNull();
    expect(snapTarget(berlin, places, () => 0)).not.toBeNull();
  });
  it('never snaps in the open sea', () => {
    expect(snapTarget({ lat: -40, lng: -130 }, places, () => 0)).toBeNull();
  });
});

describe('[ENG32] [ENG9] map styles', () => {
  it('main and fallback styles validate against the style spec', () => {
    expect(validateStyleMin(mainStyle())).toEqual([]);
    expect(validateStyleMin(fallbackStyle(fc))).toEqual([]);
  });
  it('uses the TileJSON URL, never a dated tile URL', () => {
    const json = JSON.stringify(mainStyle());
    expect(json).toContain(TILEJSON_URL);
    expect(json).not.toMatch(/planet\/\d{8}/);
  });
  it('a legacy-filter fixture fails validation', () => {
    const style = mainStyle();
    (style.layers[1] as { filter: unknown }).filter = ['==', 'class', 'ice', 'extra'];
    expect(validateStyleMin(style).length).toBeGreaterThan(0);
  });
});
