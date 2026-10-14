#!/usr/bin/env node
// Static, file://-safe design studies. This does not write production tokens.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const folder = `${root}docs/design/directions/`;
const check = process.argv.includes('--check');
const read = (path) => readFileSync(`${root}${path}`, 'utf8');
function emit(path, content) {
  if (check) {
    if (readFileSync(path, 'utf8') !== content) throw new Error(`Stale design output: ${path.slice(root.length)}`);
  } else writeFileSync(path, content);
}
const pins = Object.fromEntries(['kept', 'made', 'combined', 'guess-kept', 'guess-made'].map((key) => [key,
  read(`src/assets/pins/${key}.svg`).replace(/<svg[^>]*>/, '').replace('</svg>', '').trim(),
]));
const icon = (key, cls = '') => `<svg class="pin-icon ${key} ${cls}" viewBox="0 0 32 40" aria-hidden="true">${pins[key]}</svg>`;
const symbol = (key, x, y, guess = false) => `<svg class="map-pin ${key}" x="${x - (guess ? 20 : 16)}" y="${y - (guess ? 46 : 37)}" width="${guess ? 40 : 32}" height="${guess ? 50 : 40}" viewBox="0 0 32 40">${pins[key]}</svg>`;

function map({ device = 'phone', reveal = false, mini = false } = {}) {
  const viewbox = device === 'phone' ? '145 45 430 290' : '0 0 800 400';
  return `<div class="map ${mini ? 'mini-map' : ''} ${reveal ? 'answer-map' : ''}" role="${mini || reveal ? 'img' : 'group'}" aria-label="${reveal || mini ? 'Schematic map: made in Nimrud, now kept in New York.' : 'Schematic map with your Kept guess near Berlin, Germany.'}">
    <svg class="map-art" viewBox="${mini ? '150 50 425 230' : viewbox}" aria-hidden="true">
      <path class="graticule" d="M0 100H800M0 200H800M0 300H800M200 0V400M400 0V400M600 0V400"/>
      <path class="land" d="m64 69 37-26 54 3 29 24 44-7 51 18 17 35-30 24-28 4-20 24 6 28-24 5-22-33-20-20-38-1-21-23-26-3-9-23Zm151 135 41 7 39 30 5 32-24 44-18 51-18-12-7-45-20-34-10-40ZM316 27l41-10 16 30-22 31-34-17ZM407 76l28-23 15 15 34-9 30 15 30-21 77-3 48 15 53 1 18 25-25 17-6 24-43 20-33 37-32-1-22 26-27-17-22-35-24-6-20-19-22 7-15-17-33-4-12-18 9-19-11-5Zm25 84 43 4 34 38-5 40-26 45-26 18-21-34-9-32-24-33 13-35ZM553 206l28 12 18 1 20 15-6 12-27-12-24-4ZM629 274l31-19 42 10 23 30-16 25-44-2-32-15ZM735 314l16 8-7 22-13 4ZM65 385l108-9 111 10 111-13 122 7 118-4 85 11v13H65Z"/>
      <path class="landcover" d="m125 71 39 3 38 25 51-3-12 29-39 10-47-22ZM454 84l48 3 38-13 77 2 19 28-45 27-64-8-32-16-38 6ZM432 210l36 8 17 25-27 43-14-38ZM233 233l32 14 12 25-24 41-14-38Z"/>
      <path class="borders" d="m133 126 57-5 44 22m-22 26 10 19m13 47 30 13 12 25m168-143 8 24 24 11m-25-83 9 21 33 5 4 37m-74 52 48 13 21-11m-48 14 6 36 35 7m47-87 26-12 27 16 34-12m-11-55 12 33 34 20"/>
      ${reveal || mini ? `<path class="journey-line" d="M500 177Q360 57 236 165"/><text class="route-label" x="366" y="104" text-anchor="middle">made here · held here now</text>
        ${reveal ? `<path class="guess-connection" d="M529 192 500 177M236 165h0"/>${symbol('guess-kept', 236, 165, true)}${symbol('guess-made', 529, 192, true)}` : ''}
        ${symbol('kept', 236, 165)}${symbol('made', 500, 177)}
        <text class="city" x="228" y="189" text-anchor="end">New York</text><text class="city" x="487" y="204" text-anchor="end">Nimrud</text>` : `${symbol('guess-kept', 455, 137)}
        <text class="city" x="468" y="145">Berlin</text><text class="city" x="248" y="175">New York</text><text class="city" x="410" y="185">Lisbon</text>`}
      <text class="ocean-label" x="350" y="245" text-anchor="middle">ATLANTIC OCEAN</text>
    </svg>
    ${mini || reveal ? '' : `<div class="map-tools" aria-label="Map controls"><button type="button" aria-label="Zoom in">+</button><button type="button" aria-label="Zoom out">−</button><button type="button">World</button></div><div class="drop-label">${icon('guess-kept')}<span>Near Berlin, Germany</span></div>`}
    <span class="map-note">Schematic · design study</span>
  </div>`;
}

