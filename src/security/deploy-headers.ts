// The security headers of the deployed build (V12-13, V12-125, V12-170). The
// page's `_headers` file and the Worker's own answers (API and the 404 it
// passes through) read the same tracked profile, so a build with the board UI
// allows Turnstile on every response and one without names it nowhere.
import profile from '../../deploy/profile.json';
import { securityHeadersFor } from './headers.ts';

export const DEPLOY_BOARD_UI: boolean = profile.VITE_BOARD_UI === 'true';
export const DEPLOY_HEADERS: Readonly<Record<string, string>> = securityHeadersFor(DEPLOY_BOARD_UI);
