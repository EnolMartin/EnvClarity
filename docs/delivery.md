# Local CLI and viewer delivery checklist

Version: **0.1.0**. Status: prepared for owner review, with `private: true` retained. This checklist concerns local CLI and viewer delivery; publication requires a separate owner decision and authorization.

## Checked

- [x] Version, Node support range, pinned pnpm version, executable and runtime dependency match `package.json`. No version bump or dependency change is needed for this documentation preparation.
- [x] README and [usage guide](guide.md) commands match the argument parser and compiled CLI: explicit `--env`, defaults, selected paths, output channels and exit codes `0`/`1`/`2`.
- [x] The [CLI reference](reference.md) JSON contract and command details match the report types and reporter: schema `1`, completed versus failed results, issue shapes, coverage and safe operational codes. Names and paths remain visible; values and original errors are excluded.
- [x] [Change notes](../CHANGELOG.md) describe implemented behavior and coverage limits without claiming independent user validation.
- [x] [CI run 39848307131](https://github.com/EnolMartin/EnvClarity/actions/runs/39848307131) passed both jobs for commit `dc0cc61d887c37503eb98102bfb9fdb9bf20cf52`: Node 24.17.0 and 26.0.0 on `macos-15`, including installation, typecheck, functional tests and package verification. This is evidence for that commit, not for later documentation changes.
- [x] Local package verification after the README update checks the exact 20-file inventory (README, `package.json`, eleven runtime modules and seven viewer assets including fonts and licenses), private manifest, executable and isolated offline production installation. It checks help and exits `0`/`1`/`2` in text/JSON with synthetic data and value-leak canaries. The changelog and this checklist remain repository documentation outside the archive.
- [x] Markdown links and diff whitespace checked. The current change adds the local viewer command and its package assets. The new viewer command has separate local type, functional, package-installation and browser checks; it still needs CI after the owner commits and pushes it.

## Pending

- [ ] Owner review of this diff, notes and checklist. No commit, tag, release or publication is performed by this preparation.
- [ ] Independent sessions with three developers, including an owner-authorized external project, following the [validation protocol](validation.md). No sessions or usability conclusions are recorded; technical checks do not satisfy this requirement.
- [ ] Record actual sanitized observations, confirm or reproduce any defects with synthetic data, and review corrections separately.
- [ ] Run CI on this documentation commit after the owner chooses to commit and push it. The linked successful run predates these edits.
- [ ] Linux and Windows verification before claiming support on those platforms. The declared Node range does not imply every patch version has been tested.

The optional viewer is bundled for local use with `envclarity viewer`; it serves assets on loopback and receives no reports. Package and hosted-site publication remain separate decisions requiring owner authorization.
