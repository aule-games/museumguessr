#!/usr/bin/env node
// Items CLI (E7, DX5, DX6, DX23, ENG26, ENG27). One tool for the content files:
//
//   node scripts/items.mjs check                 validate data/ and images/
//   node scripts/items.mjs new <id>              print a complete record skeleton
//   node scripts/items.mjs add-image <id> <url|file> [--force]
//   node scripts/items.mjs promote --ids <id>[,<id>...]
//   node scripts/items.mjs swap <reserve-id> <item-id>
//   node scripts/items.mjs retire <id> [--replace <reserve-id>] --reason "<why>"
//   node scripts/items.mjs sheet [--ids <id>,...] [--out <file.jpg>]
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
import { poolRules } from './lib/pool-rules.mjs';
import { printProblems } from './lib/report.mjs';
import { DECK } from '../src/deck/config.ts';
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
    else if (a === '--ids') out.ids = argv[++i];
    else if (a === '--replace') out.replace = argv[++i];
    else if (a === '--reason') out.reason = argv[++i];
    else if (a === '--out') out.out = resolve(argv[++i]);
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
  regions: join(root, 'data/regions.json'),
  retired: join(root, 'data/retired.json'),
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
  // DS6 / A1 / DS37: the round's alt text and photo caption carry no place, title phrase or date
  for (const [field, id] of [['alt_neutral', 'DS6'], ['caption', 'DS37']]) {
    const text = item[field];
    if (typeof text !== 'string') continue;
    const words = wordsOf(text);
    const set = new Set(words);
    const placeLeaks = [k.city, k.museum, k.country, m.place, m.country].flatMap((t) => wordsOf(t)).filter((t) => set.has(t));
    const joined = ` ${words.join(' ')} `;
    const titleWords = wordsOf(item.title);
    const titleLeaks = titleWords.slice(0, -1).filter((w, i) => joined.includes(` ${w} ${titleWords[i + 1]} `));
    if (placeLeaks.length || titleLeaks.length) {
      problems.push(
        problem(
          where(field),
          `contains ${placeLeaks.length} place word(s) and ${titleLeaks.length} title phrase(s)`,
          'the round must not reveal the answer before the reveal',
          id,
          'describe material, form and composition only',
          'alt-text',
        ),
      );
    }
    if (/\b\d{3,4}\b/.test(text)) {
      problems.push(problem(where(field), 'contains a number that may be a date', 'the round must not reveal the date', 'A1', 'remove the number', 'alt-text'));
    }
    const proper = text.split(/[:;.]\s*/).flatMap((part) => part.split(/\s+/).slice(1)).filter((w) => /^\p{Lu}/u.test(w));
    if (proper.length) {
      warnings.push(problem(where(field), `has ${proper.length} capitalised word(s) mid-sentence`, 'names of people, places or cultures give the answer away', 'DS29', 'check that none is a name', 'alt-text'));
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

  const regions = readJson(p.regions, problems, 'data/regions.json');
  const retired = existsSync(p.retired) ? readJson(p.retired, problems, 'data/retired.json') : null;
  const pool = poolRules(items, [...reserve.map((it) => ['reserve', it]), ...sample.map((it) => ['sample', it])], regions, retired, problem);
  problems.push(...pool.problems);
  warnings.push(...pool.warnings);
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
        problems.push(problem(`${kind} ${it.id} · id`, `is also used by ${seen.get(it.id)}`, 'ids are never reused', 'ENG10', 'give it a new id', 'ids'));
      } else seen.set(it.id, `${kind} ${it.id}`);
    }
  }

  // V3: holding-city spread for the fixed set of 10 (a drawable pool uses the V1-12 spread rules)
  const cities = new Map();
  for (const it of items) {
    const c = it?.kept?.city;
    if (c) cities.set(c, (cities.get(c) ?? 0) + 1);
  }
  if (items.length === ROUNDS) {
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
    ...pool.info,
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
  if (!ID.test(id ?? '') || !src) {
    printProblems([problem('add-image', 'usage: add-image <id> <url|file> [--force]', 'the id is the two- or three-digit item id', 'DX6', 'pass an id like 07 and an https URL or a file path', 'images')]);
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

const ID = /^[0-9]{2,3}$/;

/**
 * Validate a content change in a scratch copy, then apply it; nothing changes
 * on failure (DX23). `images` maps ids to new JPEG buffers; `drop` lists ids
 * whose images go away.
 */
async function applyChange(root, label, { items, reserve, retired = null, images = {}, drop = [] }) {
  const p = paths(root);
  const scratch = mkdtempSync(join(tmpdir(), 'mg-items-change-'));
  try {
    cpSync(join(root, 'data'), join(scratch, 'data'), { recursive: true });
    cpSync(p.images, join(scratch, 'images'), { recursive: true });
    writeFileSync(join(scratch, 'data/items.json'), `${JSON.stringify(items, null, 2)}\n`);
    writeFileSync(join(scratch, 'data/reserve.json'), `${JSON.stringify(reserve, null, 2)}\n`);
    if (retired) writeFileSync(join(scratch, 'data/retired.json'), `${JSON.stringify(retired, null, 2)}\n`);
    for (const [id, buf] of Object.entries(images)) writeFileSync(join(scratch, 'images', `${id}.jpg`), buf);
    for (const id of drop) rmSync(join(scratch, 'images', `${id}.jpg`), { force: true });
    const result = await check(scratch, { quiet: true });
    if (result.problems.length) {
      printProblems(result.problems);
      console.error(`${label}: the change would leave ${result.problems.length} error(s); nothing was changed`);
      return false;
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  writeFileSync(p.items, `${JSON.stringify(items, null, 2)}\n`);
  writeFileSync(p.reserve, `${JSON.stringify(reserve, null, 2)}\n`);
  if (retired) writeFileSync(p.retired, `${JSON.stringify(retired, null, 2)}\n`);
  for (const [id, buf] of Object.entries(images)) writeFileSync(p.image(id), buf);
  for (const id of drop) rmSync(p.image(id), { force: true });
  return true;
}

async function fetchReserveImage(rec, imageOverride) {
  try {
    return { image: await processImage(await fetchInput(imageOverride ?? rec.photo.file_url)) };
  } catch (e) {
    return { error: problem(`reserve ${rec.id} · photo.file_url`, e.message, 'the reserve image must be fetched before the change', 'DX23', 'fix the URL; nothing was changed', 'swap') };
  }
}

/** promote --ids 12,14: append reserve records to the pool, checking the whole batch once (V1-12). */
async function promote(root, a) {
  const p = paths(root);
  if (!a.ids) {
    const legacy = a._.length >= 3;
    printProblems([
      problem(
        'promote',
        legacy ? 'the slot form promote <id> <slot> is gone' : 'usage: promote --ids <id>[,<id>...]',
        'promote appends reserve records to the pool; a swap replaces one in place',
        'V1-12',
        legacy ? `to add: npm run items:promote -- --ids ${a._[1]}; to replace an item: npm run items:swap -- ${a._[1]} <item-id>` : 'for example: npm run items:promote -- --ids 12,14',
        'swap',
      ),
    ]);
    return 2;
  }
  const ids = a.ids.split(',').map((x) => x.trim()).filter(Boolean);
  if (!ids.length || ids.some((id) => !ID.test(id)) || new Set(ids).size !== ids.length) {
    printProblems([problem('promote', `bad id list "${a.ids}"`, 'ids are two or three digits, each once', 'V1-12', 'for example: --ids 12,14', 'ids')]);
    return 2;
  }
  if (a.image && ids.length !== 1) {
    printProblems([problem('promote', '--image works with one id', 'a local file replaces one reserve photo', 'DX23', 'promote that id on its own', 'swap')]);
    return 2;
  }
  const items = JSON.parse(readFileSync(p.items, 'utf8'));
  const reserve = JSON.parse(readFileSync(p.reserve, 'utf8'));
  const recs = [];
  const images = {};
  for (const id of ids) {
    const rec = reserve.items.find((r) => r.id === id);
    if (!rec) {
      printProblems([problem(`reserve ${id}`, 'not found in data/reserve.json', 'only reserve records can be promoted', 'DX23', 'check the id', 'swap')]);
      return 1;
    }
    const got = await fetchReserveImage(rec, a.image);
    if (got.error) {
      printProblems([got.error]);
      return 1;
    }
    recs.push(rec);
    images[id] = got.image;
  }
  const ok = await applyChange(root, 'promote', {
    items: { ...items, items: [...items.items, ...recs] },
    reserve: { ...reserve, items: reserve.items.filter((r) => !ids.includes(r.id)) },
    images,
  });
  if (!ok) return 1;
  console.log(`promoted ${ids.join(', ')}; the pool now holds ${items.items.length + ids.length} objects`);
  return 0;
}

/** swap <reserve-id> <item-id>: replace a pool item in place; the displaced record goes back to the reserve. */
async function swap(root, reserveId, itemId, imageOverride) {
  const p = paths(root);
  if (!ID.test(reserveId ?? '') || !ID.test(itemId ?? '')) {
    printProblems([problem('swap', 'usage: swap <reserve-id> <item-id>', 'a swap puts a reserve record where a pool item was', 'DX23', 'for example: swap 14 05', 'swap')]);
    return 2;
  }
  const items = JSON.parse(readFileSync(p.items, 'utf8'));
  const reserve = JSON.parse(readFileSync(p.reserve, 'utf8'));
  const rec = reserve.items.find((r) => r.id === reserveId);
  const at = items.items.findIndex((it) => it.id === itemId);
  if (!rec || at < 0) {
    printProblems([problem(rec ? `item ${itemId}` : `reserve ${reserveId}`, rec ? 'not found in data/items.json' : 'not found in data/reserve.json', 'a swap needs a reserve record and a pool item', 'DX23', 'check the ids', 'swap')]);
    return 1;
  }
  const got = await fetchReserveImage(rec, imageOverride);
  if (got.error) {
    printProblems([got.error]);
    return 1;
  }
  const displaced = items.items[at];
  const ok = await applyChange(root, 'swap', {
    items: { ...items, items: items.items.map((it, i) => (i === at ? rec : it)) },
    reserve: { ...reserve, items: [...reserve.items.filter((r) => r.id !== reserveId), displaced] },
    images: { [reserveId]: got.image },
    drop: [displaced.id],
  });
  if (!ok) return 1;
  console.log(`swapped ${reserveId} in for ${displaced.id}; ${displaced.id} moved to data/reserve.json`);
  return 0;
}

/** retire <id> [--replace <reserve-id>] --reason "...": take an object out for good (V1-12). */
async function retire(root, id, a) {
  const p = paths(root);
  if (!ID.test(id ?? '') || !a.reason) {
    printProblems([problem('retire', 'usage: retire <id> [--replace <reserve-id>] --reason "<why>"', 'a retirement is permanent and records its reason', 'V1-12', 'for example: retire 07 --replace 14 --reason "rights withdrawn"', 'ids')]);
    return 2;
  }
  const items = JSON.parse(readFileSync(p.items, 'utf8'));
  const reserve = JSON.parse(readFileSync(p.reserve, 'utf8'));
  const retired = existsSync(p.retired) ? JSON.parse(readFileSync(p.retired, 'utf8')) : { ids: [] };
  const at = items.items.findIndex((it) => it.id === id);
  if (at < 0) {
    printProblems([problem(`item ${id}`, 'not found in data/items.json', 'only pool items can be retired', 'V1-12', 'check the id', 'ids')]);
    return 1;
  }
  const n = items.items.length;
  const atMinimum = n === ROUNDS || n <= DECK.poolMinimum;
  if (atMinimum && !a.replace) {
    printProblems([problem('retire', `the pool has ${n} objects, its minimum`, 'retiring without a replacement would leave a pool the game cannot play', 'V1-12', `name a ready reserve record: retire ${id} --replace <reserve-id> --reason "..."`, 'pool')]);
    return 1;
  }
  let nextItems = items.items.filter((it) => it.id !== id);
  let nextReserve = reserve.items;
  const images = {};
  if (a.replace) {
    const rec = reserve.items.find((r) => r.id === a.replace);
    if (!rec) {
      printProblems([problem(`reserve ${a.replace}`, 'not found in data/reserve.json', 'the replacement must be a ready reserve record', 'V1-12', 'check the id', 'reserve')]);
      return 1;
    }
    const got = await fetchReserveImage(rec, a.image);
    if (got.error) {
      printProblems([got.error]);
      return 1;
    }
    nextItems = items.items.map((it, i) => (i === at ? rec : it));
    nextReserve = reserve.items.filter((r) => r.id !== a.replace);
    images[a.replace] = got.image;
  }
  const entry = { id, title: items.items[at].title, retired: new Date().toISOString().slice(0, 10), reason: a.reason };
  const ok = await applyChange(root, 'retire', {
    items: { ...items, items: nextItems },
    reserve: { ...reserve, items: nextReserve },
    retired: { ...retired, ids: [...(retired.ids ?? []), entry] },
    images,
    drop: [id],
  });
  if (!ok) return 1;
  console.log(`retired ${id}${a.replace ? `; ${a.replace} took its place` : ''}; recorded in data/retired.json`);
  return 0;
}

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/**
 * sheet [--ids a,b] [--out file.jpg]: the founder's contact sheet (V1-12). One
 * cell per record, pool first then reserve (or the listed ids): photo,
 * title, made place and date, kept museum and city, difficulty and type.
 * Photos come from images/ when committed, otherwise from photo.file_url.
 */
async function sheet(root, a) {
  const p = paths(root);
  const items = JSON.parse(readFileSync(p.items, 'utf8')).items;
  const reserve = JSON.parse(readFileSync(p.reserve, 'utf8')).items;
  const all = [...items.map((it) => ['pool', it]), ...reserve.map((it) => ['reserve', it])];
  const wanted = a.ids ? a.ids.split(',').map((x) => x.trim()) : null;
  const list = wanted ? wanted.map((id) => all.find(([, it]) => it.id === id) ?? [null, { id }]) : all;
  const missing = list.filter(([kind]) => !kind).map(([, it]) => it.id);
  if (missing.length) {
    printProblems([problem('sheet', `unknown id(s): ${missing.join(', ')}`, 'the sheet shows pool and reserve records', 'V1-12', 'check the ids', 'swap')]);
    return 1;
  }
  const W = 420;
  const PH = 300;
  const H = PH + 150;
  const cols = Math.min(4, list.length);
  const rows = Math.ceil(list.length / cols);
  const cells = [];
  for (const [i, [kind, it]] of list.entries()) {
    let photo;
    try {
      const src = existsSync(p.image(it.id)) ? readFileSync(p.image(it.id)) : await fetchInput(it.photo.file_url);
      photo = await sharp(src).rotate().resize({ width: W - 20, height: PH - 20, fit: 'contain', background: '#202a3a' }).jpeg().toBuffer();
    } catch (e) {
      photo = await sharp({ create: { width: W - 20, height: PH - 20, channels: 3, background: '#5a2a2a' } }).jpeg().toBuffer();
      console.error(`sheet: no photo for ${it.id} (${e.message})`);
    }
    const lines = [
      [`${it.id} · ${clip(it.title, 36)}`, 18, 700],
      [`Made: ${clip(`${it.made.place}${it.made.place === it.made.country ? '' : `, ${it.made.country}`}`, 40)} · ${clip(it.when.label, 22)}`, 15, 400],
      [`Kept: ${clip(`${it.kept.museum}, ${it.kept.city}`, 50)}`, 15, 400],
      [`Difficulty ${it.difficulty} · ${it.object_type} · ${kind}${it.contested ? ' · contested' : ''}${it.heritage_image_law ? ' · heritage law' : ''}`, 14, 400],
      [`Photo: ${clip(`${it.photo.licence}, ${it.photo.author}`, 52)}`, 13, 400],
    ];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H - PH}">${lines
      .map(([t, size, weight], k) => `<text x="12" y="${24 + k * 26}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="#f2f5f9">${esc(t)}</text>`)
      .join('')}</svg>`;
    const x = (i % cols) * W;
    const y = Math.floor(i / cols) * H;
    cells.push({ input: photo, left: x + 10, top: y + 10 }, { input: Buffer.from(svg), left: x, top: y + PH });
  }
  const out = a.out ?? join(tmpdir(), 'museumguessr-contact-sheet.jpg');
  await sharp({ create: { width: cols * W, height: rows * H, channels: 3, background: '#132036' } }).composite(cells).jpeg({ quality: 82 }).toFile(out);
  console.log(`wrote ${out} (${list.length} records)`);
  return 0;
}

function skeleton(id) {
  return {
    id,
    title: 'TODO (<= 70 characters)',
    alt_neutral: 'TODO: material, form, figures, composition; no title, place, culture or date',
    caption: 'TODO: one short subject line, same rules',
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
  promote --ids <id>[,<id>...]   append reserve records to the pool, checking the whole
          [--image <file>]       batch once; nothing changes on failure (--image: one id,
                                 a local file instead of photo.file_url)
  swap <reserve-id> <item-id>    put a reserve record where a pool item was; the displaced
       [--image <file>]          record goes back to data/reserve.json
  retire <id> --reason "<why>"   take an object out for good; its id goes to data/retired.json
         [--replace <reserve-id>] and is never reused; required when the pool is at its minimum
  sheet [--ids <id>,...]         the founder's contact sheet as one JPEG: photo, title, made,
        [--out <file.jpg>]       kept, date and difficulty per record (pool then reserve)

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
    if (!ID.test(x ?? '')) {
      console.error('usage: new <two- or three-digit id>');
      code = 2;
    } else console.log(JSON.stringify(skeleton(x), null, 2));
  } else if (cmd === 'add-image') code = await addImage(a.root, x, y, a.force, a.crop);
  else if (cmd === 'promote') code = await promote(a.root, a);
  else if (cmd === 'swap') code = await swap(a.root, x, y, a.image);
  else if (cmd === 'retire') code = await retire(a.root, x, a);
  else if (cmd === 'sheet') code = await sheet(a.root, a);
  else {
    console.error(`unknown command: ${cmd}\n\n${HELP}`);
    code = 2;
  }
  process.exit(code);
}
