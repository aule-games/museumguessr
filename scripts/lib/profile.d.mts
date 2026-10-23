export interface SwitchProblem { key: string; problem: string; fix: string }
export const PROFILE_PATH: string;
export const PROFILE_KEYS: readonly string[];
export const PURPOSES: readonly string[];
export const TOKEN_PLACEHOLDER: string;
export const DUMMY_SITEKEYS: readonly string[];
export const DEFAULTS: Readonly<Record<string, string>>;
export const DEPLOY_FORBIDDEN_MARKERS: readonly { pattern: RegExp; what: string; id: string }[];
export function isCredential(name: string): boolean;
export function loadProfile(root: string): Record<string, string>;
export function switchValues(env: Record<string, string | undefined>): Record<string, string>;
export function switchProblems(values: Record<string, string | undefined>): SwitchProblem[];
export function profileProblems(profile: unknown, options?: { deploy?: boolean }): SwitchProblem[];
export function resolveBuild(options: { profile: unknown; buildId: string; shellEnv: Record<string, string | undefined>; deploy?: boolean }): {
  env: Record<string, string>;
  values: Record<string, string>;
  problems: SwitchProblem[];
};
export function boardTestValues(profile: Record<string, string>): Record<string, string>;
