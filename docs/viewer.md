# Local report viewer

Status: scope and visual direction approved. Local JSON import, bounded validation, summary and coverage are implemented. Finding details, combined filters and bounded pagination are implemented. The CLI remains the source of audit results. Independent usability validation is pending; the viewer is an optional way to explore an existing report.

## Purpose and boundary

Import one JSON result produced by the CLI, understand its summary and coverage, and locate findings through filters. The browser does not scan source files, read environment files, run an audit or modify an audited project.

Use React, TypeScript and Vite within this repository, with pnpm and the existing Node support range. The owner approved the initial React/Vite dependencies. No additional workspace, account system, database, remote API, analytics or external asset service is needed.

The local development server serves the viewer assets. Report contents are processed in browser memory and are not sent to it or another service. Do not add report uploads, browser storage, automatic restore or network requests carrying report data. Use local system fonts and bundled assets, including self-hosted IBM Plex Mono; do not request fonts from external services. Names and paths may still be sensitive, even though the CLI excludes environment values.

## Import and exploration

1. Start with a labelled file picker and a short instruction to generate a report using the CLI's JSON format. A button is the primary action; drag and drop is unnecessary for the first version.
2. After choosing a file, clear the previous result and filters and show a reading/validation state. Canceling the picker preserves the current result. If a newer selection replaces an in-flight read, only the newest selection may update the screen.
3. Check the file size before reading, parse and validate the result, then display either the completed report or a safe operational-failure state. File extensions and TypeScript types do not establish validity.
4. Display error and warning counts, finding count, and an always-visible description of direct-reference coverage. Coverage limitations describe capabilities, not confirmed occurrences of each unsupported pattern.
5. Browse findings in report order. Each finding shows a severity label, a readable title and code, the variable name when present, a cautious explanation, and all reported locations. A dynamic reference has no inferred variable name. A finding without locations says that no direct location was recorded.
6. Combine severity and issue-type filters with a search over variable names and source paths. Search is a case-insensitive substring match for discovery only; it does not change the case-sensitive variable names or audit rules. A match in any location includes the finding with all of its locations. Search does not inspect source content or environment values. Reset restores all findings.
7. Offer an explicit way to replace or clear the imported result. The summary always describes the complete report; a separate label shows the filtered finding count. Filters never mutate or recompute the audit.

Use pages of 50 findings to bound the rendered list; changing a filter resets the page. Location groups can expand within a finding, exposing a bounded page of locations with a clear count. Do not render every reference or finding into the DOM at once, and do not add a virtualization dependency by default.

## Proposed visual direction

A restrained console interface: solid near-black background with a green-charcoal tint, dark green panels, light readable text, a lime-green primary action with dark text and angular borders to separate groups. Error and warning labels use red and amber accents together with explicit text and symbols; color is never the only distinction. Local system monospace fonts for headings, controls and counts, self-hosted IBM Plex Mono for supporting text, modest spacing and no animation required for core tasks.

One page, without a sidebar or decorative dashboard charts:

```text
EnvClarity                       [Choose JSON report]
Local report viewer

[Errors: 1]  [Warnings: 3]  [Findings: 4]
Coverage: direct references only. [View limitations]

Severity [All]  Type [All]  Search variable or file [      ]
Showing 4 of 4 findings                              [Reset]

ERROR  Missing variable  MISSING_VARIABLE
DATABASE_URL
Documented in the selected example, absent from the selected environment.
  src/server.ts : 8 : 3

[Previous]                 Page 1 of 1                 [Next]
[Clear report]
```

This is an illustrative layout with invented names, not a screenshot or implemented behavior. Use English product text, consistent with the CLI. On narrow screens, stack summary and filter controls and let long labels wrap without losing actions or focus visibility.

## Required states

| State | Behavior and next action |
| --- | --- |
| No file | Explain the expected CLI JSON and offer file selection. |
| Reading/validating | Announce progress accessibly and permit a newer selection or clear action. Do not show stale report data as current. |
| Invalid input | Show a short safe reason and allow another file. Do not display raw JSON or parser exceptions. |
| Unsupported schema | Identify the supported report schema without guessing how to migrate the file. |
| Completed, no findings | Say no findings were detected within the analysis scope, while keeping coverage limits visible. |
| Completed, warnings/errors | Show the report and filters. `completed` does not imply that configuration is correct. |
| No filter matches | Keep the report summary visible and offer filter reset. |
| Audit failed | For a valid `{ "status": "failed", "code": ... }` result, show safe guidance for that code and no report summary or filters. This is different from an invalid JSON file. |
| Browser read failure or oversized input | Explain the local read/size problem safely and allow replacement. |

