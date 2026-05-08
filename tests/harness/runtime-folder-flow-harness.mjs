#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LocalNewtypeHarness } from './identity-flow-harness.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const defaultSdkPath = resolve(repoRoot, '..', 'nit-sdk', 'dist', 'index.js');

function parseArgs(argv) {
  const opts = {
    keep: false,
    sdkPath: defaultSdkPath,
    tmp: '',
    commandTimeoutMs: 30_000,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (!argv[i + 1]) throw new Error(`Missing value for ${arg}`);
      return argv[++i];
    };
    if (arg === '--sdk-path') opts.sdkPath = resolve(next());
    else if (arg === '--tmp') opts.tmp = resolve(next());
    else if (arg === '--timeout-ms') opts.commandTimeoutMs = positiveInt(next(), arg);
    else if (arg === '--keep') opts.keep = true;
    else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

function positiveInt(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function printUsage() {
  console.log(`Usage: node tests/harness/runtime-folder-flow-harness.mjs [options]

Options:
  --sdk-path <path>   Path to @newtype-ai/nit-sdk dist/index.js
  --tmp <path>        Workspace root. Default: mktemp under OS tmp
  --timeout-ms <n>    Per-command timeout. Default: 30000
  --keep              Keep generated folders after the run`);
}

function mkdirp(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function writeJson(path, value) {
  write(path, JSON.stringify(value, null, 2) + '\n');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function workspaceHashFor(projectDir) {
  return sha256(join(realpathSync(projectDir), '.nit'));
}

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function runCommand(file, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      rejectRun(new Error(`Command timed out: ${file} ${args.join(' ')}`));
    }, options.timeoutMs ?? 30_000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectRun(err);
    });
    child.on('close', (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRun({ status, stdout, stderr });
    });
    child.stdin.end(options.input ?? '');
  });
}

function expectOk(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label} failed with ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result;
}

function expectFail(result, pattern, label) {
  const output = stripAnsi(`${result.stdout}\n${result.stderr}`);
  if (result.status === 0 || !pattern.test(output)) {
    throw new Error(`${label} did not fail as expected\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result;
}

async function installPackedNit(root, opts) {
  const packDir = mkdirp(join(root, 'packed'));
  const installRoot = mkdirp(join(root, 'installed-nit'));
  const npmCache = mkdirp(join(root, 'npm-cache'));
  const env = {
    ...process.env,
    NPM_CONFIG_CACHE: npmCache,
    npm_config_cache: npmCache,
  };

  const pack = expectOk(
    await runCommand('npm', ['pack', '--json', '--pack-destination', packDir], {
      cwd: repoRoot,
      env,
      timeoutMs: opts.commandTimeoutMs,
    }),
    'npm pack nit',
  );
  const packed = JSON.parse(pack.stdout);
  const tarball = join(packDir, packed[0].filename);

  expectOk(
    await runCommand('npm', ['install', '--prefix', installRoot, tarball], {
      cwd: root,
      env,
      timeoutMs: opts.commandTimeoutMs,
    }),
    'install packed nit CLI',
  );

  const bin = join(installRoot, 'node_modules', '.bin', 'nit');
  assert.equal(existsSync(bin), true, 'installed nit bin is missing');
  return { tarball, installRoot, bin, npmCache };
}

async function installNitIntoRuntime(projectDir, tarball, opts, env) {
  expectOk(
    await runCommand('npm', ['install', '--prefix', projectDir, tarball], {
      cwd: projectDir,
      env,
      timeoutMs: opts.commandTimeoutMs,
    }),
    `local install nit in ${projectDir}`,
  );
  const bin = join(projectDir, 'node_modules', '.bin', 'nit');
  assert.equal(existsSync(bin), true, 'runtime-local nit bin is missing');
  return bin;
}

function runNit(bin, cwd, args, opts, env) {
  return runCommand(bin, args, {
    cwd,
    env,
    timeoutMs: opts.commandTimeoutMs,
  });
}

function makeSkill(dir, id, name) {
  write(join(dir, id, 'SKILL.md'), [
    '---',
    `name: ${name}`,
    `description: ${name} runtime skill`,
    '---',
    '',
    `# ${name}`,
    '',
  ].join('\n'));
}

