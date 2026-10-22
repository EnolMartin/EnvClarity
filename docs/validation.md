# CLI validation

Preparation is complete; validation is pending. No sessions have been conducted
as part of this preparation, and no owner authorization, results or conclusions
are recorded. The slots below are planned sessions, not recruited participants.

## Scope and consent

Run separate sessions with three developers. At least one session must use a
project owned by someone outside EnvClarity, with that owner's explicit permission
to audit it and record sanitized observations. Prefer the owner running the CLI
locally on their own machine. Record only whether permission was confirmed and
its scope; keep personal identities and consent correspondence out of this file.
Without permission, that session stays pending.

Install EnvClarity separately from the audited project. Do not run that project's
scripts, import its configuration, install its dependencies or upload its files.
The audit is read-only; any subsequent configuration changes belong to the owner.
This preparation includes no outreach or file transfers.

## Independent first attempt

Give each developer the [README](../README.md) and these tasks, without a walkthrough
or live troubleshooting. Record any blocker before offering help; mark later
assisted work separately so it does not count as an independent success.

1. Follow the README requirements and installation instructions. Use its repository
   installation route or generate and install the local archive on the same
   machine. Record the EnvClarity commit/version, Node/pnpm versions, OS and route.
2. Run the README's synthetic demo, then audit one suitable local project. Select
   the root, example file and environment file explicitly; selected files must
   remain inside the root. Use the README's CLI syntax and text output first.
   Do not submit the command with real paths or the resulting report.
3. Explain in your own words whether the audit completed, what the exit code
   means, which findings deserve action, and what you would review or change and
   why. Distinguish missing configuration, warnings and coverage limitations.
   Use the README freely; do not supply an answer key during the attempt.
4. Check a finding against the project locally. The owner may choose a safe
   correction and rerun the same audit, or use a separate synthetic copy to verify
   the proposed correction. Never remove a variable just because it is reported
   as possibly unused. If nothing actionable appears, record that observation;
   do not invent a useful finding or treat a clean audit as complete coverage.
5. After the first attempt, collect the observations below. Record whether each
   task was completed independently, blocked, assisted later or not attempted.

## Session record

Use only anonymous slot IDs; do not keep an identity mapping here. Never record
personal names, organization/repository identifiers, secrets or environment values,
private paths, project code, screenshots or complete reports from another project.
Variable names and source locations can also be sensitive: replace them with
invented names and generic descriptions. Retain only the minimum sanitized notes.

| Slot | Planned project | Authorization | Session / observations |
| --- | --- | --- | --- |
| V1 | External project; preferably run by its owner | Pending | Pending / none |
| V2 | Developer's own or owner-authorized project | Pending | Pending / none |
| V3 | Developer's own or owner-authorized project | Pending | Pending / none |

For each completed attempt, record:

- **Setup:** commit/version, tool versions, OS, installation route, approximate
  time, installation problems and the step that blocked progress. Paraphrase errors
  safely; include neither private paths nor raw logs.
- **Understanding:** the developer's explanation of completion, exit code, issue
  severity and next action; confusing wording or locations; assistance needed.
- **Useful findings:** issue codes, why a finding helped, the proposed correction,
  whether it was checked locally and what a rerun changed. Separate a reported
  benefit from a verified outcome; no real variable names or report excerpts.
- **False positives:** suspected versus locally confirmed, expected versus observed
  behavior, and why the finding may be misleading. Do not assume every warning
  is an error or every indirect reference is supported.
- **Limitations:** missed patterns, parser compatibility, traversal/resource limits,
  platform problems or operational failures. Distinguish documented limits from
  suspected defects and unknown causes.
- **Outcome:** task status, independent versus assisted progress, unresolved
  questions and links to separate sanitized defect records, if any.

## Defects and follow-up

Record each defect separately with its own ID and session reference, affected
version, expected/observed behavior and impact. Build a minimal, standalone
synthetic reproduction with invented names and values: list its files, setup,
CLI command and expected/actual exit code or safe output. Do not copy or attach
external project code, configuration or reports. If reproduction is not yet
possible, label it unconfirmed and pending; do not claim verification.

Each substantial correction needs a separate follow-up with that synthetic
fixture and its own review. This documentation step does not implement fixes.
No defects have been recorded from validation.

## Completion criteria

Keep all sessions pending until real observations arrive. Validation requires
three actual developers and at least one owner-authorized external project.
Record whether another developer installed, audited and understood a useful next
action without initial help. If that did not happen, state the blocker and keep
that success criterion unmet. Findings support a limited claim of usefulness,
not comprehensive coverage or willingness to pay. Preparation alone does not
complete validation or authorize a release or further development.