Coverage remains visible for every completed report, including an empty one. Possible lack of use does not justify deleting a variable automatically; empty may be intentional. No state promises full runtime, deployment or secret-leak validation.

## Data contract and validation

Consume the CLI's `AuditResult` envelope, not a bare report. Completed results contain `report.schemaVersion: 1`; failed results contain a safe `AuditFailureCode` and no report. Reuse the existing pure contracts from `src/core/types.ts` with type-only imports. Browser validation constructs a new allowlisted object after checking the unknown input; a type assertion is not validation.

Require supported status/code/severity combinations, correctly shaped references and coverage, bounded strings and lists, positive integer locations, and finite nonnegative integer counts. Completed summary counts must agree with the issues. Reject unknown fields for schema 1 instead of retaining extra values or content. Validate failure results separately and do not treat them as successful reports. These are import checks, not another implementation of the variable comparison rules.

Enforced viewer limits:

- 10 MiB per imported JSON file, checked before reading.
- 20,000 issues and 100,000 reference and location objects in total across all report lists. Each reference and its nested location count as two objects; repeated occurrences count separately, before any deduplication.
- 1,024 UTF-16 code units per variable name and 4,096 per source path.
- Only the known schema shape; no recursive extension objects, arbitrary HTML or executable metadata.

These browser limits are separate from CLI scanning budgets. A valid CLI result may exceed them; reject it with an explicit size/structure message rather than silently dropping data. Revisit the limits only with measured evidence.

Render labels as text. Display control/formatting characters visibly where needed to prevent misleading labels; do not interpret HTML, Markdown or ANSI escapes supplied by the report. Never turn paths, URLs or URI-like strings into automatic links, editor actions or file reads. Do not persist the original file name or contents. Errors and console output must not reproduce report data or raw exceptions.

## Folder and build boundary

Proposed files, created only as their behavior is implemented:

```text
src/core/types.ts           existing shared pure contracts
viewer/
  index.html
  vite.config.ts
  tsconfig.json
  src/
    main.tsx
    App.tsx
    styles.css
    report/
      validate.ts           runtime validation and bounded projection
      filter.ts             pure derived filtering/paging
    components/             focused pieces when extraction is useful
```

Keep the existing root package and lockfile; do not create a monorepo or pnpm workspace. The viewer gets its own TypeScript/build configuration and explicit scripts such as `viewer:dev`, `viewer:build` and `viewer:typecheck`. Existing CLI scripts and `dist/` output keep their current behavior. Viewer build output belongs to `viewer/dist/` and is excluded from the CLI package.

The shared contract must have no Node, filesystem or compiler imports. Import it as types only. Do not import `audit.ts`, I/O modules, the analyzer, TypeScript at runtime, CLI entry points or CLI reporters into the browser. Maintain small browser-local UI explanation mappings; share pure explanation data only if an actual duplication later warrants it. Inspect the built browser bundle to verify the boundary rather than assuming type safety proves it.

Keep the current CLI package allowlist. New viewer source, dependencies used only for tooling, build output and synthetic report fixtures must not accidentally enter its archive. Decide installation categories for React/React DOM and build tools explicitly during setup, obtaining approval for new production dependencies.

## Acceptance before considering the viewer usable

- Import a synthetic report from the compiled CLI and show consistent counts, all five issue types, ordered locations and coverage.
- Handle empty reports, valid failed results, malformed JSON, unsupported versions and excessive data with clear distinct states.
- Replace, cancel, clear and select files in quick succession without stale results; do not persist or transmit report data.
- Combine/reset filters and pagination; counts are labelled as full-report versus filtered counts.
- Display HTML-like text, URI-like paths and control characters safely, without navigation or execution.
- Complete core actions by keyboard with labels, visible focus, semantic headings, accessible progress/errors and responsive layouts.
- Compile the browser without Node or compiler modules, and keep CLI checks and the isolated CLI package test passing.

The current interface imports and validates local results and displays the full summary and coverage. An empty report keeps the coverage visible and omits finding filters. Findings can be explored with severity/type filters, name/path search and pagination.

## Run the viewer

Install the repository dependencies with `pnpm install --frozen-lockfile`, then run `pnpm viewer:dev` from the repository root. Open the loopback URL printed by Vite. Choose a local CLI JSON result to display its summary and coverage. The viewer does not scan projects or environment files.

