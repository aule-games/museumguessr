import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { check, processImage } from '../../scripts/items.mjs';

const REPO = join(import.meta.dirname, '../..');

// Ten synthetic items held in ten different cities, spread over the world and over time.
const PLACES = [
  ['New York', 'United States', 40.78, -73.96],
  ['Chicago', 'United States', 41.88, -87.62],
  ['London', 'United Kingdom', 51.52, -0.13],
  ['Madrid', 'Spain', 40.41, -3.69],
  ['Tokyo', 'Japan', 35.72, 139.77],
  ['Cairo', 'Egypt', 30.05, 31.23],
  ['Sydney', 'Australia', -33.87, 151.21],
  ['Lima', 'Peru', -12.05, -77.04],
  ['Delhi', 'India', 28.61, 77.21],
  ['Cape Town', 'South Africa', -33.92, 18.42],
] as const;
const DATES = [-2500, -1200, -500, -10, 300, 800, 1200, 1500, 1700, 1880];
// Countries whose heritage image rules flag an object held or made there (docs/content.md "Heritage").
const HERITAGE = ['Italy', 'Greece', 'Vatican City', 'Egypt', 'Mexico', 'Russia', 'Turkey', 'Peru', 'Iraq'];

function record(i: number, id = String(i + 1).padStart(2, '0')) {
  const [city, country, lat, lng] = PLACES[i % 10] as (typeof PLACES)[number];
  const [mcity, mcountry, mlat, mlng] = PLACES[(i + 3) % 10] as (typeof PLACES)[number];
  return {
    id,
    title: `Object number ${id}`,
    difficulty: i < 3 ? 1 : 2,
    object_type: 'sculpture',
    alt_neutral: 'Carved stone panel with two standing figures and a border of leaves',
    caption: 'Carved stone panel: two standing figures in a border of leaves',
    record_url: `https://example.org/objects/${id}`,
    wikidata_url: 'https://www.wikidata.org/wiki/Q1',
    kept: { museum: 'Example Museum', city, country, lat, lng, source_url: 'https://example.org/k' },
    made: {
      place: mcity,
      country: mcountry,
      precision: 'city',
      wikidata_url: 'https://www.wikidata.org/wiki/Q2',
      lat: mlat,
      lng: mlng,
      source_url: 'https://example.org/m',
      note: null,
      full_marks_km: null,
    },
    when: { start: DATES[i % 10], end: (DATES[i % 10] as number) + 20 || 1, label: 'ca.', source_url: 'https://example.org/w' },
    moved: true,
    journey_fact: { text: 'Bought by the museum in 1901; earlier owners not documented.', source_url: 'https://example.org/j' },
    facts: [{ text: 'A fact.', source_url: 'https://example.org/f' }],
    photo: {
      source_url: 'https://example.org/p',
      file_url: 'https://example.org/p.jpg',
      author: 'Example Museum',
      licence: 'CC0 1.0',
      pd_basis: 'Ancient work',
      crop_note: null,
    },
    conflicts: [],
    contested: false,
    claimant_source: null,
    heritage_image_law: HERITAGE.includes(country) || HERITAGE.includes(mcountry),
    retrieved: '2026-10-13',
  };
}

let root: string;
const write = (file: string, data: unknown) => writeFileSync(join(root, file), `${JSON.stringify(data, null, 2)}\n`);
const read = (file: string) => JSON.parse(readFileSync(join(root, file), 'utf8'));

