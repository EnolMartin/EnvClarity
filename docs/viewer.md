# Report viewer

The viewer opens a JSON result from the CLI so you can browse its findings. It does not run audits. For the complete installation and audit steps, see the [usage guide](guide.md).

## Start it

From a repository checkout:

```sh
pnpm build
pnpm viewer:build
node dist/cli.js viewer
```

From a project with the local package installed:

```sh
pnpm exec envclarity viewer
```

Open the printed address in your browser. The server uses a free port on `127.0.0.1`. It stays running until you press Ctrl+C and does not open a browser automatically.

## Read a report

Choose a JSON file generated with `--format json`. The viewer accepts the complete CLI result, not a bare `report` object. Completed reports use schema version **1**. Package version **0.1.0** and report schema version **1** are separate version numbers.

The summary shows the full error, warning and finding counts. Coverage stays visible, including when the report has no findings. A valid failed audit shows an explanation without a completed-report summary.

Use severity, type and search together to narrow the findings. Search matches variable names and source paths without regard to case; it does not search source contents or values. Matching one location keeps all locations of that finding. The summary totals do not change when you filter.

Expand **View locations** for paths, lines, columns and reference origins. Findings without a location say so. A dynamic reference has a location but no inferred variable name.

The filter menus support arrows, Home, End and letter search. Enter or Space opens a menu or confirms an option; Escape closes it without selecting. Tab confirms an active option and moves focus onward. Pagination is available for longer lists.

## Limits

| Resource | Limit |
| --- | --- |
| JSON file | 10 MiB (10,485,760 bytes) |
| Findings | 20,000 |
| Reference and location objects combined | 100,000; each reference and its location count separately, including repeated appearances |
| Variable name | 1,024 UTF-16 code units |
| Source path | 4,096 UTF-16 code units |
| Findings or expanded locations per page | 50 each |

Unsupported schemas, malformed JSON, unknown fields and inconsistent summaries are rejected. Oversized files are rejected before reading. Choosing another file replaces the current result; canceling the file picker keeps it. Only the latest pending selection can update the page.

If an import fails, choose a new CLI JSON result or clear the report. Error messages do not include the selected file name, raw contents or parser exception.

## Local processing

The report stays in browser memory without upload, browser storage or automatic restore. Clear or reload starts the page empty; the file on disk remains until you delete it. Variable names and paths may be sensitive even though the CLI omits environment values.

The local server serves only bundled assets from memory. It validates Host and Origin, accepts GET/HEAD, and has no report endpoint. Request paths are not used to read files from your project. Its content security policy blocks connections from the page.

IBM Plex Mono is bundled locally with its license. Notices for React, React DOM, Scheduler and the Vite preload helper are included in `viewer/public/assets/THIRD-PARTY-LICENSES.txt` and copied into the build. No external font service is used.

## Development checks

For frontend development, use `pnpm viewer:dev`. To run the production browser tests:

```sh
pnpm exec playwright install chromium --only-shell
pnpm viewer:test
```

Run these from the repository after installing dependencies. The test command checks types, builds the viewer and starts a separate preview on `127.0.0.1:4174`. It refuses to reuse an existing server and shuts down afterwards. Tests use Chromium; other browsers, physical mobile devices and screen readers still need separate checks. Test output stays under the ignored `viewer/test-results/` directory.
