# Usage guide

This guide takes you from a repository checkout to your first audit and its report. Commands use a terminal with a POSIX shell, such as bash or zsh. EnvClarity is not published on npm yet, so start from the repository.

## 1. Install and build

You need pnpm **11.8.0** and either Node **24.17.0 or later within 24.x**, or **26.0.0 or later within 26.x**. Other Node major versions are outside the supported range.

Check your installed versions:

```sh
node --version
pnpm --version
```

Then download and build EnvClarity:

```sh
git clone https://github.com/EnolMartin/EnvClarity.git
cd EnvClarity
pnpm install --frozen-lockfile
pnpm build
pnpm viewer:build
node dist/cli.js --help
```

If you already have the repository, run the commands from `pnpm install` onwards in its root directory. Installation may access the package registry; auditing does not need a network connection.

## 2. Select your project

Keep the terminal in the EnvClarity directory. Set the path to the project you want to check:

```sh
project_path="/path/to/your/project"
```

Replace the quoted path with the real location. Keeping the quotes lets paths contain spaces.

That project needs two files:

- `.env.example`, which lists the variable names you expect to configure. Its values are not compared.
- The environment file you want to check, such as `.env.local` or `.env.production`.

EnvClarity reads only the environment file you select. It does not merge other `.env` files or variables from your terminal. Keep real values in your existing local environment files; do not copy them into reports or documentation.

## 3. Run the audit

```sh
node dist/cli.js check "$project_path" --env .env.local
```

Change `.env.local` if your file has a different name. This path is relative to the selected project. If your example file has another name or location, select it too:

```sh
node dist/cli.js check "$project_path" --env .env.local --example config/example.env
```

Both selected files must stay inside the project root. They and their parent directories must not be symbolic links.

The terminal output gives a summary, findings and any recorded source locations. Lines and columns start at 1.

## 4. Read the findings

| Finding | What to check |
| --- | --- |
| `MISSING_VARIABLE` | A name in the example file is absent from the selected environment file. Check whether your application needs it or supplies a default. |
| `EMPTY_VARIABLE` | A documented name is present but empty. Decide whether that is intentional. |
| `UNDOCUMENTED_VARIABLE` | Code references a name missing from the example file. Consider documenting it. |
| `POSSIBLY_UNUSED_VARIABLE` | A documented name has no detected direct reference. Check indirect usage before removing it. |
| `DYNAMIC_REFERENCE` | An access does not use a resolved literal name. Review its source location. |

Only `MISSING_VARIABLE` has error severity. The other findings are warnings.

The command also returns an exit code, which scripts and CI can use:

| Code | Meaning |
| --- | --- |
| `0` | The audit finished without error-severity findings. Warnings may remain. |
| `1` | The audit finished and found at least one error-severity finding. Its report is still usable. |
| `2` | The command was invalid or the audit could not finish. |

A finished audit does not prove that the complete runtime or deployment configuration is correct.

## 5. Save a JSON report

Use `--format json` to save the result for the viewer. The following creates a new temporary directory, keeping the report outside both repositories:

```sh
report_dir=$(mktemp -d)
if node dist/cli.js check "$project_path" --env .env.local --format json > "$report_dir/report.json"; then
  report_status=0
else
  report_status=$?
fi
printf 'Exit code: %s\nReport: %s\n' "$report_status" "$report_dir/report.json"
```

Use the same `--env` and, if needed, `--example` as in your text audit. For a custom example file, add `--example config/example.env` before `--format json`.

Exit `1` is expected when missing variables are found; it does not make the JSON invalid. Exit `2` needs attention: an operational failure produces a short JSON result with a safe error code, while invalid command syntax leaves the file empty and prints a usage message in the terminal.

Keep the printed report path for the next step.

## 6. Open the report in the viewer

```sh
node dist/cli.js viewer
```

The terminal prints an address such as `http://127.0.0.1:<port>/`. Open the actual printed address in your browser, then:

1. Click **Choose JSON report** and select the file saved in step 5.
2. Read the error, warning and finding counts. Coverage explains what the audit can detect.
3. Scroll to **Explore findings**. Filter by severity or type, or search for a variable name or file path.
4. Expand **View locations** to see where a reference was found.
5. Use **Reset filters** to see all findings again, or **Clear report** to remove the current result from the page.

Filtering does not change the report totals. A failed audit gets its own explanation instead of a summary. A report with no findings still shows its coverage limits.

The viewer starts on a free local port and keeps running in that terminal. Stop it with Ctrl+C. Reloading the page starts empty. Clearing or reloading does not delete the JSON file from disk.

Reports are processed in browser memory. The local server serves the viewer and its fonts; it does not receive the report. Reports can still contain sensitive names and paths, so review them before sharing or committing them. Delete temporary reports when you no longer need them.

## 7. Optional: install a local package

You can also use EnvClarity without keeping its source checkout as your working directory. From the EnvClarity repository, create an archive:

```sh
package_dir=$(mktemp -d)
pnpm pack --out "$package_dir/envclarity-0.1.0.tgz"
printf 'Package: %s\n' "$package_dir/envclarity-0.1.0.tgz"
```

Packing builds both the CLI and viewer. Copy the printed archive path, then open a terminal in the project where you want to install it:

```sh
cd "/path/to/your/project"
pnpm add --save-dev --ignore-scripts "/path/to/envclarity-0.1.0.tgz"
pnpm exec envclarity check . --env .env.local
pnpm exec envclarity viewer
```

Replace both paths before running these commands. This adds EnvClarity as a development dependency of that project. The package includes the built viewer, fonts and licenses; using it does not require Vite. The last command keeps the terminal open until Ctrl+C.

If you copy a report-generation command from step 5, replace `node dist/cli.js` with `pnpm exec envclarity` and use `.` as the project root.

## If something goes wrong

| Result | Next step |
| --- | --- |
| `INVALID_INPUT` | Check the project root and selected paths. Keep selected files inside the root and avoid symbolic links. |
| `READ_ERROR` | Check that the root and both selected files exist and can be read. |
| `FORMAT_ERROR` | Check the assignment syntax in the environment and example files. See the [file format](reference.md#environment-file-syntax). |
| `LIMIT_EXCEEDED` | Check the [scanning limits](reference.md#exclusions-limits-and-data-handling). The audit stops rather than returning a partial report. |
| The viewer rejects the file | Generate a new JSON result with the same EnvClarity version. Do not select a text report, source file or environment file. Viewer files must fit its [limits](viewer.md#limits). |
| The viewer cannot start | From a checkout, run `pnpm viewer:build`. For an installed package, rebuild the archive and reinstall it. |

For all command options, JSON fields and parser details, see the [CLI reference](reference.md).