function createRuntimeTree(root) {
  const org = mkdirp(join(root, 'acme-monorepo'));
  const homeLike = mkdirp(join(root, 'home-like'));
  const lab = mkdirp(join(root, 'lab workspaces', '2026'));

  makeSkill(join(org, '.claude', 'skills'), 'global-claude-only', 'Global Claude Only');
  makeSkill(join(homeLike, '.codex', 'skills'), 'global-codex-only', 'Global Codex Only');
  makeSkill(join(org, '.openclaw', 'workspace', 'skills'), 'openclaw-deploy', 'OpenClaw Deploy');

  const scenarios = [
    {
      id: 'claude-app',
      framework: 'claude',
      projectDir: join(org, 'apps', 'writer-agent'),
      markerDir: '.claude',
      expectedSkillsDir: (p) => join(p, '.claude', 'skills'),
      seedSkill: (p) => makeSkill(join(p, '.claude', 'skills'), 'draft-copy', 'Draft Copy'),
    },
    {
      id: 'codex-subagent-inside-claude-app',
      framework: 'codex',
      projectDir: join(org, 'apps', 'writer-agent', 'subagents', 'reviewer'),
      markerDir: '.codex',
      expectedSkillsDir: (p) => join(p, '.codex', 'skills'),
      seedSkill: (p) => makeSkill(join(p, '.codex', 'skills'), 'review-patch', 'Review Patch'),
      parentScenario: 'claude-app',
    },
    {
      id: 'openclaw-path-marker',
      framework: 'openclaw',
      projectDir: join(org, '.openclaw', 'workspace', 'teams', 'deploy-agent'),
      expectedSkillsDir: () => join(org, '.openclaw', 'workspace', 'skills'),
      seedSkill: null,
    },
    {
      id: 'codex-path-marker',
      framework: 'codex',
      projectDir: join(homeLike, '.codex', 'projects', 'market-agent'),
      expectedSkillsDir: () => join(homeLike, '.codex', 'skills'),
      seedSkill: null,
    },
    {
      id: 'cursor-package',
      framework: 'cursor',
      projectDir: join(org, 'packages', 'analysis-agent'),
      markerDir: '.cursor',
      expectedSkillsDir: (p) => join(p, '.cursor', 'skills'),
      seedSkill: (p) => makeSkill(join(p, '.cursor', 'skills'), 'analyze-data', 'Analyze Data'),
    },
    {
      id: 'windsurf-space-path',
      framework: 'windsurf',
      projectDir: join(lab, 'windsurf agent'),
      markerDir: '.windsurf',
      expectedSkillsDir: (p) => join(p, '.windsurf', 'skills'),
      seedSkill: (p) => makeSkill(join(p, '.windsurf', 'skills'), 'write-report', 'Write Report'),
    },
    {
      id: 'plain-local-install',
      framework: 'generic',
      projectDir: join(root, 'standalone', 'plain-agent'),
      expectedSkillsDir: (p) => join(p, '.agents', 'skills'),
      seedSkill: null,
      localInstall: true,
    },
  ];

  for (const scenario of scenarios) {
    mkdirp(scenario.projectDir);
    if (scenario.markerDir) mkdirp(join(scenario.projectDir, scenario.markerDir));
    scenario.seedSkill?.(scenario.projectDir);
    assert.equal(existsSync(join(scenario.projectDir, '.nit')), false, `${scenario.id} should start without .nit`);
  }

  return { org, scenarios };
}

