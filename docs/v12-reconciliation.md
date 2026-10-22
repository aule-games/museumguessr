# Release 1.2 specification reconciliation

This is a target-specification checkpoint, not a release announcement. The
requirement manifest records implementation separately. Final approved decisions
override earlier design, engineering and operations proposals. No existing
runtime timer, board or hosting behaviour changes at step 0.

| Subject | Final rule | Requirement |
| --- | --- | --- |
| Board entry | Automatic eligible-game submission; Share remains the primary action | V12-80, V12-116 |
| End fold | Board card may be below the fold even on the tall phone | V12-162 |
| Persistence | Only deliberate board/history opening requests persistent storage | V12-122 |
| Mode | D1 settings plus a force-off secret; releases do not reset it | V12-103, V12-104 |
| Dark tests | A separate smoke table, never public ranks or buckets | V12-105 |
| Old hosting | Unpublish after the new-domain live check and explicit approval | V12-33 |
| Timing evidence | Three separate completion measures; no automated timer-policy change | V12-76 |
| Junk routing | Unknown fetches may invoke code; test 404/header behaviour, not zero invocations | V12-10 |
| Event naming | Keep existing game_start; the plan's game_started wording means an added property, not a renamed event | V12-73 |
| Current standing | Start shows last-confirmed receipt rank, not a fresh rank | V12-123 |

## Contract choices made explicit

- Contract version starts at 1 because no board contract has shipped. A future
  previous-version adapter needs matching scoring rules; version 0 is not accepted.
- The existing receipt route remains GET /api/v1/scores/<row_id>. Its private
  current_game_id lets an older local game detect replacement; authenticated
  board reads carry the separate historical receipts. No game ids enter public
  responses. The owner's board read returns this week's best and at most one
  best per retained week (eight), with no history paging, and the whole
  personal read stays within one hundred scanned rows. This bounds the original unbounded
  historical-receipt wording without dropping retained receipts.
- Missing/malformed bearer credentials use invalid (400). An owner mismatch uses
  duplicate (409). The retained 404 receipt behaviour needs the mechanical
  not_found reason. It is not permission to reveal another owner's data.
- Infrastructure and D1 quota failures use unavailable, following the final mode
  and quota rules, rather than the older daily-quota-specific reason. The page
  keeps pending records; edge rate limiting has its own normalized reason.
- Null completion week cannot prove eligibility: preserve the record and show
  unknown-week copy, without assigning an offline game to a later week. A known
  idempotent retry retains the original receipt week. To make a first online
  game eligible, fetch anonymous server week context once when round ten
  opens (skipped when the board UI or the auto-add switch is off). Freeze the last successful response at reveal ten;
  late responses cannot rewrite it. This nonblocking pre-completion timing was
  unspecified in the source plan and leaves the end-screen call budget intact.
- Dark smoke reads use X-MuseumGuessr-Test: 1, only in dark mode, and return
  server week plus optional owner smoke context, never public ranks. Smoke
  ranks are null. This client-declared header is not authorization and cannot
  enable ranking; ordinary dark/off browsers still receive disabled.
- Carry forward the earlier privacy safeguards: no stored raw pins, IP or user
  agent; cleared name/answer detail on removal; invalidated public caches on
  delete/hide/unhide; invocation logging disabled. Redacted console tracing is
  the only permitted exception, not automatic invocation capture.
- The hash excludes only the verification token/authorization. Canonical game
  fields, including contract version, board week and test provenance, are fixed
  before the first POST. A retry changes its token, not its canonical game.
- The initial API curl examples depend on the step-3 local fixture harness;
  they do not suggest a currently running endpoint or a real credential.

These choices make underspecified wire details reviewable without changing
approved product decisions. Runtime validators, schema, Worker routes and
network behaviour belong to step 3; types alone are not validation.

## Checkpoint discipline

The eight step-0 requirements have linked tests. Later requirements start with
no claimed evidence. Advancing built_through_step requires completing all rules
up to that step; a generic test with an id cannot substitute for the explicitly
linked tests. The full verification run is distinct from local unit success.

Source references in the manifest retain the approved plan's identifiers without
publishing private planning files. Local research remains draft evidence until
content review and separate contact-sheet approvals.