async function jpeg(seed: number, w = 400, h = 300) {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: seed * 20, g: 100, b: 150 } } })
    .jpeg()
    .toBuffer();
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'mg-items-'));
  mkdirSync(join(root, 'data'));
  mkdirSync(join(root, 'images'));
  cpSync(join(REPO, 'data/items.schema.json'), join(root, 'data/items.schema.json'));
  cpSync(join(REPO, 'data/regions.json'), join(root, 'data/regions.json'));
  write('data/items.json', { items: Array.from({ length: 10 }, (_, i) => record(i)) });
  write('data/reserve.json', { items: [record(4, '14')] });
  write('data/sample.json', { items: [record(0, '00')] });
  for (const id of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '00']) {
    writeFileSync(join(root, 'images', `${id}.jpg`), await jpeg(Number(id)));
  }
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const problemsOf = async () => (await check(root, { quiet: true })).problems as { where: string; problem: string; id: string; fix: string; docs: string }[];

describe('[E7] [DX5] items:check', () => {
  it('passes a complete fixture set', async () => {
    expect(await problemsOf()).toEqual([]);
  });

  it('accepts an object dated as early as 40000 BCE [V12-144]', async () => {
    const data = read('data/items.json');
    data.items[5].when = { ...data.items[5].when, start: -40000, end: -38000 };
    write('data/items.json', data);
    expect(await problemsOf()).toEqual([]);
  });

  it('names the item id and field for a missing field, with why, fix and docs', async () => {
    const data = read('data/items.json');
    delete data.items[3].kept.source_url;
    write('data/items.json', data);
    const [p] = await problemsOf();
    expect(p?.where).toBe('item 04 · kept');
    expect(p?.problem).toContain('source_url');
    expect(p?.id).toBe('E7');
    expect(p?.fix).toBeTruthy();
    expect(p?.docs).toMatch(/^docs\/content\.md#/);
  });

  it.each([
    ['year 0', (d: any) => (d.items[5].when.start = 0), 'item 06 · when.start'],
    ['[V12-144] a date before 40000 BCE', (d: any) => (d.items[5].when.start = -40001), 'item 06 · when.start'],
    ['[V12-144] a date after 2025 CE', (d: any) => (d.items[5].when.end = 2026), 'item 06 · when.end'],
    ['start after end', (d: any) => (d.items[5].when = { ...d.items[5].when, start: 900, end: 800 }), 'item 06 · when'],
    ['http URL', (d: any) => (d.items[1].record_url = 'http://example.org'), 'item 02 · record_url'],
    ['bad licence', (d: any) => (d.items[1].photo.licence = 'CC BY-NC 4.0'), 'item 02 · photo.licence'],
    ['title over 70', (d: any) => (d.items[1].title = 'x'.repeat(71)), 'item 02 · title'],
    ['journey fact over 240', (d: any) => (d.items[1].journey_fact.text = 'x'.repeat(241)), 'item 02 · journey_fact.text'],
    ['fact over 200', (d: any) => (d.items[1].facts[0].text = 'x'.repeat(201)), 'item 02 · facts.0.text'],
    ['moved without journey fact', (d: any) => (d.items[1].journey_fact = null), 'item 02 · journey_fact'],
    ['contested without claimant source', (d: any) => (d.items[1].contested = true), 'item 02 · claimant_source'],
    ['answer word in alt text', (d: any) => (d.items[4].alt_neutral = 'Stone panel from tokyo with two figures'), 'item 05 · alt_neutral'],
    ['title phrase in alt text', (d: any) => (d.items[4].alt_neutral = 'A panel showing object number five'), 'item 05 · alt_neutral'],
    ['date in alt text', (d: any) => (d.items[4].alt_neutral = 'Stone panel with two figures dated 1450'), 'item 05 · alt_neutral'],
    ['[DS37] answer word in the caption', (d: any) => (d.items[4].caption = 'Stone panel from tokyo with two figures'), 'item 05 · caption'],
    ['[DS37] title phrase in the caption', (d: any) => (d.items[4].caption = 'A panel showing object number five'), 'item 05 · caption'],
    ['[DS37] date in the caption', (d: any) => (d.items[4].caption = 'Stone panel with two figures, 1450'), 'item 05 · caption'],
    ['[DS37] caption over 70', (d: any) => (d.items[4].caption = 'x'.repeat(71)), 'item 05 · caption'],
    ['[DS37] missing caption', (d: any) => delete d.items[4].caption, 'item 05 · (record)'],
    ['heritage flag missing', (d: any) => (d.items[0].made.country = 'Italy'), 'item 01 · heritage_image_law'],
    ['[DX6] a photo crop without a crop note', (d: any) => (d.items[1].photo.crop = [0, 0, 0.1, 0]), 'item 02 · photo.crop_note'],
    ['[DX6] a photo crop that cuts away most of a side', (d: any) => (d.items[1].photo = { ...d.items[1].photo, crop: [0.5, 0, 0.45, 0], crop_note: 'label' }), 'item 02 · photo.crop'],
    ['[DX6] a photo crop without four fractions', (d: any) => (d.items[1].photo = { ...d.items[1].photo, crop: [0, 0.1, 0], crop_note: 'label' }), 'item 02 · photo.crop'],
    ['[V1-08] region-level round 2 (difficulty 1)', (d: any) => (d.items[1].made.precision = 'region'), 'item 02 · difficulty'],
    ['[V1-08] conflict in round 3 (difficulty 1)', (d: any) => (d.items[2].conflicts = ['x']), 'item 03 · difficulty'],
    ['[V1-08] a harder object in round 1 of the fixed set', (d: any) => (d.items[0].difficulty = 2), 'item 01 · difficulty'],
    ['radius over the cap', (d: any) => (d.items[6].made.full_marks_km = 5000), 'item 07 · made.full_marks_km'],
    ['duplicate id', (d: any) => (d.items[9].id = '14'), 'reserve 14 · id'],
  ])('rejects %s', async (_name, mutate, where) => {
    const data = read('data/items.json');
    mutate(data);
    write('data/items.json', data);
    const ps = await problemsOf();
    expect(ps.map((p) => p.where)).toContain(where);
  });

  it('flags an object held in or made in Italy, Greece, Vatican City, Egypt, Mexico, Russia, Turkey, Peru or Iraq [V12-142]', async () => {
    // Item 01 is kept in New York and made in Madrid: no flag.
    const original = read('data/items.json');
    for (const country of HERITAGE) {
      for (const side of ['kept', 'made'] as const) {
        const data = structuredClone(original);
        data.items[0][side].country = country;
        write('data/items.json', data);
        const unflagged = (await problemsOf()).find((p) => p.where === 'item 01 · heritage_image_law');
        expect(unflagged?.problem, `${side} in ${country}`).toBe('is false but should be true');
        expect(unflagged?.id).toBe('V12-142');
      }
    }
    const flagged = structuredClone(original);
    flagged.items[0].kept.country = 'Turkey';
    flagged.items[0].heritage_image_law = true;
    write('data/items.json', flagged);
    expect(await problemsOf()).toEqual([]);
  }, 60_000);

  it('does not flag an object held and made where no heritage image rule was found [V12-142]', async () => {
    const original = read('data/items.json');
    for (const country of ['United States', 'Spain', 'Taiwan', 'Germany', 'France', 'Japan']) {
      const data = structuredClone(original);
      data.items[0].made.country = country;
      data.items[0].heritage_image_law = true;
      write('data/items.json', data);
      const flagged = (await problemsOf()).find((p) => p.where === 'item 01 · heritage_image_law');
      expect(flagged?.problem, country).toBe('is true but should be false');
    }
  }, 30_000);

  it('rejects a holding city used more than twice and fewer than 6 cities', async () => {
    const data = read('data/items.json');
    for (const i of [1, 2, 3, 4, 5, 6]) data.items[i].kept = { ...data.items[0].kept };
    write('data/items.json', data);
    const ps = await problemsOf();
    expect(ps.some((p) => p.where === 'holding city New York')).toBe(true);
    expect(ps.some((p) => p.problem.includes('fewer than 6'))).toBe(true);
  });

  it('rejects a missing image, an oversized image, and a reserve image file', async () => {
    rmSync(join(root, 'images/03.jpg'));
    writeFileSync(join(root, 'images/04.jpg'), await jpeg(4, 2000, 1000));
    writeFileSync(join(root, 'images/14.jpg'), await jpeg(14));
    const ps = await problemsOf();
    expect(ps.map((p) => p.where)).toEqual(expect.arrayContaining(['item 03 · image', 'item 04 · image', 'reserve 14 · image']));
  });

  it('rejects image metadata', async () => {
    const withExif = await sharp(await jpeg(5)).withMetadata({ exif: { IFD0: { Copyright: 'x' } } }).jpeg().toBuffer();
    writeFileSync(join(root, 'images/05.jpg'), withExif);
    const ps = await problemsOf();
    expect(ps.find((p) => p.where === 'item 05 · image')?.problem).toContain('metadata');
  });

  it('rejects a non-CC0 sample photo', async () => {
    const s = read('data/sample.json');
    s.items[0].photo.licence = 'CC BY-SA 4.0';
    write('data/sample.json', s);
    expect((await problemsOf()).map((p) => p.where)).toContain('sample 00 · photo.licence');
  });

  it('warns when fewer than two ready reserve records remain [V12-151]', async () => {
    const warned = async () => (await check(root, { quiet: true })).warnings.some((w: { where: string; id: string }) => w.where === 'data/reserve.json' && w.id === 'V12-151');
    expect(await warned()).toBe(true);
    write('data/reserve.json', { items: [record(4, '14'), record(5, '15')] });
    expect(await warned()).toBe(false);
  });

  it('reports the holding-city spread and the baselines', async () => {
    const { info } = await check(root, { quiet: true });
    expect(info[0]).toBe('holding cities: 10 distinct, max 1 per city');
    expect(info.some((l: string) => l.startsWith('baseline kept:'))).toBe(true);
  });
});

describe('[DX6] [ENG26] add-image pipeline', () => {
  it('outputs upright sRGB, <= 1600 px, <= 250 KB, without metadata', async () => {
    const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 0, g: 0, b: 0 }, noise: { type: 'gaussian', mean: 128, sigma: 60 } } })
      .withMetadata({ orientation: 6, exif: { IFD0: { Artist: 'someone' } } })
      .jpeg({ quality: 95 })
      .toBuffer();
    const out = await processImage(big);
    const meta = await sharp(out).metadata();
    expect(out.length).toBeLessThanOrEqual(250 * 1024);
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1600);
    expect(meta.height).toBeGreaterThan(meta.width ?? 0); // rotated upright (orientation 6)
    expect(meta.exif).toBeUndefined();
    expect(meta.space).toBe('srgb');
  }, 30_000); // a 12-megapixel encode takes over 5 s on a CI runner

  it('refuses to overwrite without --force', () => {
    const run = () =>
      execFileSync(process.execPath, [join(REPO, 'scripts/items.mjs'), 'add-image', '01', join(root, 'images/02.jpg'), '--root', root], {
        stdio: 'pipe',
      });
    expect(run).toThrow();
  });
});

