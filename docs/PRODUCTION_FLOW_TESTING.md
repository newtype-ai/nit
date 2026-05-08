# Production Flow Testing

This repository includes black-box flow harnesses for validating that agent
identities stay workspace-local and do not inherit from parent folders, sibling
folders, CLI install locations, or app verification state.

## Commands

```bash
npm run test:runtime
```

Primary acceptance test. Builds `nit`, packs it with `npm pack`, installs that
package artifact into a temp toolchain, creates a complex real-world folder
tree with no pre-existing `.nit` directories, then drives the installed CLI
through subprocesses from each runtime folder.

```bash
npm run test:init-count
```

Builds with a deterministic baked install count, packs and installs the package,
runs `nit init`, and asserts the installed CLI prints the user-facing count line:
`welcome the ~12,345th nit!`.

```bash
npm run test:flow
```

Runs both package-level user-flow gates: init-count smoke plus runtime-folder
acceptance.

```bash
npm run test:newtype
```

Builds `nit`, packs and installs the package artifact, bundles the actual
`../newtype-ai/worker/src/index.ts` worker, runs it with in-memory KV/D1
bindings, then verifies CLI push/pull/login plus `nit-sdk` card verification
against that worker.

```bash
npm run test:flow:scale
```

Secondary stress test. Repeats isolated runtime creation at 1,000-agent scale
against the same local Newtype-compatible verifier.

For a maximal local run:

```bash
npm run build
node tests/harness/identity-flow-harness.mjs --agents 1000 --full-agents all --concurrency 16
```

Use `--keep` to preserve generated workspaces for debugging.

## What It Covers

- Package install from the actual packed npm artifact before any `nit init`.
- Complex runtime folder layouts: Claude Code, Codex, OpenClaw, Cursor,
  Windsurf, generic folders, nested subagents, paths with spaces, path-marker
  framework directories, and one runtime-local npm install.
- Parent `.nit/` is never inherited by child runtimes.
- Sibling runtimes produce unique `agent_id`, public keys, wallets, and hosted
  card URLs.
- Nested folders without their own `.nit/` fail closed.
- Real CLI flow: `init`, `status`, `commit`, `branch`, `checkout`, `push`,
  `remote branches`, `remote check`, `pull`, `sign`, `sign --login`,
  `verify-login`, `auth`, `runtime`, `skill`, `rpc`, `wallet`, `sign-tx`,
  `broadcast`, `doctor`, `show`, `log`, `diff`, and `reset`.
- Real signed remote protocol over HTTP: TOFU main registration, non-main branch
  push, signed branch listing, signed branch deletion, challenge card reads, and
  read-token card reads.
- nit-sdk app flow: `verifyAgent()` plus `fetchAgentCard()`.
- Actual `newtype-ai` worker flow: branch storage, D1 identity registration,
  challenge card reads, read-token card reads, login signatures, replay
  rejection, tampered-domain rejection, and signed branch deletion.
- Newtype-style identity signals: machine grouping, IP grouping, runtime,
  hostname, platform, and workspace hash.

## Prerequisites

The harness imports `../nit-sdk/dist/index.js`, and `test:newtype` bundles
`../newtype-ai/worker/src/index.ts` using the worker repo's dependencies. If
either build output is missing, build them first:

```bash
cd ../nit-sdk
npm run build
cd ../newtype-ai/worker
npm install
```
