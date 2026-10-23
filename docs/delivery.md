# Local CLI delivery checklist

Version: **0.1.0**. Status: prepared for owner review, with `private: true` retained. This checklist concerns local CLI delivery; publication requires a separate owner decision and authorization.

## Checked

- [x] Version, Node support range, pinned pnpm version, executable and runtime dependency match `package.json`. No version bump or dependency change is needed for this documentation preparation.
- [x] README usage and help match the argument parser and compiled CLI: explicit `--env`, defaults, selected paths, output channels and exit codes `0`/`1`/`2`.
- [x] README JSON contract and examples match the report types and reporter: schema `1`, completed versus failed results, issue shapes, coverage and safe operational codes. Names and paths remain visible; values and original errors are excluded.
- [x] [Change notes](../CHANGELOG.md) describe implemented behavior and coverage limits without claiming independent user validation.
- [x] [CI run 39848307131](https://github.com/EnolMartin/EnvClarity/actions/runs/39848307131) passed both jobs for commit `dc0cc61d887c37503eb98102bfb9fdb9bf20cf52`: Node 24.17.0 and 26.0.0 on `macos-15`, including installation, typecheck, functional tests and package verification. This is evidence for that commit, not for later documentation changes.
- [x] Local package verification after the README update checks the exact 12-file inventory (README, `package.json`, ten runtime files), private manifest, executable and isolated offline production installation. It checks help and exits `0`/`1`/`2` in text/JSON with synthetic data and value-leak canaries. The changelog and this checklist remain repository documentation outside the archive.
- [x] Markdown links and diff whitespace checked. No code changed; the functional suite is not repeated for documentation alone. Existing code, tests, manifest, lockfile and build settings match the previously verified copies.

## Pending

- [ ] Owner review of this diff, notes and checklist. No commit, tag, release or publication is performed by this preparation.
- [ ] Independent sessions with three developers, including an owner-authorized external project, following the [validation protocol](validation.md). No sessions or usability conclusions are recorded; technical checks do not satisfy this requirement.
- [ ] Record actual sanitized observations, confirm or reproduce any defects with synthetic data, and review corrections separately.
- [ ] Run CI on this documentation commit after the owner chooses to commit and push it. The linked successful run predates these edits.
- [ ] Linux and Windows verification before claiming support on those platforms. The declared Node range does not imply every patch version has been tested.

No React viewer work or npm publication preparation is included. Any future distribution change requires its own review and authorization.
