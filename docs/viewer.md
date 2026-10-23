# Local report viewer

Status: proposed scope and visual direction for owner review. The viewer is not implemented. The CLI remains the source of audit results. Independent usability validation is pending; the viewer is an optional way to explore an existing report.

## Purpose and boundary

Import one JSON result produced by the CLI, understand its summary and coverage, and locate findings through filters. The browser does not scan source files, read environment files, run an audit or modify an audited project.

Use React, TypeScript and Vite within this repository, with pnpm and the existing Node support range. Dependency installation requires a separate owner decision. No additional workspace, account system, database, remote API, analytics or external asset service is needed.

The local development server serves the viewer assets. Report contents are processed in browser memory and are not sent to it or another service. Do not add report uploads, browser storage, automatic restore or network requests carrying report data. Use system fonts and bundled assets. Names and paths may still be sensitive, even though the CLI excludes environment values.

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

A restrained utility interface: light neutral background, white content surfaces, dark readable text, a blue primary action and borders to separate groups. Error and warning labels use red and amber accents together with explicit text and symbols; color is never the only distinction. System fonts, modest spacing and no animation required for core tasks.

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

Initial viewer limits, to enforce and test when validation is implemented:

- 10 MiB per imported JSON file, checked before reading.
- 20,000 issues and 100,000 reference/location objects in total across all report lists; count before deduplication.
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

The owner reviews this scope, proposed visual direction, states and folder boundary before interface implementation. Installation, runtime validation, import and exploration are separate subsequent changes. This document authorizes none of them by itself and does not claim that the viewer already exists.
