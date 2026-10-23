// The public build profile (H1, M3, N6; V12-18, V12-23). One tracked file,
// deploy/profile.json, holds every public value of the deployed build. CI's
// verify build and `npm run deploy` resolve it through resolveBuild(), so
// both build exactly the same page; a shell variable cannot override it, and
// no CLOUDFLARE_* credential reaches the build.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PROFILE_PATH = 'deploy/profile.json';
export const PROFILE_KEYS = [
  'BASE_PATH',
  'VITE_SITE_URL',
  'VITE_ANALYTICS_HOSTS',
  'VITE_POSTHOG_PROJECT_TOKEN',
  'VITE_BOARD_UI',
  'VITE_TURNSTILE_SITEKEY',
  'VITE_BUILD_PURPOSE',
];
export const PURPOSES = ['dev', 'board-test', 'deploy'];
/** The tracked file keeps this until the main session puts in the real public project token; deploy refuses it. */
export const TOKEN_PLACEHOLDER = 'phc_placeholder_set_before_deploy';
/** Cloudflare's published Turnstile test site keys (always pass, always block, forced challenge). */
export const DUMMY_SITEKEYS = [
  '1x00000000000000000000AA',
  '2x00000000000000000000AB',
  '1x00000000000000000000BB',
  '2x00000000000000000000BB',
  '3x00000000000000000000FF',
];
/**
 * Code that must never ship in a deploy-purpose build (M3). check-build
 * scans every shipped script for these markers. Step 2 adds the `?clock=off`
 * marker and step 3 the board-test surfaces.
 */
export const DEPLOY_FORBIDDEN_MARKERS = [
  { pattern: /__mgDev|dev\/fixtures/, what: 'the development fixture', id: 'DX7' },
  { pattern: /__mgFixture/, what: 'the board end fixture (?fixture=end-random)', id: 'V12-127' },
];

/**
 * The board-test profile (V12-125): the tracked deploy profile with the board
 * UI on, Cloudflare's always-pass Turnstile test key and its own purpose. The
 * browser tests build it into dist-board/ next to the deploy build.
 */
export function boardTestValues(profile) {
  return { ...profile, VITE_BOARD_UI: 'true', VITE_TURNSTILE_SITEKEY: DUMMY_SITEKEYS[0], VITE_BUILD_PURPOSE: 'board-test' };
}

/** Variables a build, install or test child may never see (N6, V12-23). */
export const isCredential = (name) => /^CLOUDFLARE_/i.test(name);

export function loadProfile(root) {
  return JSON.parse(readFileSync(join(root, PROFILE_PATH), 'utf8'));
}

/** Defaults a build uses for a value the environment leaves unset (the dev profile). */
export const DEFAULTS = {
  BASE_PATH: '/',
  VITE_SITE_URL: 'https://museumguessr.com/',
  VITE_ANALYTICS_HOSTS: 'museumguessr.com',
  VITE_POSTHOG_PROJECT_TOKEN: '',
  VITE_BOARD_UI: 'false',
  VITE_TURNSTILE_SITEKEY: '',
  VITE_BUILD_PURPOSE: 'dev',
};

/** The switch values a build will use, from an environment (unset means the default). */
export function switchValues(env) {
  return Object.fromEntries(PROFILE_KEYS.map((k) => [k, env[k] ?? DEFAULTS[k]]));
}

/**
 * Invalid switch values and combinations (M3). The build refuses them;
 * each problem is { key, problem, fix }.
 */