Run `pnpm viewer:typecheck` to check browser code, Vite configuration and browser-test code/configuration. Run `pnpm viewer:build` to check types and generate `viewer/dist/`. The existing CLI commands and its root `dist/` output remain separate.

React, React DOM and Vite are development dependencies of this repository: Vite bundles the browser runtime into the viewer build. They are not runtime dependencies of the distributed CLI. The CLI package allowlist excludes the viewer source and build output.

## Runtime validator

`viewer/src/report/validate.ts` exports `validateReportJson(text)` and `REPORT_LIMITS`. The result contains either an allowlisted `AuditResult` or one safe error code: `INVALID_JSON`, `INVALID_REPORT`, `UNSUPPORTED_SCHEMA` or `LIMIT_EXCEEDED`. A valid operational failure remains a valid audit result. Unknown fields are rejected for schema 1; its four coverage limitations must be present without duplicates. Unsupported positive integer versions are identified before enforcing the schema 1 report fields.

The validator checks UTF-8 byte size before JSON parsing, and the file picker also checks `File.size` before reading. It preserves issue/reference order and duplicates, validates summary counts, and projects fresh objects without rendering, logging, persistence or network access. Control characters and HTML-like labels remain plain data for safe display in a later step.

Run `pnpm test` for contract and boundary tests, including reports produced by the CLI core, through the existing Node test runner. The validator imports the shared contract only as types and adds no runtime dependency.

## Local import and summary

Choose one JSON result through the file picker; its extension is a picker hint, not a validity check. The viewer checks the 10 MiB size limit before reading, then validates the text. It shows error, warning and finding counts for a completed result, including a zero-finding result, alongside all reported analysis limitations. A valid CLI failure gets a separate explanation without a summary. Import errors provide fixed guidance without displaying the file name, raw contents or parser exception.

A new selection immediately replaces the previous result with a reading state; only the latest read may update the screen. Clearing invalidates pending reads and returns to the initial screen. Canceling selection leaves the current state unchanged, and the same file can be selected again. Pending reads are ignored after unmounting. A superseded read is not physically aborted; each read is bounded by the file size check. Reports remain in component memory, without upload, browser storage or automatic restore.

Individual findings are shown below the complete report summary and coverage. Import lifecycle tests run with the existing `pnpm test` command and use synthetic in-memory files.

## Bundled font