const cli = (...args: string[]) => execFileSync(process.execPath, [join(REPO, 'scripts/items.mjs'), ...args, '--root', root], { stdio: 'pipe' });
const ids = (file: string) => read(file).items.map((r: { id: string }) => r.id);

describe('[DX23] swap', () => {
  it('leaves both files unchanged when the reserve image cannot be fetched', () => {
    const before = [readFileSync(join(root, 'data/items.json'), 'utf8'), readFileSync(join(root, 'data/reserve.json'), 'utf8')];
    expect(() => cli('swap', '14', '05', '--image', join(root, 'does-not-exist.jpg'))).toThrow();
    expect(readFileSync(join(root, 'data/items.json'), 'utf8')).toBe(before[0]);
    expect(readFileSync(join(root, 'data/reserve.json'), 'utf8')).toBe(before[1]);
  });

  it('[DX6] cuts the reserve record\'s recorded photo crop from its photo', async () => {
    const reserve = read('data/reserve.json');
    reserve.items[0].photo = { ...reserve.items[0].photo, crop: [0, 0.5, 0, 0], crop_note: 'Right half cut away: a wall label' };
    write('data/reserve.json', reserve);
    const src = join(root, 'src14.jpg');
    writeFileSync(src, await jpeg(14, 400, 300));
    cli('swap', '14', '05', '--image', src);
    const meta = await sharp(join(root, 'images/14.jpg')).metadata();
    expect([meta.width, meta.height]).toEqual([200, 300]);
  });

  it('puts a reserve record where a pool item was and moves the displaced record to the reserve', () => {
    const src = join(root, 'src14.jpg');
    writeFileSync(src, readFileSync(join(root, 'images/05.jpg')));
    cli('swap', '14', '05', '--image', src);
    expect(read('data/items.json').items[4].id).toBe('14');
    expect(ids('data/reserve.json')).toEqual(['05']);
    expect(existsSync(join(root, 'images/14.jpg'))).toBe(true);
    expect(existsSync(join(root, 'images/05.jpg'))).toBe(false);
  });
});

