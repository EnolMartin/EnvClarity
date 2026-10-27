# Changelog

## Unreleased

- Add `envclarity viewer` to serve the bundled report viewer on a free loopback port, without a hosted website or Vite at runtime.
- Include production viewer assets, IBM Plex Mono fonts and their license in the local package. Reports remain in browser memory and are not uploaded.

## 0.1.0 — local CLI delivery preparation

The version remains private. These notes describe the implemented CLI; they do not announce a published release. Independent user validation is pending.

- Analyze direct `process.env` and `import.meta.env` references in TypeScript and JavaScript, including JSX/TSX, without executing the audited project. Report names and one-based source locations; exclude Vite built-ins only in their Vite context.
- Compare the selected example file (default `.env.example`) with an explicitly selected environment file. Distinguish undocumented, missing, empty and possibly unused variables, and report unresolved dynamic accesses.
- Provide text and deterministic JSON output with report schema version `1`. Exit `0` for completed audits without errors, `1` for completed audits with errors and `2` for invalid syntax or operational failures. Warnings alone exit `0`.
- Read within one project root with bounded traversal and file sizes, skipping symbolic links and common generated directories. Use a documented environment syntax subset, without expansion or implicit process environment merging.
- Exclude environment values, source snippets and original errors from reports and diagnostics. Names and paths remain visible; analysis covers direct references rather than complete runtime or deployment configuration.
- Support local checkout and archive installation with the `envclarity` executable and TypeScript runtime dependency. Keep the package inventory limited to the README, manifest and ten compiled runtime files.
- Check types, functional behavior and package installation on macOS with Node 24.17.0 and 26.0.0. Independent usability observations and Linux/Windows verification remain pending.

See the [README](README.md) for usage and limitations and the [delivery checklist](docs/delivery.md) for checked evidence and outstanding work.
