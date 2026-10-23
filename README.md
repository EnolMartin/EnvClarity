# EnvClarity

EnvClarity checks how a TypeScript, Node or Vite project uses environment variables. It compares direct source references with an example file and an explicitly selected environment file, so you can find undocumented, missing or empty configuration before running the application.

The example file defines the expected names. A source reference alone does not prove that a variable is required: the application may have defaults or optional behavior.

Version **0.1.0** remains private and available for local use. Independent user validation is pending; technical checks do not establish usability or demand. No registry release is announced.

## Requirements

- Node **24.17.0 or later in the 24.x line**, or **26.0.0 or later in the 26.x line** (`^24.17.0 || ^26.0.0`). Node 25 and other major versions are outside the declared support range.
- **pnpm 11.8.0**, as pinned in `package.json`.
- A local checkout of this repository or a locally generated package archive.

The commands below were checked on macOS with Node 24.17.0 and 26.0.0. Other platforms have not been verified. Installation may need access to the registry for declared dependencies. Auditing itself runs locally without network requests or telemetry.

## Install from the repository

From the repository directory, with the required Node and pnpm versions on `PATH`:

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm build
node dist/cli.js --help
```

Run the compiled CLI with `node dist/cli.js check <root> --env <file>`. Rebuild after changing the source.

## Install a generated package locally

The package is private and is not presented here as a published registry package. Generate an archive from the repository; `prepack` builds the CLI automatically:

```sh
archive_dir=$(mktemp -d)
pnpm pack --out "$archive_dir/envclarity-0.1.0.tgz"
```

In the same shell, install that archive in a separate temporary consumer directory:

```sh
consumer_dir=$(mktemp -d)
cd "$consumer_dir"
printf '%s\n' '{"name":"envclarity-local-demo","private":true}' > package.json
pnpm add --ignore-scripts "$archive_dir/envclarity-0.1.0.tgz"
pnpm exec envclarity --help
```

This installs the generated CLI and its declared runtime dependency, TypeScript. It does not install dependencies in the project being audited. The archive contains the compiled runtime files, `package.json` and this README; source tests, fixtures, environment files and private project documents are excluded.

## Try a small audit

Continue in the temporary consumer directory above. All values in this example are synthetic:

```sh
mkdir -p demo/src demo/config
printf '%s\n' 'process.env.DEMO_NAME;' > demo/src/app.ts
printf '%s\n' 'DEMO_NAME=' > demo/.env.example
printf '%s\n' 'DEMO_NAME=synthetic-demo' > demo/.env.local
pnpm exec envclarity check ./demo --env .env.local --format text
```

Text output (exit code `0`):

```text
Audit completed.
Summary: 0 error(s), 0 warning(s).
No issues detected within the analysis scope.