describe('[V1-12] promote and retire', () => {
  it('refuses the old slot form and names the replacement commands', () => {
    let out = '';
    try {
      cli('promote', '14', '5');
    } catch (e) {
      out = String((e as { stderr: Buffer }).stderr);
    }
    expect(out).toMatch(/slot form .* is gone/);
    expect(out).toMatch(/items:promote -- --ids 14/);
    expect(out).toMatch(/items:swap -- 14/);
  });

  it('promote --ids appends a batch only when the whole pool passes, and writes nothing otherwise [V12-149]', () => {
    const before = readFileSync(join(root, 'data/items.json'), 'utf8');
    const src = join(root, 'src14.jpg');
    writeFileSync(src, readFileSync(join(root, 'images/05.jpg')));
    // 11 objects is neither the fixed 10 nor a drawable 30: refused, nothing written
    expect(() => cli('promote', '--ids', '14', '--image', src)).toThrow();
    expect(readFileSync(join(root, 'data/items.json'), 'utf8')).toBe(before);
    expect(existsSync(join(root, 'images/14.jpg'))).toBe(false);
  });

  it('retire needs a replacement at the minimum, then records the id so it is never reused [V12-151]', async () => {
    expect(() => cli('retire', '07', '--reason', 'rights withdrawn')).toThrow();
    const src = join(root, 'src14.jpg');
    writeFileSync(src, readFileSync(join(root, 'images/05.jpg')));
    cli('retire', '07', '--replace', '14', '--reason', 'rights withdrawn', '--image', src);
    expect(read('data/items.json').items[6].id).toBe('14');
    expect(ids('data/reserve.json')).toEqual([]);
    expect(read('data/retired.json').ids).toMatchObject([{ id: '07', reason: 'rights withdrawn', key: { id: '07', answers_rev: 1 } }]);
    expect(existsSync(join(root, 'images/07.jpg'))).toBe(false);
    // the retired id can never come back
    const data = read('data/reserve.json');
    data.items.push({ ...read('data/items.json').items[0], id: '07' });
    write('data/reserve.json', data);
    const ps = await problemsOf();
    expect(ps.find((p) => p.where === 'reserve 07 · id')?.problem).toMatch(/was retired on/);
  });
});

describe('[V1-12] the contact sheet', () => {
  it('renders one JPEG cell per listed record from the committed photos', async () => {
    const out = join(root, 'sheet.jpg');
    cli('sheet', '--ids', '01,02,03', '--out', out);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(3 * 420);
    expect(meta.height).toBe(450);
  });

  it('refuses an unknown id', () => {
    expect(() => cli('sheet', '--ids', '01,98', '--out', join(root, 'x.jpg'))).toThrow();
  });
});
