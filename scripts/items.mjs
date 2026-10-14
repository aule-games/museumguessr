#!/usr/bin/env node
// Items CLI (E7, DX5, DX6, DX23, ENG26, ENG27). One tool for the content files:
//
//   node scripts/items.mjs check                 validate data/ and images/
//   node scripts/items.mjs new <id>              print a complete record skeleton
//   node scripts/items.mjs add-image <id> <url|file> [--force]
//   node scripts/items.mjs promote <reserve-id> <slot 1-10>
//
// Every command accepts --root <dir> (used by the fixture tests).
// Errors follow one format: problem, why (with requirement ID), fix, docs anchor.

import { existsSync, mkdtempSync, readFileSync, writeFileSync, cpSync, rmSync, statSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import sharp from 'sharp';
import { printProblems } from './lib/report.mjs';
import { CONSTANTS_LOCKED, DISTANCE, SLIDER } from '../src/scoring/config.ts';
import { distanceKm } from '../src/scoring/geo.ts';
import { madeFullMarksKm } from '../src/scoring/score.ts';
import { BASELINE_LIMIT, bestConstantPlace, bestConstantYear } from '../src/scoring/fairness.ts';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const DOCS = 'docs/content.md';
const UA = 'MuseumGuessr/0.1 (https://github.com/aule-games/museumguessr; content tooling)';
export const ROUNDS = 10;
export const MAX_IMAGE_PX = 1600;
export const MAX_IMAGE_BYTES = 250 * 1024;
const HERITAGE_COUNTRIES = ['italy', 'greece'];
const SAMPLE_LICENCES = ['CC0 1.0', 'Public domain', 'PD-Art'];
const STOPWORDS = new Set(
  'the and with from this that their there museum museo musee gallery national collection collections city kingdom states united state republic about into made kept over under near'.split(
    ' ',
  ),
);

function args(argv) {
  const out = { _: [], root: REPO, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') out.root = resolve(argv[++i]);
    else if (a === '--force') out.force = true;
    else if (a === '--image') out.image = argv[++i];
    else if (a === '--crop') out.crop = argv[++i].split(',').map(Number);
    else if (a === '--help' || a === '-h') out.help = true;
    else out._.push(a);
  }
  return out;
}

const paths = (root) => ({
  schema: join(root, 'data/items.schema.json'),
  items: join(root, 'data/items.json'),
  reserve: join(root, 'data/reserve.json'),
  sample: join(root, 'data/sample.json'),
  images: join(root, 'images'),
  image: (id) => join(root, 'images', `${id}.jpg`),
});

function problem(where, problem, why, id, fix, anchor) {
  return { where, problem, why, id, fix, docs: `${DOCS}#${anchor}` };
}

function readJson(file, problems, label) {
  if (!existsSync(file)) {
    problems.push(problem(label, 'file is missing', 'the game and the checks read this file', 'E7', `create ${label}`, 'files'));
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    problems.push(problem(label, `is not valid JSON (${e.message})`, 'the file must parse', 'E7', 'fix the JSON syntax', 'files'));
    return null;
  }
}

function wordsOf(text) {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

function validDate(s) {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Semantic checks for one record. `kind` is items | reserve | sample. */
function checkRecord(item, index, kind, problems, warnings) {
  const where = (field) => `${kind === 'items' ? 'item' : kind} ${item.id ?? `#${index + 1}`} · ${field}`;
  const w = item.when ?? {};
  if (Number.isInteger(w.start) && Number.isInteger(w.end) && w.start > w.end) {
    problems.push(problem(where('when'), `start (${w.start}) is after end (${w.end})`, 'a date range runs from start to end', 'ENG27', 'swap the two years', 'dates'));
  }
  for (const k of ['start', 'end']) {
    if (Number.isInteger(w[k]) && (w[k] < SLIDER.min || w[k] > SLIDER.max)) {
      problems.push(
        problem(
          where(`when.${k}`),
          `${w[k]} is outside the year slider (${SLIDER.min}..${SLIDER.max})`,
          'players could not reach the answer with the year control',
          'DS5',
          'pick another item, or change SLIDER in src/scoring/config.ts',
          'dates',
        ),
      );
    }
  }
  if (item.retrieved && !validDate(item.retrieved)) {
    problems.push(problem(where('retrieved'), `"${item.retrieved}" is not a real date`, 'evidence needs a retrieval date', 'E7', 'use YYYY-MM-DD', 'evidence'));
  }
  const m = item.made ?? {};
  if (m.precision && m.full_marks_km != null && m.full_marks_km > DISTANCE.madeFullMarksKm[m.precision]) {
    problems.push(
      problem(
        where('made.full_marks_km'),
        `${m.full_marks_km} km is larger than the ${m.precision} cap (${DISTANCE.madeFullMarksKm[m.precision]} km)`,
        'an item radius is capped by its precision level',
        'ENG12',
        'lower it or change the precision',
        'made',
      ),
    );
  }
  // H1: heritage flag when held in or made in Italy or Greece
  const k = item.kept ?? {};
  const expectHeritage = [k.country, m.country].some((c) => HERITAGE_COUNTRIES.includes(String(c ?? '').toLowerCase()));
  if (typeof item.heritage_image_law === 'boolean' && item.heritage_image_law !== expectHeritage) {
    problems.push(
      problem(
        where('heritage_image_law'),
        `is ${item.heritage_image_law} but should be ${expectHeritage}`,
        'items held in or made in Italy or Greece carry the flag',
        'H1',
        `set it to ${expectHeritage}`,
        'heritage',
      ),
    );
  }
  // DS6 / A1: neutral alt text carries no place, title phrase or date
  if (typeof item.alt_neutral === 'string') {
    const altWords = wordsOf(item.alt_neutral);
    const alt = new Set(altWords);
    const placeLeaks = [k.city, k.museum, k.country, m.place, m.country].flatMap((t) => wordsOf(t)).filter((t) => alt.has(t));
    const altText = ` ${altWords.join(' ')} `;
    const titleWords = wordsOf(item.title);
    const titleLeaks = titleWords.slice(0, -1).filter((w, i) => altText.includes(` ${w} ${titleWords[i + 1]} `));
    if (placeLeaks.length || titleLeaks.length) {
      problems.push(
        problem(
          where('alt_neutral'),
          `contains ${placeLeaks.length} place word(s) and ${titleLeaks.length} title phrase(s)`,
          'the round must not reveal the answer before the reveal',
          'DS6',
          'describe material, form and composition only',
          'alt-text',
        ),
      );
    }
    if (/\b\d{3,4}\b/.test(item.alt_neutral)) {
      problems.push(problem(where('alt_neutral'), 'contains a number that may be a date', 'the round must not reveal the date', 'A1', 'remove the number', 'alt-text'));
    }
    const proper = item.alt_neutral.split(/[:;.]\s*/).flatMap((part) => part.split(/\s+/).slice(1)).filter((w) => /^\p{Lu}/u.test(w));
    if (proper.length) {
      warnings.push(problem(where('alt_neutral'), `has ${proper.length} capitalised word(s) mid-sentence`, 'names of people, places or cultures give the answer away', 'DS29', 'check that none is a name', 'alt-text'));
    }
  }
  // moved: warn when it disagrees with the places
  if (Number.isFinite(k.lat) && Number.isFinite(m.lat) && typeof item.moved === 'boolean') {
    const km = distanceKm(k, m);
    const radius = m.precision ? madeFullMarksKm(m.precision, m.full_marks_km) : 50;
    if (!item.moved && km > radius + DISTANCE.keptFullMarksKm) {
      warnings.push(problem(where('moved'), `is false but kept and made are ${Math.round(km)} km apart`, 'moved is true when the holding city lies outside the made place', 'E3', 'check moved', 'journey'));
    }
    if (item.moved && m.precision === 'city' && km < 5) {
      warnings.push(problem(where('moved'), 'is true but kept and made are the same city', 'moved is false when held where it was made', 'E3', 'check moved', 'journey'));
    }
  }
}

async function checkImage(id, file, problems, kind) {
  const where = `${kind} ${id} · image`;
  if (!existsSync(file)) {
    problems.push(problem(where, `images/${id}.jpg is missing`, 'an item without its image does not ship', 'E7', `run npm run items:add-image -- ${id} <url>`, 'images'));
    return null;
  }
  const bytes = statSync(file).size;
  let meta;
  try {
    meta = await sharp(file).metadata();
  } catch (e) {
    problems.push(problem(where, `cannot be read (${e.message})`, 'the image must be a valid JPEG', 'DX5', 're-run add-image', 'images'));
    return null;
  }
  if (meta.format !== 'jpeg') problems.push(problem(where, `is ${meta.format}, not JPEG`, 'images are JPEG', 'DX6', 're-run add-image', 'images'));
  if (Math.max(meta.width, meta.height) > MAX_IMAGE_PX) {
    problems.push(problem(where, `is ${meta.width}x${meta.height}, over ${MAX_IMAGE_PX} px`, 'the performance budget caps images', 'PERF1', 're-run add-image', 'images'));
  }
  if (bytes > MAX_IMAGE_BYTES) {
    problems.push(problem(where, `is ${Math.round(bytes / 1024)} KB, over 250 KB`, 'the performance budget caps images', 'PERF1', 're-run add-image', 'images'));
  }
  if (meta.exif || meta.xmp || meta.iptc) {
    problems.push(problem(where, 'carries EXIF/XMP/IPTC metadata', 'committed images must not carry metadata', 'G2', 're-run add-image (it strips metadata)', 'images'));
  }
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export async function check(root, { quiet = false } = {}) {
  const p = paths(root);
  const problems = [];
  const warnings = [];
  const schema = readJson(p.schema, problems, 'data/items.schema.json');
  const files = {
    items: readJson(p.items, problems, 'data/items.json'),
    reserve: readJson(p.reserve, problems, 'data/reserve.json'),
    sample: readJson(p.sample, problems, 'data/sample.json'),
  };
  if (!schema) return report(problems, warnings, quiet);

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  for (const [kind, data] of Object.entries(files)) {
    if (!data) continue;
    if (!validate(data)) {
      for (const err of validate.errors) {
        const parts = err.instancePath.split('/').filter(Boolean);
        const item = parts[0] === 'items' ? data.items?.[Number(parts[1])] : null;
        const field = parts.slice(2).join('.') || '(record)';
        if (err.keyword === 'if' || err.keyword === 'oneOf') continue; // reported by their sub-errors
        problems.push(
          problem(
            `${kind === 'items' ? 'item' : kind} ${item?.id ?? '?'} · ${field}`,
            `${err.message}${err.params?.allowedValues ? ` (${err.params.allowedValues.join(', ')})` : ''}${err.params?.missingProperty ? `: ${err.params.missingProperty}` : ''}`,
            'every item needs complete, well-formed evidence',
            'E7',
            'fill or correct the field as described in the content guide',
            'schema',
          ),
        );
      }
    }
  }

  const items = Array.isArray(files.items?.items) ? files.items.items : [];
  const reserve = Array.isArray(files.reserve?.items) ? files.reserve.items : [];
  const sample = Array.isArray(files.sample?.items) ? files.sample.items : [];

  items.forEach((it, i) => checkRecord(it, i, 'items', problems, warnings));
  reserve.forEach((it, i) => checkRecord(it, i, 'reserve', problems, warnings));
  sample.forEach((it, i) => checkRecord(it, i, 'sample', problems, warnings));

  if (files.items && items.length !== ROUNDS) {
    problems.push(problem('data/items.json', `has ${items.length} items, not ${ROUNDS}`, 'v0 is exactly 10 rounds', 'ENG27', 'add or promote items until there are 10', 'files'));
  }
  if (files.sample && sample.length !== 1) {
    problems.push(problem('data/sample.json', `has ${sample.length} records, not 1`, 'the start screen shows one sample object', 'DS9', 'keep exactly one record', 'files'));
  }
  for (const s of sample) {
    if (s.photo && !SAMPLE_LICENCES.includes(s.photo.licence)) {
      problems.push(problem(`sample ${s.id} · photo.licence`, `is ${s.photo.licence}`, 'the start-screen sample photo must be CC0 or public domain', 'ENG19', 'pick a CC0 or public-domain photo', 'sample'));
    }
  }

  // ids unique across all files (ENG10: never reused)
  const seen = new Map();
  for (const [kind, list] of [['item', items], ['reserve', reserve], ['sample', sample]]) {
    for (const it of list) {
      if (!it?.id) continue;
      if (seen.has(it.id)) {
        problems.push(problem(`${kind} ${it.id} · id`, `is also used by ${seen.get(it.id)}`, 'ids are never reused', 'ENG10', 'give it a new two-digit id', 'ids'));
      } else seen.set(it.id, `${kind} ${it.id}`);
    }
  }

  // rounds 1-3: city-level and uncontested records (E2)
  items.slice(0, 3).forEach((it, i) => {
    if (it?.made?.precision && it.made.precision !== 'city') {
      problems.push(problem(`item ${it.id} · made.precision`, `round ${i + 1} is ${it.made.precision}-level`, 'rounds 1-3 use city-level, uncontested records', 'E2', 'move this item to round 4 or later', 'order'));
    }
    if (Array.isArray(it?.conflicts) && it.conflicts.length) {
      problems.push(problem(`item ${it.id} · conflicts`, `round ${i + 1} has a record conflict`, 'rounds 1-3 use city-level, uncontested records', 'E2', 'move this item to round 4 or later', 'order'));
    }
  });

  // V3: holding-city spread
  const cities = new Map();
  for (const it of items) {
    const c = it?.kept?.city;
    if (c) cities.set(c, (cities.get(c) ?? 0) + 1);
  }
  if (items.length) {
    if (cities.size < 6) {
      problems.push(problem('data/items.json', `uses ${cities.size} holding cities, fewer than 6`, 'a constant "always the same city" guess must not pay', 'V3', 'swap in items held in other cities', 'spread'));
    }
    for (const [c, n] of cities) {
      if (n > 2) problems.push(problem(`holding city ${c}`, `holds ${n} items, more than 2`, 'a constant "always the same city" guess must not pay', 'V3', 'swap one item for one held elsewhere', 'spread'));
    }
  }

  // images: items and sample have one; reserve has none; no duplicates
  const hashes = new Map();
  for (const [kind, list] of [['item', items], ['sample', sample]]) {
    for (const it of list) {
      if (!it?.id) continue;
      const h = await checkImage(it.id, p.image(it.id), problems, kind);
      if (h && hashes.has(h)) {
        problems.push(problem(`${kind} ${it.id} · image`, `is identical to ${hashes.get(h)}`, 'every item has its own photo', 'ENG27', 'fix the image', 'images'));
      } else if (h) hashes.set(h, `${kind} ${it.id}`);
    }
  }
  for (const it of reserve) {
    if (it?.id && existsSync(p.image(it.id))) {
      problems.push(problem(`reserve ${it.id} · image`, `images/${it.id}.jpg exists`, 'reserve candidates commit no image files', 'S1', 'delete the file; promote fetches it', 'reserve'));
    }
  }

  // V3 constant-guess baselines (report; a warning once constants are locked)
  const lines = [];
  const complete = items.filter((it) => Number.isFinite(it?.kept?.lat) && Number.isFinite(it?.made?.lat) && Number.isInteger(it?.when?.start));
  if (complete.length) {
    const kept = bestConstantPlace(complete.map((it) => ({ ...it.kept, fullMarksKm: DISTANCE.keptFullMarksKm })));
    const made = bestConstantPlace(complete.map((it) => ({ ...it.made, fullMarksKm: madeFullMarksKm(it.made.precision, it.made.full_marks_km) })));
    const when = bestConstantYear(complete.map((it) => it.when));
    for (const [q, b] of [['kept', kept], ['made', made], ['when', when]]) {
      const pct = (b.share * 100).toFixed(1);
      lines.push(`baseline ${q}: best constant guess scores ${pct}% (limit ${BASELINE_LIMIT * 100}%)`);
      if (CONSTANTS_LOCKED && b.share >= BASELINE_LIMIT) {
        warnings.push(problem(`baseline ${q}`, `a constant guess scores ${pct}%`, 'fairness: always guessing the same answer must not pay', 'V3', 'swap an item, or ask the founder about the constants', 'spread'));
      }
    }
  }

  return report(problems, warnings, quiet, [
    `holding cities: ${cities.size} distinct, max ${Math.max(0, ...cities.values())} per city`,
    ...lines,
  ]);
}

function report(problems, warnings, quiet, info = []) {
  if (!quiet) {
    printProblems(problems);
    printProblems(warnings.map((w) => ({ ...w, problem: `(warning) ${w.problem}` })));
    for (const l of info) process.stdout.write(`${l}\n`);
    process.stdout.write(`items:check: ${problems.length} error(s), ${warnings.length} warning(s)\n`);
  }
  return { problems, warnings, info };
}

/** crop: fractions [top, right, bottom, left] to cut away, applied after auto-rotation. */
export async function processImage(input, crop = null) {
  let source = input;
  if (crop) {
    const upright = await sharp(input).rotate().toBuffer();
    const { width, height } = await sharp(upright).metadata();
    const [t, r, b, l] = crop;
    const left = Math.round(width * l);
    const top = Math.round(height * t);
    source = await sharp(upright)
      .extract({ left, top, width: width - left - Math.round(width * r), height: height - top - Math.round(height * b) })
      .toBuffer();
  }
  for (const maxPx of [MAX_IMAGE_PX, 1400, 1200]) {
    for (let q = 86; q >= 50; q -= 4) {
      const buf = await sharp(source)
        .rotate()
        .toColorspace('srgb')
        .resize({ width: maxPx, height: maxPx, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: q, mozjpeg: true })
        .toBuffer();
      if (buf.length <= MAX_IMAGE_BYTES) return buf;
    }
  }
  throw new Error('could not get the image under 250 KB');
}

async function fetchInput(src) {
  if (/^https:\/\//.test(src)) {
    const headers = { 'User-Agent': UA };
    // The Art Institute of Chicago's image server asks clients to identify themselves.
    if (new URL(src).hostname.endsWith('artic.edu')) headers['AIC-User-Agent'] = UA;
    const res = await fetch(src, { headers });
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  if (/^http:\/\//.test(src)) throw new Error('only https:// URLs are allowed');
  return readFileSync(src);
}

async function addImage(root, id, src, force, crop) {
  const p = paths(root);
  if (!/^[0-9]{2}$/.test(id ?? '') || !src) {
    printProblems([problem('add-image', 'usage: add-image <id> <url|file> [--force]', 'the id is the two-digit item id', 'DX6', 'pass an id like 07 and an https URL or a file path', 'images')]);
    return 2;
  }
  if (existsSync(p.image(id)) && !force) {
    printProblems([problem(`images/${id}.jpg`, 'already exists', 'add-image never overwrites by accident', 'DX23', 'pass --force to replace it', 'images')]);
    return 1;
  }
  let out;
  try {
    out = await processImage(await fetchInput(src), crop);
  } catch (e) {
    printProblems([problem(`images/${id}.jpg`, e.message, 'the image could not be processed', 'DX6', 'check the URL or file and try again', 'images')]);
    return 1;
  }
  mkdirSync(p.images, { recursive: true });
  writeFileSync(p.image(id), out);
  const meta = await sharp(out).metadata();
  console.log(`wrote images/${id}.jpg (${meta.width}x${meta.height}, ${Math.round(out.length / 1024)} KB, metadata stripped)`);
  console.log('fill in: photo.source_url, photo.file_url, photo.author, photo.licence, photo.pd_basis');
  return 0;
}

async function promote(root, reserveId, slotArg, imageOverride) {
  const p = paths(root);
  const slot = Number(slotArg);
  if (!/^[0-9]{2}$/.test(reserveId ?? '') || !Number.isInteger(slot) || slot < 1 || slot > ROUNDS) {
    printProblems([problem('promote', 'usage: promote <reserve-id> <slot 1-10>', 'slots are round positions', 'DX23', 'for example: promote 14 7', 'swap')]);
    return 2;
  }
  const items = JSON.parse(readFileSync(p.items, 'utf8'));
  const reserve = JSON.parse(readFileSync(p.reserve, 'utf8'));
  const rec = reserve.items.find((r) => r.id === reserveId);
  if (!rec) {
    printProblems([problem(`reserve ${reserveId}`, 'not found in data/reserve.json', 'only reserve records can be promoted', 'DX23', 'check the id', 'swap')]);
    return 1;
  }
  const displaced = items.items[slot - 1];
  let image;
  try {
    image = await processImage(await fetchInput(imageOverride ?? rec.photo.file_url));
  } catch (e) {
    printProblems([problem(`reserve ${reserveId} · photo.file_url`, e.message, 'the reserve image must be fetched before the swap', 'DX23', 'fix the URL; nothing was changed', 'swap')]);
    return 1;
  }
  const nextItems = { ...items, items: items.items.map((it, i) => (i === slot - 1 ? rec : it)) };
  const nextReserve = { ...reserve, items: [...reserve.items.filter((r) => r.id !== reserveId), ...(displaced ? [displaced] : [])] };

  // validate in a scratch copy; change nothing on failure
  const scratch = mkdtempSync(join(tmpdir(), 'mg-promote-'));
  try {
    cpSync(join(root, 'data'), join(scratch, 'data'), { recursive: true });
    cpSync(p.images, join(scratch, 'images'), { recursive: true });
    writeFileSync(join(scratch, 'data/items.json'), `${JSON.stringify(nextItems, null, 2)}\n`);
    writeFileSync(join(scratch, 'data/reserve.json'), `${JSON.stringify(nextReserve, null, 2)}\n`);
    writeFileSync(join(scratch, 'images', `${reserveId}.jpg`), image);
    if (displaced) rmSync(join(scratch, 'images', `${displaced.id}.jpg`), { force: true });
    const result = await check(scratch, { quiet: true });
    if (result.problems.length) {
      printProblems(result.problems);
      console.error(`promote: the swap would leave ${result.problems.length} error(s); nothing was changed`);
      return 1;
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  writeFileSync(p.items, `${JSON.stringify(nextItems, null, 2)}\n`);
  writeFileSync(p.reserve, `${JSON.stringify(nextReserve, null, 2)}\n`);
  writeFileSync(p.image(reserveId), image);
  if (displaced) rmSync(p.image(displaced.id), { force: true });
  console.log(`promoted ${reserveId} into slot ${slot}${displaced ? `; ${displaced.id} moved to data/reserve.json` : ''}`);
  return 0;
}

function skeleton(id) {
  return {
    id,
    title: 'TODO (<= 70 characters)',
    alt_neutral: 'TODO: material, form, figures, composition; no title, place, culture or date',
    record_url: 'https://TODO-museum-object-record',
    wikidata_url: 'https://www.wikidata.org/wiki/Q0',
    kept: { museum: 'TODO', city: 'TODO', country: 'TODO', lat: 0, lng: 0, source_url: 'https://TODO' },
    made: { place: 'TODO', country: 'TODO', precision: 'city', wikidata_url: 'https://www.wikidata.org/wiki/Q0', lat: 0, lng: 0, source_url: 'https://TODO', note: null, full_marks_km: null },
    when: { start: 1, end: 1, label: 'TODO as the museum writes it', source_url: 'https://TODO' },
    moved: true,
    journey_fact: { text: 'TODO (<= 240 characters; documented transfers with sources; gaps as "not documented")', source_url: 'https://TODO' },
    facts: [{ text: 'TODO (<= 200 characters)', source_url: 'https://TODO' }],
    photo: { source_url: 'https://TODO', file_url: 'https://TODO', author: 'TODO', licence: 'CC0 1.0', pd_basis: 'TODO', crop_note: null },
    conflicts: [],
    contested: false,
    claimant_source: null,
    heritage_image_law: false,
    retrieved: new Date().toISOString().slice(0, 10),
  };
}

const HELP = `usage: node scripts/items.mjs <command> [--root <dir>]

  check                          validate data/*.json and images/ (npm run items:check)
  new <id>                       print a complete record skeleton for a new item
  add-image <id> <url|file>      fetch, strip metadata, resize to <= 1600 px and <= 250 KB
            [--force]            replace an existing image
            [--crop t,r,b,l]     cut away fractions of each edge first (record it in photo.crop_note)
  promote <reserve-id> <slot>    move a reserve record into round slot 1-10; the displaced
          [--image <file>]       record goes to data/reserve.json; nothing changes on failure;
                                 --image uses a local file instead of photo.file_url

docs: ${DOCS}`;

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = args(process.argv.slice(2));
  const [cmd, x, y] = a._;
  let code = 0;
  if (a.help || !cmd) {
    console.log(HELP);
    code = cmd ? 0 : 2;
  } else if (cmd === 'check') {
    code = (await check(a.root)).problems.length ? 1 : 0;
  } else if (cmd === 'new') {
    if (!/^[0-9]{2}$/.test(x ?? '')) {
      console.error('usage: new <two-digit id>');
      code = 2;
    } else console.log(JSON.stringify(skeleton(x), null, 2));
  } else if (cmd === 'add-image') code = await addImage(a.root, x, y, a.force, a.crop);
  else if (cmd === 'promote') code = await promote(a.root, x, y, a.image);
  else {
    console.error(`unknown command: ${cmd}\n\n${HELP}`);
    code = 2;
  }
  process.exit(code);
}