Coverage: direct references only (process.env and import.meta.env).
- Aliases are not resolved.
- Destructuring is not resolved.
- Wrapper functions are not resolved.
- Dynamic reference names are not resolved.
Other access patterns may be missed. This does not validate the complete runtime or deployment configuration.
```

Request JSON instead:

```sh
pnpm exec envclarity check ./demo --env .env.local --format json
```

The actual output is one compact JSON object followed by a newline. Shown with whitespace for readability:

```json
{
  "status": "completed",
  "report": {
    "schemaVersion": 1,
    "summary": { "errorCount": 0, "warningCount": 0 },
    "issues": [],
    "references": [{ "name": "DEMO_NAME", "origin": "process.env", "location": { "path": "src/app.ts", "line": 1, "column": 1 } }],
    "coverage": {
      "scope": "direct-references",
      "limitations": ["ALIASES_NOT_RESOLVED", "DESTRUCTURING_NOT_RESOLVED", "WRAPPERS_NOT_RESOLVED", "DYNAMIC_REFERENCES_NOT_RESOLVED"]
    }
  }
}
```

Use an alternative example and environment file:

```sh
printf '%s\n' 'DEMO_NAME=' > demo/config/example.env
printf '%s\n' 'DEMO_NAME=synthetic-ci' > demo/config/ci.env
pnpm exec envclarity check ./demo --env config/ci.env --example config/example.env --format json
```

This also exits `0`. To reproduce an error, select an empty file in which the documented name is absent:

```sh
printf '' > demo/config/missing.env
pnpm exec envclarity check ./demo --env config/missing.env --format json
```

This exits `1` with a completed report containing `MISSING_VARIABLE` for `DEMO_NAME`. The empty declaration in the example file documents the name; its value is not compared. Selecting a nonexistent file instead exits `2`:

```sh
pnpm exec envclarity check ./demo --env config/not-created.env --format json
```

```json
{"status":"failed","code":"READ_ERROR"}
```

For repository usage, replace `pnpm exec envclarity` in these examples with `node dist/cli.js` and run from the repository directory.

## CLI and exit codes

```text
envclarity [--help | -h]
envclarity check <root> --env <file> [--example <file>] [--format text|json]
```

- `check` accepts one project root. `--env` is required; no default environment is selected.
- `--example` defaults to `.env.example`. `--format` defaults to `text`.
- Relative selected file paths start at the audited root, not the current working directory. Absolute selected paths must also remain inside that root. Quote paths containing spaces.
- The selected files and their path components must not be symbolic links. Links encountered during traversal are skipped. The initial root is resolved to its canonical location.
- No other `.env` files, shell variables from `process.env`, deployment settings or external services are merged into the comparison.
- Help works with no arguments, `--help` or `-h`, used alone. Unknown, duplicate, empty or incomplete options and extra positional arguments are rejected.

| Exit | Meaning |
| --- | --- |
| `0` | Audit completed without error-severity issues, even if warnings exist; also used for help. |
| `1` | Audit completed with at least one error-severity issue. The full report is available. |
| `2` | Invalid arguments, or an audit that could not complete because of input, reading, format or resource limits. |

Audits write their result to stdout and leave stderr empty, including operational failures. JSON audits emit only one JSON object and a newline. Operational failures have `status: "failed"` and one safe code: `INVALID_INPUT`, `READ_ERROR`, `FORMAT_ERROR` or `LIMIT_EXCEEDED`, with no partial report. Invalid command syntax instead leaves stdout empty and writes `Invalid arguments. Use --help for usage.` to stderr, even if `--format json` was supplied. Help goes to stdout.

## Issues

| Code | Severity | Meaning |
| --- | --- | --- |
| `UNDOCUMENTED_VARIABLE` | warning | A direct reference uses a name absent from the selected example file. Review whether to document it. |
| `MISSING_VARIABLE` | error | A name documented in the example file is absent from the selected environment file. Review defaults and optional usage too. |
| `EMPTY_VARIABLE` | warning | A documented name is present but empty in the selected environment file. Empty may be intentional. |
| `POSSIBLY_UNUSED_VARIABLE` | warning | A documented name has no detected direct references. Review indirect usage before removing it. |
| `DYNAMIC_REFERENCE` | warning | An environment access has an unresolved name. Its location is reported for manual review. |

Warning-only audits exit `0`. In particular, unresolved dynamic references do not fail a CI check by themselves. `completed` means the audit finished within its scope, even if it found errors or has coverage limitations.

## JSON contract

The CLI emits an `AuditResult`: either `{ "status": "completed", "report": AuditReport }` or `{ "status": "failed", "code": AuditFailureCode }`. The package version (`0.1.0`) and report schema version (`1`) are separate. Only completed results contain a report and its `schemaVersion`.

| Object | Fields |
| --- | --- |
| `AuditReport` | `schemaVersion: 1`, `summary`, `issues`, `references`, `coverage` |
| Summary | `errorCount`, `warningCount` (issue counts) |
| Variable issue | `code`, `severity`, `name`, `references` (possibly empty) |
| Dynamic issue | `code: "DYNAMIC_REFERENCE"`, `severity: "warning"`, `reference` (no inferred name) |
| Variable reference | `name`, `origin`, `location` |
| Dynamic reference | `origin`, `location` |
| Location | Project-relative `path`, one-based `line` and `column` |
| Coverage | `scope: "direct-references"`, `limitations` |

`origin` is `process.env` or `import.meta.env`. Issue codes and severities are listed above. The four coverage limitation codes are `ALIASES_NOT_RESOLVED`, `DESTRUCTURING_NOT_RESOLVED`, `WRAPPERS_NOT_RESOLVED` and `DYNAMIC_REFERENCES_NOT_RESOLVED`. Failed results contain only `status` and one of the four operational codes listed under CLI and exit codes, without a report or partial results.

References are sorted by relative path, numeric line/column, origin and name. Issues are sorted by their first reference location (unlocated issues last), code and contract fields to break ties. Exact duplicates are removed. Identical inputs produce deterministic output without timestamps. The JSON reporter projects only contract fields, preserving the report's order and counts. Values, source snippets and original errors are excluded; names and paths remain visible. This describes CLI output, not validation of arbitrary externally supplied JSON.

## Source coverage and limitations

EnvClarity parses `.ts`, `.tsx`, `.js` and `.jsx` files using the TypeScript syntax tree. It recognizes direct accesses such as:

```js
process.env.NAME;
process.env["NAME"];
import.meta.env.VITE_NAME;
import.meta.env["VITE_NAME"];
```

Comments and strings containing these expressions are not references. Locations use project-relative paths and one-based lines and columns. Vite's `MODE`, `BASE_URL`, `DEV`, `PROD` and `SSR` are ignored only under `import.meta.env`; `process.env.MODE` remains an ordinary reference.

This is syntactic analysis, without type checking, module resolution or execution. It does not resolve aliases, destructuring, wrapper functions or identifiers. For example, `process.env[key]` is dynamic even if `key` was assigned a constant string. Computed expressions and template literals are not resolved. It does not distinguish a local variable named `process` from Node's global object. Unsupported access patterns may be missed, and source syntax diagnostics are not a compilation check. It does not establish runtime requirements, deployment configuration, secret leaks or server-to-browser data flow. Monorepo orchestration is outside the current scope; select one project root per audit.

## Environment file syntax

The same bounded, custom parser reads the selected example and environment files. It retains names and `present`/`empty` states for comparison, rather than parsed values. This is a supported subset of dotenv-like syntax, not shell execution or strict dotenv validation:

- Assignments use `=`. Blank lines, `#` comments and LF/CRLF endings are supported. Unquoted content ends at a newline or `#`; whitespace-only content is empty.
- Surrounding name whitespace is trimmed. An `export` prefix followed by spaces or tabs is removed. Names must be nonempty and contain no `#`, but are not restricted to JavaScript or shell identifiers: digits, punctuation, spaces and non-ASCII characters can occur.
- Content starting with a single quote, double quote or backtick can span lines. The first matching quote closes it. Only whitespace or a `#` comment may follow on that line. Empty quotes mean empty; quoted spaces or newlines mean present. Quotes inside initially unquoted content are literal.
- Backslashes do not escape quotes, and escape sequences are not decoded. Variables such as `$NAME` and `${NAME}` are not expanded. Commands are not executed.
- Duplicate names use the **last occurrence**, including an empty assignment. Example names are deduplicated too.
- Missing `=`, empty names, names containing `#`, unclosed initial quotes, unexpected text after a closing quote or any NUL character produce `FORMAT_ERROR`. No partial report is returned.

