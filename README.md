# EnvClarity

EnvClarity checks environment variables in TypeScript, Node and Vite projects. It compares the names in an example file with a selected environment file and the references found in your code.

Use it from the terminal, or open its JSON report in the local viewer. The current version is **0.1.0** and is not published on npm yet.

## Requirements

- Node **24.17.0+ within 24.x**, or **26.0.0+ within 26.x**.
- pnpm **11.8.0**.

## Install

```sh
git clone https://github.com/EnolMartin/EnvClarity.git
cd EnvClarity
pnpm install --frozen-lockfile
pnpm build
pnpm viewer:build
```

## Check a project

From the EnvClarity directory:

```sh
node dist/cli.js check "../my-app" --env .env.local
```

Replace `../my-app` with your project path. The project needs an `.env.example` file and the environment file you select with `--env`. Both are read from that project, not from the EnvClarity directory.

The command reports missing, empty or undocumented variables, possible unused variables and accesses it cannot resolve. Warnings are suggestions to review; defaults and optional configuration can affect what your application needs.

## Open the viewer

```sh
node dist/cli.js viewer
```

Open the address printed in the terminal and choose a JSON report. The [usage guide](https://github.com/EnolMartin/EnvClarity/blob/main/docs/guide.md) explains how to generate one. Stop the viewer with Ctrl+C.

## Before using the results

EnvClarity detects direct `process.env` and `import.meta.env` references. It does not resolve aliases, destructuring or wrapper functions, and it cannot tell which variables your application requires at runtime.

Audits run locally without executing or changing the inspected project. Reports omit environment values, but variable names and file paths remain visible. The viewer keeps the selected report in browser memory without uploading it.

The commands have been checked on macOS with Node 24.17.0 and 26.0.0. Other operating systems and independent user testing are still pending.

## Development

```sh
pnpm typecheck
pnpm test
pnpm test:package
pnpm exec playwright install chromium --only-shell
pnpm viewer:test
```

The package test needs the dependencies installed first. GitHub Actions runs the CLI, package and viewer checks on pushes and pull requests.

For more detail, see the [usage guide](https://github.com/EnolMartin/EnvClarity/blob/main/docs/guide.md), [CLI reference](https://github.com/EnolMartin/EnvClarity/blob/main/docs/reference.md) and [viewer notes](https://github.com/EnolMartin/EnvClarity/blob/main/docs/viewer.md).