export function switchProblems(values) {
  const out = [];
  const add = (key, problem, fix) => out.push({ key, problem, fix });
  const v = { ...DEFAULTS, ...values };
  if (!/^\/(?:[\w.-]+\/)*$/.test(v.BASE_PATH)) add('BASE_PATH', `"${v.BASE_PATH}" is not a path that starts and ends with /`, 'use / for the root');
  let site = null;
  try {
    site = new URL(v.VITE_SITE_URL);
  } catch {
    add('VITE_SITE_URL', `"${v.VITE_SITE_URL}" is not a URL`, 'use https://museumguessr.com/');
  }
  if (site && (site.protocol !== 'https:' || !site.pathname.endsWith('/') || site.search || site.hash)) add('VITE_SITE_URL', `${v.VITE_SITE_URL} must be an https address ending in /`, 'use https://museumguessr.com/');
  if (site && site.pathname !== v.BASE_PATH) add('VITE_SITE_URL', `its path ${site.pathname} differs from BASE_PATH ${v.BASE_PATH}`, 'keep the site path and BASE_PATH equal');
  const hosts = v.VITE_ANALYTICS_HOSTS.split(',').map((h) => h.trim()).filter(Boolean);
  if (site && v.VITE_POSTHOG_PROJECT_TOKEN && !hosts.includes(site.hostname)) add('VITE_ANALYTICS_HOSTS', `${hosts.join(', ') || '(none)'} does not include ${site.hostname}`, 'list the site host so analytics runs on it');
  if (v.VITE_POSTHOG_PROJECT_TOKEN && !v.VITE_POSTHOG_PROJECT_TOKEN.startsWith('phc_')) add('VITE_POSTHOG_PROJECT_TOKEN', 'is not empty and does not start with phc_', 'only the public project token (phc_...) may ship, never a personal key');
  if (!['true', 'false'].includes(v.VITE_BOARD_UI)) add('VITE_BOARD_UI', `"${v.VITE_BOARD_UI}" is not true or false`, 'set true or false');
  if (!PURPOSES.includes(v.VITE_BUILD_PURPOSE)) add('VITE_BUILD_PURPOSE', `"${v.VITE_BUILD_PURPOSE}" is not one of ${PURPOSES.join(', ')}`, 'pick a build purpose');
  if (v.VITE_BOARD_UI === 'true' && !v.VITE_TURNSTILE_SITEKEY) add('VITE_TURNSTILE_SITEKEY', 'the board UI is on but there is no Turnstile site key', 'set the site key from npm run cf:bootstrap, or keep VITE_BOARD_UI=false');
  if (v.VITE_BUILD_PURPOSE === 'deploy' && DUMMY_SITEKEYS.includes(v.VITE_TURNSTILE_SITEKEY)) add('VITE_TURNSTILE_SITEKEY', 'a deploy build uses a Turnstile test key', 'use the real site key; test keys belong to the board-test profile');
  return out;
}

/** Problems with the tracked profile file itself, before any build (H1). */
export function profileProblems(profile, { deploy = false } = {}) {
  const out = [];
  const keys = Object.keys(profile ?? {}).filter((k) => k !== '$comment');
  for (const k of PROFILE_KEYS) if (typeof profile?.[k] !== 'string') out.push({ key: k, problem: 'missing or not a string', fix: `add "${k}" to ${PROFILE_PATH}` });
  for (const k of keys) if (!PROFILE_KEYS.includes(k)) out.push({ key: k, problem: 'is not a public profile key', fix: `remove it from ${PROFILE_PATH}` });
  if (out.length) return out;
  out.push(...switchProblems(profile));
  if (profile.VITE_BUILD_PURPOSE !== 'deploy') out.push({ key: 'VITE_BUILD_PURPOSE', problem: `is "${profile.VITE_BUILD_PURPOSE}", not deploy`, fix: `the tracked profile builds the deployed page; set "deploy"` });
  if (deploy && (profile.VITE_POSTHOG_PROJECT_TOKEN === TOKEN_PLACEHOLDER || !profile.VITE_POSTHOG_PROJECT_TOKEN)) {
    out.push({ key: 'VITE_POSTHOG_PROJECT_TOKEN', problem: 'still holds the placeholder, so the deployed page would send no analytics', fix: `put the public project token (phc_...) into ${PROFILE_PATH} and commit it` });
  }
  return out;
}

/**
 * The environment for a profile build: the shell's variables without any
 * CLOUDFLARE_* credential, then the profile values and the build id. A shell
 * value that differs from the profile is an override and is refused.
 */
export function resolveBuild({ profile, buildId, shellEnv, deploy = false }) {
  const problems = profileProblems(profile, { deploy });
  for (const k of PROFILE_KEYS) {
    if (shellEnv[k] !== undefined && shellEnv[k] !== profile?.[k]) {
      problems.push({ key: k, problem: `the shell sets it to "${k.includes('TOKEN') ? '…' : shellEnv[k]}", overriding the tracked profile`, fix: `unset ${k}; change ${PROFILE_PATH} in a commit instead` });
    }
  }
  if (!/^[\w.-]{1,40}$/.test(String(buildId ?? ''))) problems.push({ key: 'VITE_BUILD_ID', problem: `"${buildId}" is not a build id`, fix: 'pass a short commit SHA or a plain word' });
  const env = Object.fromEntries(Object.entries(shellEnv).filter(([k]) => !isCredential(k)));
  const values = Object.fromEntries(PROFILE_KEYS.map((k) => [k, profile?.[k]]));
  Object.assign(env, values, { VITE_BUILD_ID: String(buildId) });
  return { env, values, problems };
}
