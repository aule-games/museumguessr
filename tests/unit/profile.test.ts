import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadProfile, PROFILE_KEYS, profileProblems, resolveBuild, switchProblems, TOKEN_PLACEHOLDER } from '../../scripts/lib/profile.mjs';
// @ts-expect-error plain ESM script without types
import { profileBuild } from '../../scripts/build.mjs';

const ROOT = join(import.meta.dirname, '../..');
const profile = loadProfile(ROOT);
const keys = (problems: { key: string }[]) => problems.map((p) => p.key);

describe('the tracked public profile (H1)', () => {
  it('one tracked file holds every public deploy value, and CI and deploy resolve identical values from it [V12-18]', () => {
    expect(profile).toMatchObject({
      BASE_PATH: '/',
      VITE_SITE_URL: 'https://museumguessr.com/',
      VITE_ANALYTICS_HOSTS: 'museumguessr.com',
      VITE_BOARD_UI: 'false',
      VITE_TURNSTILE_SITEKEY: '',
      VITE_BUILD_PURPOSE: 'deploy',
    });
    expect(Object.keys(profile).filter((k) => k !== '$comment').sort()).toEqual([...PROFILE_KEYS].sort());
    expect(profileProblems(profile)).toEqual([]);
    // CI: GitHub's runner environment; deploy: the founder's shell with the token present.
    const ci = profileBuild({ buildId: 'e2e', shellEnv: { CI: 'true', GITHUB_ACTIONS: 'true', PATH: '/usr/bin' } });
    const deploy = profileBuild({ buildId: 'abc1234', shellEnv: { PATH: '/usr/bin', CLOUDFLARE_API_TOKEN: 'secret', CLOUDFLARE_ACCOUNT_ID: 'acct' } });
    expect(ci.problems).toEqual([]);
    expect(deploy.problems).toEqual([]);
    expect(ci.values).toEqual(deploy.values);
    for (const k of PROFILE_KEYS) expect(ci.env[k]).toBe(deploy.env[k]);
    // Both paths run scripts/build.mjs: verify's build step and npm run deploy.
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['build:e2e']).toBe('node scripts/build.mjs --build-id e2e');
    expect(readFileSync(join(ROOT, 'scripts/verify.mjs'), 'utf8')).toContain("sh('npm', ['run', '-s', 'build:e2e'])");
  });

  it('the deploy profile refuses shell overrides, a placeholder token and invalid switch combinations [V12-18]', () => {
    const over = resolveBuild({ profile, buildId: 'abc1234', shellEnv: { BASE_PATH: '/museumguessr/', VITE_POSTHOG_PROJECT_TOKEN: 'phc_other' } });
    expect(keys(over.problems)).toEqual(['BASE_PATH', 'VITE_POSTHOG_PROJECT_TOKEN']);
    expect(over.problems[1]!.problem).not.toContain('phc_other');
    expect(resolveBuild({ profile, buildId: 'abc1234', shellEnv: { BASE_PATH: '/' } }).problems).toEqual([]);
    expect(keys(profileProblems({ ...profile, VITE_POSTHOG_PROJECT_TOKEN: TOKEN_PLACEHOLDER }, { deploy: true }))).toEqual(['VITE_POSTHOG_PROJECT_TOKEN']);
    expect(keys(profileProblems({ ...profile, EXTRA: 'x' }))).toEqual(['EXTRA']);
    expect(keys(profileProblems({ ...profile, VITE_BUILD_PURPOSE: 'dev' }))).toEqual(['VITE_BUILD_PURPOSE']);
    expect(keys(switchProblems({ VITE_BOARD_UI: 'true' }))).toEqual(['VITE_TURNSTILE_SITEKEY']);
    expect(keys(switchProblems({ VITE_BOARD_UI: 'true', VITE_TURNSTILE_SITEKEY: '1x00000000000000000000AA', VITE_BUILD_PURPOSE: 'deploy' }))).toEqual(['VITE_TURNSTILE_SITEKEY']);
    expect(switchProblems({ VITE_BOARD_UI: 'true', VITE_TURNSTILE_SITEKEY: '1x00000000000000000000AA', VITE_BUILD_PURPOSE: 'board-test' })).toEqual([]);
    expect(keys(switchProblems({ VITE_POSTHOG_PROJECT_TOKEN: 'phx_personal' }))).toEqual(['VITE_POSTHOG_PROJECT_TOKEN']);
    expect(keys(switchProblems({ VITE_BOARD_UI: 'yes', VITE_BUILD_PURPOSE: 'prod' }))).toEqual(['VITE_BOARD_UI', 'VITE_BUILD_PURPOSE']);
    expect(keys(switchProblems({ BASE_PATH: 'museumguessr', VITE_SITE_URL: 'http://museumguessr.com/' }))).toEqual(['BASE_PATH', 'VITE_SITE_URL', 'VITE_SITE_URL']);
    expect(keys(switchProblems({ VITE_POSTHOG_PROJECT_TOKEN: 'phc_x', VITE_ANALYTICS_HOSTS: 'example.org' }))).toEqual(['VITE_ANALYTICS_HOSTS']);
  });

  it('build children never receive Cloudflare credentials [V12-23]', () => {
    const { env } = resolveBuild({ profile, buildId: 'abc1234', shellEnv: { PATH: '/usr/bin', HOME: '/home/x', CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a', cloudflare_extra: 'b' } });
    expect(Object.keys(env).filter((k) => /cloudflare/i.test(k))).toEqual([]);
    expect(env).toMatchObject({ PATH: '/usr/bin', HOME: '/home/x', VITE_BUILD_ID: 'abc1234', BASE_PATH: '/' });
  });
});