Supporting text uses IBM Plex Mono Regular and SemiBold from the official `@ibm/plex-mono` 2.5.0 package ([IBM Plex](https://github.com/IBM/plex)). Only the unmodified WOFF2 font files and their OFL license are included in `viewer/public/fonts/ibm-plex-mono/`; the package is not installed or executed. The build copies these assets and the license into the viewer output. Headings retain their local system monospace stack. Font requests stay on the viewer's own origin.

## Explore findings

Each finding shows its severity, code, variable name when known and a cautious explanation. Dynamic references do not invent a name; findings without a recorded location say so. Expand a location group to see paths, one-based line/column and reference origins. Lists show at most 50 findings per page and 50 locations per expanded group. Closed groups do not render their location lists.

Severity, type and search combine. Search matches literal case-insensitive substrings of variable names or any source path; it does not interpret regex or search explanations/source contents. A location match retains every location of that finding. Filtering preserves report order and never changes the full summary, original names, references or comparison rules. Changing or resetting a filter returns to finding page 1; choosing another report resets all filters. Counts say how many findings match, separately from the report totals.

Names and paths render as text inside bidirectional isolation, with control/formatting characters displayed as explicit Unicode escapes. Spaces are preserved and long labels wrap. HTML, Markdown and ANSI sequences are not interpreted, and paths/URLs do not become links or file actions. Pure filter/label tests run through `pnpm test`; browser checks use synthetic reports.

The severity and type controls use local select-only comboboxes so their popup and hover/active states follow the console palette instead of the operating system's blue menu. They support pointer selection, arrows, Home/End, Enter/Space, letter search and Tab selection; Escape cancels and outside clicks close the popup. Active options scroll into view. The implementation follows the [WAI select-only combobox guidance](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-select-only/); dedicated assistive-technology and mobile checks remain part of the accessibility review.

## Interface states and recovery

The initial screen explains the CLI JSON format and offers file selection. During reading/validation, a dedicated panel explains local processing; the live status announces progress and the secondary action becomes **Cancel import**. Choosing another file replaces the current attempt. Cancellation returns to the initial screen and ignores later completion or rejection of the old read.

Import errors have distinct headings for malformed JSON, invalid report structure, unsupported schema, exceeded limits, oversized files and unreadable files. Every error retains the replacement/clear actions. Failed CLI audits remain valid imported results with code-specific guidance and no summary or filters. Errors and in-flight reads never show an old completed result as current.

A completed report with zero findings shows zero totals, an explicit scope caveat and coverage limitations, without empty exploration controls. A filtered report with zero matches keeps the complete summary and coverage, explains how to change the search or reset filters, and omits an empty findings list and pagination. Clearing returns to initial instructions. No state promises full configuration, runtime or deployment validation.

The native test suite covers error/retry transitions and cancellation with delayed reads. Browser checks cover initial, completed, empty, no-match, invalid JSON/structure, unsupported schema, all four CLI failure results and recovery with synthetic reports. Loading and local read-failure transitions are checked deterministically in native import tests and in isolated browser tests; no artificial delay is added to the product.

## Keyboard, contrast and narrow screens

Clearing or canceling an import returns focus to the file-selection button. Pagination keeps focus on an enabled adjacent button when the activated control becomes disabled at either end; page changes have atomic status announcements. This behavior is shared between findings and location pages. Import status is atomic, failures retain an alert, the decorative terminal mark is hidden from the accessibility tree, and severity is always named in text.

Buttons, search, filter triggers, options and location summaries have a minimum height of 44 CSS pixels. Editable/search and filter controls use 16px text. Long labels and paths wrap; custom menus limit their height relative to the viewport and scroll the active option into view. Escape, selection, blur and outside dismissal reset letter-search state so a reopened filter starts a fresh search.

Manual browser checks covered a keyboard-triggered file chooser, filtering, typed search, reset, location expansion, both pagination controls, clearing and error recovery. Reflow checks at 280, 320, 375, 768 and 1280 CSS pixels found no horizontal overflow with synthetic names of 1,024 characters. Expanded paths of 4,096 characters also remained within the 320px viewport. A 320 × 320 viewport kept the active menu option visible. Temporary viewport settings were reset after testing.

Calculated contrasts include secondary text at 8.18:1 or above, error/warning text at 9.47:1 or above, active controls at 11.96:1 and input/control boundaries at 3.65:1 or above. Reference targets are the WAI explanations for [text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html). Visible focus was checked with keyboard input. These are scoped implementation checks, not a WCAG certification; real screen readers, physical mobile devices, OS text settings and cross-browser combinations still require independent testing. The browser suite below covers these keyboard, focus and reflow regressions in Chromium.

## Automated browser workflows

The browser suite uses Playwright Test as a development dependency. Install the matching headless Chromium once (and again after a Playwright browser-version update), then run:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium --only-shell
pnpm viewer:test
```

`viewer:test` checks types, builds the viewer and launches its production preview on `127.0.0.1:4174`. It refuses to reuse an existing server, runs tests in isolated Chromium contexts with two workers and no retries, and shuts down its preview afterwards. The normal development server on port 5173 is independent. `pnpm test` continues to run the native core/import/filter suite; `pnpm test:package` checks the separate CLI archive and installed executable.

The 21 browser cases cover CLI-core-generated synthetic reports, all five findings, summary/coverage, empty results, combined filters, path/name search, reset, canceled and repeated selection, finding/location pagination and focus, dropdown keyboard/pointer interaction, all four operational failures, malformed/invalid/unsupported/over-limit reports, pre-read rejection above 10 MiB, read errors, canceling pending reads, newest-selection-wins races, safe labels and responsive bounds. Faults and deferred reads are injected into each isolated test page's File API; no test hook or delay is shipped in the viewer. Fixtures contain invented names and paths and do not inspect user projects or environment files.

The privacy case observes requests, methods, payloads, headers, WebSockets, console messages and browser errors across import, search, invalid input, clear and reload. It rejects external requests and checks that report/name canaries never appear in network or console output. Storage instrumentation plus local/session storage, cookies, IndexedDB, Cache Storage, history state and window-name checks detect unwanted persistence in the exercised flow. Reload must return to the initial screen. These checks cover the tested flows, not every possible data channel or future change.

Test output and failure screenshots are written under `viewer/test-results/` and ignored by Git. Traces are off; no report fixtures are submitted to an external service. Browser dependencies, test code and results stay outside both the CLI archive and the browser runtime bundle. The initial automated target is headless Chromium; screen readers, physical devices and additional browser engines remain independent checks. CI integration is not changed by this test setup.