A later matching quote can absorb intervening lines as multiline content. Input bytes are decoded as UTF-8 with replacement for invalid sequences, without strict encoding validation. Review these rules when importing files written for another dotenv parser.

## Exclusions, limits and data handling

Traversal skips directories named `node_modules`, `.git`, `dist`, `build`, `coverage`, `.next`, `.turbo` and `.cache` at every depth. Other file extensions are not source candidates. `.gitignore` is not used as an exclusion list, and there is no custom exclusion option. Selected environment files are read explicitly, independently of source discovery.

| Resource | Inclusive limit per audit |
| --- | --- |
| One source file | 2 MiB (2,097,152 bytes) |
| Each selected environment/example file | 256 KiB (262,144 bytes) |
| Directory entries encountered | 20,000 |
| Total source bytes | 50 MiB (52,428,800 bytes) |

Entries include skipped links, excluded directory entries and unsupported files encountered in traversed directories; excluded directory contents are not traversed. Exceeding a limit, or failing to read a source candidate, prevents a completed report and exits `2`. Limits are fixed; there are no CLI overrides.

Environment values do not appear in reports or diagnostics. Reports contain variable names and source locations, which may themselves be sensitive. File contents exist transiently in memory during reading; physical erasure is not guaranteed. EnvClarity does not execute scripts, import modules or executable configuration, install dependencies in, or modify the audited project. Its path and link checks reduce unsafe reads, but are not an atomic snapshot against concurrent filesystem changes. A clean report is limited to the files and direct references inspected.

## Minimal CI usage

In a CI job with this repository checked out, the required Node/pnpm versions already available and a POSIX shell, the following builds EnvClarity and audits a synthetic project. The final command propagates its exit code to the job:

```sh
set -eu
pnpm install --frozen-lockfile
pnpm build
ci_project=$(mktemp -d)
printf '%s\n' 'process.env.DEMO_NAME;' > "$ci_project/app.ts"
printf '%s\n' 'DEMO_NAME=' > "$ci_project/.env.example"
printf '%s\n' 'DEMO_NAME=synthetic-ci' > "$ci_project/.env.ci"
node dist/cli.js check "$ci_project" --env .env.ci --format json
```

For an actual audit, select your project root and a file explicitly prepared by your CI setup. EnvClarity does not read the CI process environment as configuration. Handle the report according to the sensitivity of its names and paths.

## Development checks

From the repository, after installation:

```sh
pnpm typecheck
pnpm test
pnpm test:package
```

`test` builds and runs the functional suite. `test:package` separately packs the CLI, checks the exact archive inventory and verifies an isolated production installation. Its offline installation requires a pnpm store already populated with the runtime dependencies, normally by the repository install above, and write access to that store.

### GitHub Actions

The [CI workflow](.github/workflows/ci.yml) is configured for pushes and pull requests on `macos-15`, with separate jobs for Node **24.17.0** and **26.0.0**. It reads the pnpm version from `package.json`, prints the tool versions, then runs `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test` and `pnpm test:package` in that order. The install populates the store before the package test installs offline. No separate build step is needed: `test` builds the CLI and packing builds it again through `prepack`.

Actions are pinned to full commit hashes. The workflow grants only `contents: read`, disables persisted checkout credentials and requires no configured secrets. It does not publish packages, releases or artifacts.

The tests have been verified locally on macOS with both Node versions. Both GitHub-hosted jobs also passed for commit `dc0cc61d887c37503eb98102bfb9fdb9bf20cf52` ([CI run](https://github.com/EnolMartin/EnvClarity/actions/runs/39848307131)), including types, functional tests and the local package check. This records that commit's result; subsequent changes need their own checks. Linux and Windows are not included.
