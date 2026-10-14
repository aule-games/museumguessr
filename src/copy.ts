// Every user-facing string, keyed (DS14, DS30). docs/screen-spec.md refers
// to these keys. Terms: Kept, Made and When on controls; "Now in" on the
// reveal; "holds", never "owns", in hints.

import type { Step } from './analytics/events.ts';

export const COPY = {
  // shared
  'app.name': 'MuseumGuessr',
  'app.tagline': 'Made here. Kept there. Guess both.',
  'step.kept': 'Kept',
  'step.made': 'Made',
  'step.when': 'When',
  'menu.open': 'Menu',
  'menu.close': 'Close menu',
  'menu.how': 'How to play',
  'menu.tour': 'Take the tour',
  'menu.new': 'New game',
  'menu.credits': 'Credits',
  'menu.about': 'About & privacy',
  'overlay.close': 'Close',
  'test.badge': 'Test mode · analytics off',
  'test.payloads': 'Events that would have been sent',
  'test.none': 'No events yet.',
  'test.counts': 'queued {queued} · dropped {dropped} · handed to provider {handed}',

  // start
  'start.eyebrow': 'One object. Three questions.',
  'start.example': 'Example',
  'start.sampleCaption': 'Made in {made} → Now in {kept}',
  'start.start': 'Start',
  'start.loading': 'Loading…',
  'start.continue': 'Continue · Round {round} of 10',
  'start.new': 'New game',
  'start.meta': '10 objects · about 10 min · real photos of real museum objects, credited',
  'start.privacy': 'No cookies. Anonymous play counts via PostHog (EU).',
  'start.privacyLink': 'About & privacy',
  'start.finished': 'You scored {total} / 30,000',
  'start.review': 'Review your 10',
  'start.again': 'Play again',
  'start.noWebgl': "Your browser can't show the map (WebGL is off). Try another browser.",

  // round
  'round.counter': 'Round {round}/10',
  'round.total': '{total} pts',
  'q.kept': 'Where is it kept today?',
  'q.made': 'Where was it made?',
  'q.when': 'When was it made?',
  'hint.kept': 'Kept = the city of the museum that holds it today.',
  'hint.made': 'Made = where it was made, not what it shows or where it was dug up.',
  'hint.when': "Inside the museum's date range scores full marks.",
  'hint.show': 'Show hint',
  'confirm': 'Confirm',
  'photo.open': 'Open the photo full screen',
  'photo.view': 'View photo',
  'photo.loading': 'Loading photo…',
  'photo.failed': "The photo didn't load.",
  'photo.retry': 'Retry image',
  'photo.skip': 'Skip this object',
  'photo.skipNote': 'Skipping scores this round 0.',
  'map.loading': 'Loading map…',
  'map.zoomIn': 'Zoom in',
  'map.zoomOut': 'Zoom out',
  'map.world': 'World',
  'map.label': 'World map. Tab into the map, move with the arrow keys, zoom with + and −, press Enter to drop the pin, Escape to leave.',
  'map.near': 'Near {place}',
  'map.openSea': 'Open sea',
  'map.pinPlaced': 'Pin placed near {place}',
  'map.crosshair': 'Map centre',
  'map.failed': 'The map stopped working.',
  'map.reload': 'Reload',
  'year.label': 'Year',
  'year.placeholder': 'Year',
  'year.bce': 'BCE',
  'year.ce': 'CE',
  'year.era': 'Era',
  'year.slider': 'Year slider',
  'year.caption': 'Recent centuries get more room',
  'year.noZero': "There's no year 0. Try 1 BCE or 1 CE.",
  'year.notNumber': 'Type a whole year, like 1450.',
  'year.outOfRange': 'Pick a year between 4000 BCE and 2000 CE.',

  // reveal
  'reveal.scoreLabel': 'Round total',
  'reveal.score': '{points} / 3,000',
  'reveal.madeKept': 'Made in {made}, {date} → Now in {museum}, {city}',
  'reveal.sameArea': 'Made and held in the same area: {place}',
  'reveal.madeRegion': 'made somewhere in {place} ({precision})',
  'reveal.source': 'source',
  'reveal.legend': 'Blue: where it is kept today · plum: where it was made · hollow pins: your guesses',
  'reveal.lineLabel': 'made here · held here now',
  'reveal.row.kept': 'Kept',
  'reveal.row.made': 'Made',
  'reveal.row.when': 'When',
  'reveal.spotOn': 'Spot on',
  'reveal.skipped': 'Skipped',
  'reveal.yearCount': '{years} years',
  'reveal.yearOne': '1 year',
  'result.km': '{km} km from {place}',
  'result.years': '{years} from {range}',
  'reveal.how': 'How it’s scored',
  'scoring.distance': 'Full marks within {radius} km of {place}. Beyond that, points halve about every {half} km: {km} km scores {points} of 1,000.',
  'scoring.distanceFull': 'Full marks within {radius} km of {place}; you were {km} km away.',
  'scoring.when': 'Full marks inside {range}. Outside it, points halve about every {half} years (older objects get a wider margin): {years} off scores {points} of 1,000.',
  'scoring.whenFull': 'Full marks for any year inside {range}.',
  'reason.skipped': 'This round was skipped after the photo failed to load.',
  'reveal.contested': 'Claim: {text}',
  'reveal.credit': 'Photo: {author}, {licence}',
  'reveal.creditSource': 'photo source',
  'reveal.record': 'museum record',
  'reveal.next': 'Next round',
  'reveal.results': 'See results',
  'pulse.difficulty': 'Difficulty so far:',
  'pulse.too_hard': 'too hard',
  'pulse.about_right': 'about right',
  'pulse.too_easy': 'too easy',
  'pulse.thanks': 'Thanks',
  'pulse.mostFun': 'Most fun:',

  // end
  'end.total': '{total} / 30,000',
  'end.copy': 'Copy result',
  'end.copied': 'Copied',
  'end.copyManual': 'Copy this text:',
  'end.collection': "That's the whole collection for now: 10 objects, the same for everyone",
  'end.replay': 'Replay the same 10',
  'end.recapRow': 'Made in {made} → Now in {kept}',
  'end.points': '{points} pts',
  'end.versionChanged': 'The collection changed since this game; only the total is kept.',

  // share text (DS15)
  'share.title': 'MuseumGuessr {total}/30,000',
  'share.round': 'R{round} {points} · kept {keptKm} km · made {madeKm} km · {years} yrs',
  'share.skipped': 'R{round} skipped',
  'share.footer': 'Same 10 objects for everyone',

  // menu overlays
  'how.title': 'How to play',
  'how.body':
    'Each round shows a real museum photo. Pin where the object is kept today, then where it was made, then type or slide the year it was made. Each answer scores up to 1,000 points.',
  'credits.title': 'Credits',
  'credits.row': '{title}: {author}, {licence}',
  'credits.map': 'Map data © OpenStreetMap contributors, tiles by OpenFreeMap; fallback map from Natural Earth (public domain).',
  'about.title': 'About & privacy',
  'about.body':
    'No cookies and no sign-up. To learn whether the game is fun, anonymous play counts go to PostHog (EU servers). Each event also carries the technical details PostHog adds: browser, operating system, device type, screen size, language, time zone and the site that linked here. The address of this page is sent without its query string, except campaign tags (utm_* and ref). These events are sent:',
  'about.testMode': 'Open the site with ?test=1 to stop sending events from this browser; ?test=0 turns them back on.',
  'confirmNew.title': 'Start over?',
  'confirmNew.body': 'Your score will be lost.',
  'confirmNew.yes': 'Start over',
  'confirmNew.no': 'Keep playing',

  // errors and other tabs
  'error.title': 'Something broke',
  'error.saved': 'Your progress is saved.',
  'error.reload': 'Reload',
  'error.new': 'New game',
  'error.ref': 'Ref {name} · build {build}',
  'tab.title': 'Continued in another tab',
  'tab.body': 'This game is open in another tab.',
  'tab.take': 'Play here instead',

  // first-visit tour (DS34)
  'tour.progress': 'Step {n} of {total}',
  'tour.next': 'Next',
  'tour.back': 'Back',
  'tour.skip': 'Skip tour',
  'tour.start': 'Let’s start',
  'tour.welcome.title': 'Welcome to MuseumGuessr',
  'tour.welcome.body': 'Ten real objects from museums around the world. For each one you answer three questions. Here is a quick tour.',
  'tour.photo.title': 'The object',
  'tour.photo.body': 'Study the photo: material, style and any writing are your clues. Tap it to see it larger.',
  'tour.questions.title': 'Kept, Made, When',
  'tour.questions.body': 'Kept: where is it kept today? Made: where was it made? When: in what year? Every object asks these three, in this order.',
  'tour.map.title': 'Drop a pin',
  'tour.map.body': 'For Kept and Made, tap the map to drop a pin; drag it to move it. Zoom with + and −, and World zooms back out.',
  'tour.confirm.title': 'Confirm',
  'tour.confirm.body': 'Happy with your answer? Confirm locks it in and moves on. For When you pick a year on a slider or type it; BCE works too.',
  'tour.score.title': 'Points',
  'tour.score.body': 'Each answer is worth up to 1,000 points, so 3,000 per object. The closer you are, the more you score; the reveal shows how.',
  'tour.menu.title': 'Help is here',
  'tour.menu.body': 'How to play and this tour are in the menu. Ready?',
} as const;

export type CopyKey = keyof typeof COPY;

/** Look up a string and fill `{name}` placeholders. */
export function t(key: CopyKey, vars: Record<string, string | number> = {}): string {
  return COPY[key].replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export const QUESTION: Record<Step, CopyKey> = { kept: 'q.kept', made: 'q.made', when: 'q.when' };
export const HINT: Record<Step, CopyKey> = { kept: 'hint.kept', made: 'hint.made', when: 'hint.when' };

export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
