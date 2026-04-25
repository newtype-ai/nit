# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the TypeScript source for the `nit` library and CLI. `src/index.ts` is the public API entry point, `src/cli.ts` wires command-line behavior, and focused modules such as `identity.ts`, `objects.ts`, `remote.ts`, `tx.ts`, and `wallet.ts` hold protocol logic. `dist/` is generated build output and should not be edited directly. `tests/` currently contains the shell e2e flow in `tests/nit-e2e.sh`. `docs/` and root Markdown files hold product, protocol, and launch notes. `scripts/postinstall.js` supports package installation behavior.

## Build, Test, and Development Commands

Use Node.js 18+.

```bash
npm install        # install dependencies
npm run build      # build ESM output and .d.ts files with tsup
bash tests/nit-e2e.sh
```

`npm run build` is the main compile/type validation path and writes to `dist/`. The e2e test builds first, creates a temporary nit repository, and exercises init, branch, push, verify, and replay flows against `https://api.newtype-ai.org`, so run it only when network access and live-server side effects are acceptable.

## Coding Style & Naming Conventions

This project uses strict TypeScript, ESM imports, and Node built-ins where possible. Match the existing style: two-space indentation, semicolons, single quotes, named exports, and `.js` extensions in relative TypeScript imports that compile to ESM. Keep modules small and protocol-focused. Prefer descriptive function names such as `loadAgentId`, `signMessage`, or `findNitDir`; use kebab-case for CLI command names and file names.

## Testing Guidelines

There is no separate unit-test runner configured yet. For changes to core behavior, add focused tests under `tests/` or extend `tests/nit-e2e.sh` with clear PASS/FAIL checks. Always run `npm run build` before submitting. Run the e2e script for changes touching CLI commands, remote behavior, signatures, branch state, or serialization.

## Commit & Pull Request Guidelines

Recent history uses concise subjects such as `feat: add nit runtime command...`, release tags like `v0.6.7`, and short imperative fixes such as `send X-Nit-Client-Version header...`. Follow that pattern: keep the first line under roughly 72 characters, use `feat:` when adding user-visible functionality, and use version-only commits for releases.

Pull requests should describe the behavior change, list validation commands run, and call out any network-dependent testing. Include CLI output snippets or screenshots only when they clarify user-facing command behavior.

## Security & Configuration Tips

Never commit generated identities, private keys, tokens, `.nit/identity/agent.key`, or local logs. Treat remote URLs, RPC endpoints, and auth provider settings as user configuration unless a test explicitly creates disposable values.