async function exerciseRuntime(scenario, context) {
  const { opts, env, installedBin, server, sdk, tarball, parentAgentId, knownAgentIds } = context;
  const bin = scenario.localInstall
    ? await installNitIntoRuntime(scenario.projectDir, tarball, opts, env)
    : installedBin;
  const domain = `${scenario.id}.apps.test`;

  expectFail(
    await runNit(bin, scenario.projectDir, ['status'], opts, env),
    /Not a nit workspace/,
    `${scenario.id} status before init`,
  );

  const nestedDir = mkdirp(join(scenario.projectDir, 'tmp', 'nested-runtime'));
  expectFail(
    await runNit(bin, nestedDir, ['status'], opts, env),
    /Not a nit workspace/,
    `${scenario.id} nested status before init`,
  );

  expectOk(await runNit(bin, scenario.projectDir, ['init', '--skill-source', 'none'], opts, env), `${scenario.id} init`);
  assert.equal(existsSync(join(scenario.projectDir, '.nit')), true, `${scenario.id} did not create local .nit`);
  assert.equal(existsSync(join(nestedDir, '.nit')), false, `${scenario.id} nested dir should still have no .nit`);
  expectFail(
    await runNit(bin, nestedDir, ['status'], opts, env),
    /Not a nit workspace/,
    `${scenario.id} nested status after parent init`,
  );

  const status = expectOk(await runNit(bin, scenario.projectDir, ['status'], opts, env), `${scenario.id} status`);
  const agentId = readFileSync(join(scenario.projectDir, '.nit', 'identity', 'agent-id'), 'utf8').trim();
  assert.match(status.stdout, new RegExp(agentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.notEqual(agentId, parentAgentId, `${scenario.id} inherited parent identity`);
  for (const [otherId, otherScenario] of knownAgentIds) {
    assert.notEqual(agentId, otherId, `${scenario.id} shares identity with ${otherScenario}`);
  }

  const skillDir = expectOk(await runNit(bin, scenario.projectDir, ['skill', 'dir'], opts, env), `${scenario.id} skill dir`);
  assert.match(
    stripAnsi(skillDir.stdout),
    new RegExp(scenario.expectedSkillsDir(realpathSync(scenario.projectDir)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );

  expectOk(await runNit(bin, scenario.projectDir, ['remote', 'set-url', 'origin', server.origin], opts, env), `${scenario.id} remote set-url`);
  expectOk(await runNit(bin, scenario.projectDir, ['runtime', 'set', scenario.framework, `model-${scenario.id}`, 'runtime-folder-harness'], opts, env), `${scenario.id} runtime set`);

  const cardPath = join(scenario.projectDir, 'agent-card.json');
  const card = readJson(cardPath);
  card.name = `runtime-${scenario.id}`;
  card.description = `Runtime folder fixture for ${scenario.framework}`;
  writeJson(cardPath, card);
  expectOk(await runNit(bin, scenario.projectDir, ['commit', '-m', 'runtime identity'], opts, env), `${scenario.id} commit main`);

  expectOk(await runNit(bin, scenario.projectDir, ['branch', domain], opts, env), `${scenario.id} branch`);
  expectOk(await runNit(bin, scenario.projectDir, ['checkout', domain], opts, env), `${scenario.id} checkout`);
  const branchCard = readJson(cardPath);
  branchCard.description = `Domain card for ${domain}`;
  writeJson(cardPath, branchCard);
  expectOk(
    await runNit(bin, scenario.projectDir, ['auth', 'set', domain, '--provider', 'github', '--account', `${scenario.id}@example.test`], opts, env),
    `${scenario.id} auth set`,
  );
  const authedCard = readJson(cardPath);
  authedCard.description = `Domain card for ${domain} with auth`;
  writeJson(cardPath, authedCard);
  expectOk(await runNit(bin, scenario.projectDir, ['commit', '-m', 'domain identity'], opts, env), `${scenario.id} commit domain`);

  expectOk(await runNit(bin, scenario.projectDir, ['push', '--all'], opts, env), `${scenario.id} push all`);
  const branches = expectOk(await runNit(bin, scenario.projectDir, ['remote', 'branches'], opts, env), `${scenario.id} remote branches`);
  assert.match(branches.stdout, /main/);
  assert.match(branches.stdout, new RegExp(domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  server.defaultReadAgentId = agentId;
  expectOk(await runNit(bin, scenario.projectDir, ['pull', '--all'], opts, env), `${scenario.id} pull all`);

  const login = expectOk(await runNit(bin, scenario.projectDir, ['sign', '--login', domain], opts, env), `${scenario.id} login`);
  const payload = JSON.parse(login.stdout);
  writeJson(join(scenario.projectDir, 'login.json'), payload);
  expectOk(
    await runNit(bin, scenario.projectDir, ['verify-login', 'login.json', '--card', 'agent-card.json', '--domain', domain], opts, env),
    `${scenario.id} local verify-login`,
  );

  const verify = await sdk.verifyAgent(payload, {
    apiUrl: server.origin,
    policy: {
      max_identities_per_ip: 100,
      max_identities_per_machine: 100,
    },
  });
  assert.equal(verify.verified, true, `${scenario.id} sdk verify failed: ${JSON.stringify(verify)}`);
  assert.equal(verify.agent_id, agentId);
  assert.equal(verify.identity.workspace_hash, workspaceHashFor(scenario.projectDir));
  assert.equal(verify.identity.runtime_provider, scenario.framework);
  assert.equal(verify.identity.runtime_harness, 'runtime-folder-harness');

  const fetched = await sdk.fetchAgentCard(agentId, domain, verify.readToken, {
    baseUrl: `${server.origin}/agent/${agentId}`,
  });
  assert.equal(fetched.description, `Domain card for ${domain} with auth`);

  knownAgentIds.set(agentId, scenario.id);
  return {
    id: scenario.id,
    framework: scenario.framework,
    projectDir: scenario.projectDir,
    agentId,
    publicKey: readJson(cardPath).publicKey,
    wallet: readJson(cardPath).wallet,
    domain,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(opts.sdkPath)) {
    throw new Error(`Missing nit-sdk build at ${opts.sdkPath}. Run npm run build in ../nit-sdk first.`);
  }

  const root = opts.tmp || mkdtempSync(join(tmpdir(), 'nit-runtime-flow-'));
  mkdirp(root);
  const fakeHome = mkdirp(join(root, 'home'));
  makeSkill(join(fakeHome, '.claude', 'skills'), 'global-home-only', 'Global Home Only');
  const env = {
    ...process.env,
    HOME: fakeHome,
    NIT_NO_AUTO_UPDATE: '1',
    CI: 'true',
  };

  const nitApi = await import(pathToFileURL(join(repoRoot, 'dist', 'index.js')).href);
  const sdk = await import(pathToFileURL(opts.sdkPath).href);
  const install = await installPackedNit(root, opts);
  env.NPM_CONFIG_CACHE = install.npmCache;
  env.npm_config_cache = install.npmCache;

  const { org, scenarios } = createRuntimeTree(root);
  const server = new LocalNewtypeHarness(nitApi);
  await server.listen();

  let passed = false;
  console.log(`runtime harness root: ${root}`);
  console.log(`installed nit bin: ${install.bin}`);
  console.log(`local newtype-compatible server: ${server.origin}`);
  console.log(`runtime folders: ${scenarios.length}`);

  try {
    expectOk(await runNit(install.bin, root, ['--version'], opts, env), 'installed nit --version');

    expectOk(await runNit(install.bin, org, ['init', '--skill-source', 'none'], opts, env), 'parent monorepo init');
    const parentAgentId = readFileSync(join(org, '.nit', 'identity', 'agent-id'), 'utf8').trim();
    const knownAgentIds = new Map();
    const results = [];

    for (const scenario of scenarios) {
      const result = await exerciseRuntime(scenario, {
        opts,
        env,
        installedBin: install.bin,
        tarball: install.tarball,
        server,
        sdk,
        parentAgentId,
        knownAgentIds,
      });
      results.push(result);
    }

    const ids = new Set(results.map((r) => r.agentId));
    const publicKeys = new Set(results.map((r) => r.publicKey));
    const solana = new Set(results.map((r) => r.wallet?.solana));
    const evm = new Set(results.map((r) => r.wallet?.evm));
    assert.equal(ids.size, scenarios.length);
    assert.equal(publicKeys.size, scenarios.length);
    assert.equal(solana.size, scenarios.length);
    assert.equal(evm.size, scenarios.length);
    assert.equal(server.identities.size, scenarios.length);

    const parentAfter = expectOk(await runNit(install.bin, org, ['status'], opts, env), 'parent monorepo status after runtime flows');
    assert.match(parentAfter.stdout, new RegExp(parentAgentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(ids.has(parentAgentId), false);

    passed = true;
    console.log('passed runtime folder isolation flow');
    for (const result of results) {
      console.log(`  ${result.id}: ${relative(root, result.projectDir)} -> ${result.agentId}`);
    }
    console.log(`registered identities: ${server.identities.size}`);
    console.log(`pushed branches: ${server.branches.size}`);
    console.log(`workspace root: ${opts.keep ? root : '(cleaned)'}`);
  } finally {
    await server.close();
    if (passed && !opts.keep) {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