function photo(extra = '') {
  return `<div class="photo ${extra}" role="img" aria-label="Artwork photo placeholder; no image loaded"><span class="photo-word">photo</span><span class="photo-corners" aria-hidden="true"></span></div>`;
}
function brand() {
  return `<div class="wordmark"><span class="brand-mark" aria-hidden="true">${icon('made')}${icon('kept')}</span><span>MuseumGuessr</span></div>`;
}
function topbar(round = false) {
  return `<header class="topbar">${round ? '<span class="round-number">Round 1/10</span><span class="running-total">0 pts</span>' : brand()}
    <details class="menu"><summary aria-label="Menu">☰</summary><nav aria-label="Game menu"><a href="../README.md#how-to-play">How to play</a><button type="button">New game</button><a href="../README.md#credits">Credits</a><a href="../README.md#about--privacy">About &amp; privacy</a></nav></details></header>`;
}
function prompt(when, device) {
  return `<section class="prompt" aria-label="Current question"><div class="step-dots" aria-label="${when ? 'Kept done, Made done, When active' : 'Kept active, Made to do, When to do'}">
    ${['Kept', 'Made', 'When'].map((name, i) => `<span class="step ${when ? (i < 2 ? 'done' : 'active') : i === 0 ? 'active' : 'todo'}" ${i === (when ? 2 : 0) ? 'aria-current="step"' : ''}><span class="dot" aria-hidden="true">${when && i < 2 ? '✓' : ''}</span><span class="step-name">${name}</span></span>`).join('')}
    </div><h1>${when ? 'When was it made?' : 'Where is it kept today?'}</h1><button class="help" type="button" aria-label="Help with ${when ? 'When' : 'Kept'}" aria-describedby="hint-${device}">?</button>
    <p class="hint" id="hint-${device}">${when ? "Inside the museum's date range scores full marks." : 'Kept = the city of the museum that holds it today.'}</p></section>`;
}
function action(label, disabled = false) {
  return `<footer class="actionbar"><button class="primary" type="button" ${disabled ? 'disabled' : ''}>${label}<span aria-hidden="true">→</span></button></footer>`;
}
function yearControl(device) {
  return `<section class="year-controls" aria-label="When answer"><div class="year-display">1450 <span>CE</span></div>
    <div class="year-entry"><label class="year-field">Year<input type="number" min="1" max="4000" placeholder="1450" inputmode="numeric" aria-describedby="year-note-${device}"></label>
    <fieldset class="era"><legend class="sr-only">Era</legend><label><input type="radio" name="era-${device}" value="BCE"><span>BCE</span></label><label><input type="radio" name="era-${device}" value="CE" checked><span>CE</span></label></fieldset></div>
    <div class="timeline-control"><label class="sr-only" for="year-range-${device}">Year on a piecewise timeline, from 4000 BCE to 2000 CE</label><input id="year-range-${device}" class="ghost-slider" type="range" min="0" max="100" value="71" aria-valuetext="1450 CE, preview, not confirmed" aria-describedby="year-note-${device}">
    <div class="ticks" aria-hidden="true"><span class="tick t1">3000<br>BCE</span><span class="tick t2">1000<br>BCE</span><span class="tick t3">1 CE</span><span class="tick t4">1000</span><span class="tick t5">1500</span><span class="tick t6">2000</span></div></div>
    <p class="slider-caption">Recent centuries get more room</p><p class="muted" id="year-note-${device}">Touch the timeline or enter a year to confirm.</p></section>`;
}
function round(device, when = false) {
  return `${topbar(true)}<div class="round-layout ${when ? 'is-when' : ''}">${prompt(when, device)}
    <div class="photo-region">${photo()}<button class="lightbox-trigger" type="button" aria-label="Open artwork photo in lightbox">View photo <span aria-hidden="true">↗</span></button></div>
    ${when ? yearControl(device) : map({ device })}${action('Confirm', when)}</div>`;
}
function start(device) {
  return `${topbar()}<div class="start-layout"><div class="start-intro"><p class="eyebrow">One object. Three questions.</p><h1>Made here.<br>Kept there.<br><span>Guess both.</span></h1></div>
    <div class="example-card"><span class="example-tag">Example</span>${photo()}${map({ device, mini: true })}</div>
    <div class="start-actions"><button class="primary" type="button">Start<span aria-hidden="true">→</span></button><p class="game-length">10 objects · about 10 min · real photos of real museum objects, credited</p></div>
    <footer class="privacy" id="privacy-${device}"><p>No cookies. Anonymous play counts via PostHog (EU).</p><a href="../README.md#about--privacy">About &amp; privacy</a>${device === 'phone' ? '<span class="test-badge">Test mode · analytics off</span>' : ''}</footer></div>`;
}
function timeline() {
  return `<div class="reason-timeline" role="img" aria-label="Made 883 to 859 BCE; your guess 1003 BCE is 120 years before the range"><span class="range-band"></span><span class="year-guess"></span><span>1003 BCE guess</span><span>883–859 BCE</span></div>`;
}
function scoreRows() {
  return `<section class="scores" aria-label="Score by question"><details class="score-row spot-on"><summary>${icon('kept')}<span>Kept <strong>1,000</strong> · <span class="score-note">Spot on</span></span><span class="expand" aria-hidden="true">+</span></summary><p>Your museum-city guess is inside the full-marks area.</p></details>
    <details class="score-row"><summary>${icon('made')}<span>Made <strong>742</strong> · <span class="score-note">310 km off</span></span><span class="expand" aria-hidden="true">+</span></summary><p>Your Made guess is 310 km from the answer.</p></details>
    <details class="score-row"><summary><span class="when-symbol" aria-hidden="true">◷</span><span>When <strong>610</strong> · <span class="score-note">120 years off</span></span><span class="expand" aria-hidden="true">+</span></summary><p>Your year is 120 years outside the museum's date range.</p>${timeline()}</details></section>`;
}
function reveal(device) {
  return `<div class="reveal-layout"><header class="wall-label"><p class="eyebrow">Round 1/10 · The reveal</p><h1>Lamassu</h1><p>Made in Nimrud, 883–859 BCE → Now in The Metropolitan Museum of Art, New York</p></header>
    <p class="journey">Excavated by Austen Henry Layard in the 1840s; given to the museum in 1932. <a href="https://www.metmuseum.org/art/collection/search/322609" target="_blank" rel="noreferrer">source</a></p>
    <div class="reveal-map-region">${map({ device, reveal: true })}<p class="legend">filled = answer, hollow = your guess, shapes = Kept and Made</p></div>
    <div class="score-block" tabindex="-1" aria-label="Round score: 2352 out of 3000"><div class="round-score"><span class="eyebrow">Round score</span><strong>2,352 <span>/ 3,000</span></strong></div>${scoreRows()}</div>
    <p class="facts">Carved in gypsum alabaster.</p><p class="credit" id="credits-${device}">Photo: The Metropolitan Museum of Art, CC0</p>${action('Next round')}</div>`;
}
const points = ['2,352', '2,184', '1,930', '2,440', '1,784', '2,306', '2,110', '1,904', '2,470', '2,000'];
function recap() {
  return `<ol class="recap" aria-label="Your ten objects">${points.map((p, i) => `<li>${photo('thumbnail')}<div class="recap-label"><strong>${i === 0 ? 'Lamassu' : `Object ${String(i + 1).padStart(2, '0')}`}</strong><span>${i === 0 ? 'Made in Nimrud → Now in New York' : 'Made in X → Now in Y'}</span></div><span class="recap-points">${p}</span></li>`).join('')}</ol>`;
}
function end(device) {
  return `${topbar()}<div class="end-layout"><section class="end-summary"><p class="eyebrow">Collection complete</p><span class="tier">Curator</span><h1>21,480 <span>/ 30,000</span></h1><div class="copy-result"><button class="primary" type="button">Copy result<span aria-hidden="true">↗</span></button><span class="copied" role="status">✓ Copied</span></div>
    <fieldset class="feedback"><legend>Most fun:</legend>${['Kept', 'Made', 'When'].map((name) => `<label><input type="radio" name="fun-${device}" value="${name}"><span>${name}</span></label>`).join('')}</fieldset><p class="optional-note">Optional</p></section>
    ${recap()}<footer class="end-footer"><p>That's the whole collection for now: 10 objects, the same for everyone</p><a href="start.html">Replay the same 10</a></footer></div>`;
}
const pages = { start, 'round-kept': (d) => round(d), 'round-when': (d) => round(d, true), reveal, end };
const directions = { a: 'Transit Index', b: 'Object Club' };
function stateNotes(screen) {
  if (screen === 'start') return `<aside class="state-study"><h2>Returning-player alternative</h2><button class="primary" type="button">Continue · Round 4 of 10<span aria-hidden="true">→</span></button><button class="secondary" type="button">New game</button></aside>`;
  if (screen === 'round-kept') return `<aside class="state-study"><h2>Made step · carry-over pin rule</h2><p>Where was it made?</p><p class="muted">Made = where it was made, not what it shows or where it was dug up.</p><p class="carry-over">${icon('kept', 'retained-pin')} Confirmed Kept stays visible ${icon('guess-made')} New Made guess</p><button class="primary" type="button" disabled>Confirm<span aria-hidden="true">→</span></button><p class="muted">Empty-pin state: Confirm is disabled.</p></aside>`;
  if (screen === 'reveal') return `<aside class="state-study"><h2>After round 3 only · action-bar variant</h2><fieldset class="difficulty"><legend>Difficulty so far:</legend>${['too hard', 'about right', 'too easy'].map((name) => `<label><input type="radio" name="difficulty" value="${name}"><span>${name}</span></label>`).join('')}</fieldset>${action('Next round')}</aside>`;
  return '';
}
for (const [key, name] of Object.entries(directions)) {
  mkdirSync(`${folder}${key}`, { recursive: true });
  const tokens = JSON.parse(read(`docs/design/directions/${key}/tokens.json`));
  const lines = ['/* Generated from this direction\'s tokens.json by npm run design:build. */', ':root {'];
  for (const [group, values] of Object.entries(tokens)) if (typeof values === 'object') {
    for (const [token, value] of Object.entries(values)) lines.push(`  --${group}-${token}: ${value};`);
  }
  emit(`${folder}${key}/tokens.css`, [...lines, '}', ''].join('\n'));
  const fontSpecs = key === 'a' ? [['barlow-condensed', 'Barlow Condensed', [700]], ['ibm-plex-sans', 'IBM Plex Sans', [400, 500, 700]]] : [['bricolage-grotesque', 'Bricolage Grotesque', [400, 500, 700]]];
  fontSpecs.push(['ibm-plex-mono', 'IBM Plex Mono', [400, 500, 700]]);
  emit(`${folder}${key}/fonts.css`, '/* Self-hosted Latin only. Font credits and OFL licences: DESIGN.md. */\n' + fontSpecs.flatMap(([id, family, weights]) => weights.map((weight) => `@font-face { font-family: '${family}'; font-style: normal; font-weight: ${weight}; font-display: swap; src: url('../../../../node_modules/@fontsource/${id}/files/${id}-latin-${weight}-normal.woff2') format('woff2'); }`)).join('\n') + '\n');
  for (const [screen, render] of Object.entries(pages)) {
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${key.toUpperCase()} · ${name} · ${screen} | MuseumGuessr</title><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="fonts.css"><link rel="stylesheet" href="../compositions.css"></head>
<body class="direction-${key}"><header class="study-header"><a href="../index.html">← All directions</a><h1>${key.toUpperCase()} / ${name} <span>— ${screen}</span></h1><p>Static composition · placeholder photos · no analytics or game logic</p><nav aria-label="Screens">${Object.keys(pages).map((page) => `<a href="${page}.html" ${page === screen ? 'aria-current="page"' : ''}>${page}</a>`).join('')}</nav></header>
<main class="comparison"><section class="device-study"><h2>Phone / 390 × 844</h2><div class="frame phone ${screen}">${render('phone')}</div></section><section class="device-study"><h2>Desktop / 1280 × 800</h2><div class="frame desktop ${screen}">${render('desktop')}</div></section></main>
${stateNotes(screen)}<footer class="study-footer">Low-fidelity direction study. Map outlines are schematic, not production tiles. Recap objects 02–10 are placeholders, not approved content.</footer></body></html>
`;
    emit(`${folder}${key}/${screen}.html`, html);
  }
}
emit(`${folder}index.html`, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MuseumGuessr · Two directions</title><link rel="stylesheet" href="a/tokens.css"><link rel="stylesheet" href="a/fonts.css"><link rel="stylesheet" href="compositions.css"></head><body class="direction-a index-page"><main><p class="eyebrow">MuseumGuessr / Step 3a</p><h1>One collection.<br>Two directions.</h1><p>Open each composition to compare a fixed phone frame and desktop frame side by side.</p><div class="direction-links">${Object.entries(directions).map(([key, name]) => `<section><p class="eyebrow">Direction ${key.toUpperCase()}</p><h2>${name}</h2><p>${key === 'a' ? 'Cool blue, condensed wayfinding, square catalogue labels.' : 'Lilac, forest green, expressive rounded gallery tickets.'}</p><nav aria-label="Direction ${key.toUpperCase()} screens">${Object.keys(pages).map((screen) => `<a href="${key}/${screen}.html">${screen}<span aria-hidden="true">↗</span></a>`).join('')}</nav></section>`).join('')}</div><p>These are static design studies, not a playable build. No real artwork photos, analytics or remote fonts are loaded.</p><a href="README.md">Direction rationale and review notes</a></main></body></html>
`);
console.log(check ? 'Design outputs are current.' : 'Generated ten compositions, direction styles, and index.');
