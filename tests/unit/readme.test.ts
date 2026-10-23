import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOGUE } from '../../src/analytics/catalogue';
import { COPY } from '../../src/copy';
import { halfDistanceKm } from '../../src/game/text';
import { DISTANCE, TIERS, YEARS } from '../../src/scoring/config';
import { distancePoints, madeFullMarksKm, scoreYear } from '../../src/scoring/score';

const ROOT = join(import.meta.dirname, '../..');
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
const analytics = readFileSync(join(ROOT, 'docs/analytics.md'), 'utf8');
const items = ['data/items.json', 'data/sample.json'].flatMap(
  (f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8')).items as { title: string; photo: { author: string; licence: string; source_url: string } }[],
);
const fmt = (n: number) => n.toLocaleString('en-US');

describe('[DX15] README scoring matches src/scoring/config.ts', () => {
  it('states the halving distance the reveal explains', () => {
    expect(readme).toContain(`halve about every ${halfDistanceKm()} km`);
  });
  it('states the constants', () => {
    expect(readme).toContain(`\`r\` is ${DISTANCE.keptFullMarksKm} km around the museum's city`);
    const { city, region, country } = DISTANCE.madeFullMarksKm;
    expect(readme).toContain(`${city} km for a city, ${region} km for`);
    expect(readme).toContain(`a region, ${country} km for`);
    expect(readme).toContain(`e^(−(d − r) / ${DISTANCE.decayKm})`);
    expect(readme).toContain(`margin = ${YEARS.toleranceBase} + ${YEARS.tolerancePerYearOfAge} × age`);
    expect(readme).toContain(`age = ${YEARS.referenceYear} − middle`);
    for (const tier of TIERS) expect(readme).toContain(`${tier.name} (${tier.min === 0 ? 'from 0' : fmt(tier.min)})`);
  });

  it('every worked example is what the game scores', () => {
    const row = (label: string, points: number) => expect(readme).toMatch(new RegExp(`\\| ${label.replace(/[()]/g, '\\$&')}[^|]*\\| ${points} \\|`));
    row('Kept, 500 km from the museum', distancePoints(500, DISTANCE.keptFullMarksKm));
    row('Kept, 2,000 km off', distancePoints(2000, DISTANCE.keptFullMarksKm));
    row('Made, a region-level place, 800 km off', distancePoints(800, madeFullMarksKm('region')));
    const painting = scoreYear(1850, 1884, 1886);
    row(`When, a painting dated 1884–1886, guess 1850 (${painting.yearsOff} years off, margin ${Math.round(painting.toleranceYears * 100) / 100})`, painting.points);
    const sculpture = scoreYear(-1000, -883, -859);
    row(`When, a sculpture dated 883–859 BCE, guess 1000 BCE (${sculpture.yearsOff} years off, margin ${Math.round(sculpture.toleranceYears * 100) / 100})`, sculpture.points);
  });
});

describe('[V2] [ENG19] [LIC1] README credits and privacy', () => {
  it.each(items.map((it) => [it.title, it] as const))('credits the photo of %s', (_title, it) => {
    expect(readme).toContain(it.title);
    expect(readme).toContain(it.photo.author);
    expect(readme).toContain(it.photo.source_url);
  });

  it('names every code library with the licence its package declares', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    const names: Record<string, string> = { 'maplibre-gl': 'MapLibre GL JS', photoswipe: 'PhotoSwipe', 'posthog-js': 'posthog-js' };
    for (const dep of Object.keys(pkg.dependencies).filter((d) => !d.startsWith('@fontsource/'))) {
      const licence = (JSON.parse(readFileSync(join(ROOT, 'node_modules', dep, 'package.json'), 'utf8')).license as string).replace(/^\((.*)\)$/, '$1');
      expect(names[dep], `README label for ${dep}`).toBeDefined();
      expect(readme).toContain(`${names[dep]} (${licence})`);
    }
    expect(readme).toContain('licenses.txt');
  });

  it('says every image keeps its own licence', () => {
    expect(readme).toMatch(/every (photo|image) keeps its own licence/i);
  });

  it('carries the privacy line and names every event sent, as does docs/analytics.md', () => {
    expect(readme).toContain('No cookies. Anonymous play counts via PostHog (EU).');
    for (const e of CATALOGUE) {
      expect(readme).toContain(`\`${e.name}\``);
      expect(analytics).toContain(`\`${e.name}\``);
    }
  });

  it('README and the in-game privacy text disclose automatic entry under a stable generated name, the score and date, the device-only key and the weekly marker [V12-120] [V12-135]', () => {
    const flat = readme.replace(/\s+/g, ' ');
    expect(flat).toContain(COPY['board.disclosure']);
    for (const text of [flat, `${COPY['board.disclosure']} ${COPY['board.privacy']} ${COPY['about.device']}`]) {
      expect(text).toMatch(/generated (three-word )?name/);
      expect(text).toMatch(/the score and the date/);
      expect(text).toMatch(/same (for this device across weeks|every week)/);
      expect(text).toMatch(/only to this site/);
      expect(text).toMatch(/never to analytics/);
      expect(text).toMatch(/last week in which it finished a game/);
    }
    // no claim that nothing is kept on the device
    expect(flat).not.toMatch(/stores nothing|keeps nothing on (your|the) device/i);
  });

  it('README and the in-game privacy text both name the technical details PostHog adds and the kept ref parameter', () => {
    for (const text of [readme.replace(/\s+/g, ' '), COPY['about.body']]) {
      for (const detail of ['browser', 'operating system', 'device type', 'screen', 'language', 'time zone', 'site that linked here', 'ref']) {
        expect(text).toContain(detail);
      }
    }
  });
});
