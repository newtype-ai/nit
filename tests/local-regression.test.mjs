import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = join(repoRoot, 'dist', 'cli.js');
const env = { ...process.env, NIT_NO_AUTO_UPDATE: '1', CI: 'true' };
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function workspace(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  return dir;
}

function runNit(cwd, args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    env,
    encoding: 'utf8',
  });
}

function initWorkspace(cwd) {
  const result = runNit(cwd, ['init', '--skill-source', 'embedded']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

async function updateApi() {
  return import(pathToFileURL(join(repoRoot, 'dist', 'update-check.js')).href);
}

test('auto update policy supports off notify and install modes', async () => {
  const api = await updateApi();

  let checked = false;
  await api.autoUpdate({
    env: { NIT_AUTO_UPDATE: 'off' },
    check: async () => {
      checked = true;
      return { current: '0.6.15', latest: '9.9.9' };
    },
  });
  assert.equal(checked, false);

  const calls = [];
  let notifyStderr = '';
  await api.autoUpdate({
    env: { NIT_AUTO_UPDATE: 'notify' },
    check: async () => ({ current: '0.6.15', latest: '9.9.9' }),
    execFile: (file, args, options) => {
      calls.push({ file, args, options });
    },
    stderr: { write: (message) => { notifyStderr += message; } },
  });
  assert.equal(calls.length, 0);
  assert.match(notifyStderr, /update available 0\.6\.15 -> 9\.9\.9/);
  assert.match(notifyStderr, /npm install -g @newtype-ai\/nit@9\.9\.9/);

  let installStderr = '';
  await api.autoUpdate({
    env: { NIT_AUTO_UPDATE: 'install' },
    check: async () => ({ current: '0.6.15', latest: '9.9.9' }),
    execFile: (file, args, options) => {
      calls.push({ file, args, options });
    },
    stderr: { write: (message) => { installStderr += message; } },
    reexec: false,
  });
  assert.deepEqual(calls.map((call) => [call.file, call.args]), [
    ['npm', ['install', '-g', '@newtype-ai/nit@9.9.9']],
  ]);
  assert.match(installStderr, /updating 0\.6\.15 -> 9\.9\.9/);
});

test('auto update keeps legacy opt out and rejects invalid policy', async () => {
  const api = await updateApi();

  assert.equal(api.resolveAutoUpdateMode({ NIT_NO_AUTO_UPDATE: '1' }).mode, 'off');

  let stderr = '';
  let checked = false;
  await api.autoUpdate({
    env: { NIT_AUTO_UPDATE: 'sometimes' },
    check: async () => {
      checked = true;
      return { current: '0.6.15', latest: '9.9.9' };
    },
    stderr: { write: (message) => { stderr += message; } },
  });
  assert.equal(checked, false);
  assert.match(stderr, /invalid NIT_AUTO_UPDATE/);
});

test('update check caches only valid semver versions', async () => {
  const api = await updateApi();
  const cwd = workspace('nit-update-cache-');
  const cachePath = join(cwd, 'cache.json');
  let fetchCount = 0;

  const first = await api.checkForUpdate({
    cachePath,
    now: () => 1_000,
    fetchImpl: async () => {
      fetchCount++;
      return new Response(JSON.stringify({ version: '9.9.9' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  assert.equal(fetchCount, 1);
  assert.equal(first?.latest, '9.9.9');

  const cached = await api.checkForUpdate({
    cachePath,
    now: () => 2_000,
    fetchImpl: async () => {
      fetchCount++;
      return new Response(JSON.stringify({ version: '9.9.10' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  assert.equal(fetchCount, 1);
  assert.equal(cached?.latest, '9.9.9');

  const invalid = await api.checkForUpdate({
    force: true,
    cachePath,
    now: () => 3_000,
    fetchImpl: async () => new Response(JSON.stringify({ version: 'bad latest' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });

  assert.equal(invalid, null);
  assert.match(readFileSync(cachePath, 'utf8'), /9\.9\.9/);

  const oversized = await api.checkForUpdate({
    force: true,
    cachePath,
    now: () => 4_000,
    fetchImpl: async () => new Response('x', {
      status: 200,
      headers: { 'content-length': String(20_000) },
    }),
  });

  assert.equal(oversized, null);
  assert.match(readFileSync(cachePath, 'utf8'), /9\.9\.9/);
});

test('branch delete rejects traversal and preserves config', () => {
  const cwd = workspace('nit-branch-');
  initWorkspace(cwd);

  const configPath = join(cwd, '.nit', 'config');
  assert.equal(existsSync(configPath), true);

  const result = runNit(cwd, ['branch', '-d', '../../config']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsafe characters|invalid/i);
  assert.equal(existsSync(configPath), true);
});

test('remote set-url rejects non-http URLs', () => {
  const cwd = workspace('nit-remote-');
  initWorkspace(cwd);

  const result = runNit(cwd, ['remote', 'set-url', 'origin', 'file:///tmp/not-http']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /http:\/\/ or https:\/\//);
  assert.equal(readFileSync(join(cwd, '.nit', 'config'), 'utf8').includes('file:///tmp/not-http'), false);
});

test('remote add rejects unsafe names before writing config', () => {
  const cwd = workspace('nit-remote-add-');
  initWorkspace(cwd);

  const configPath = join(cwd, '.nit', 'config');
  const before = readFileSync(configPath, 'utf8');
  const result = runNit(cwd, ['remote', 'add', '../../config', 'https://example.com']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsafe characters|invalid/i);
  assert.equal(readFileSync(configPath, 'utf8'), before);
});

test('rpc set-url rejects unsafe chain names and non-http URLs', () => {
  const cwd = workspace('nit-rpc-');
  initWorkspace(cwd);

  const configPath = join(cwd, '.nit', 'config');
  const before = readFileSync(configPath, 'utf8');

  const unsafeChain = runNit(cwd, ['rpc', 'set-url', '../evm', 'https://rpc.example']);
  assert.notEqual(unsafeChain.status, 0);
  assert.match(unsafeChain.stderr, /unsafe characters|invalid/i);

  const unsafeUrl = runNit(cwd, ['rpc', 'set-url', 'evm', 'file:///tmp/socket']);
  assert.notEqual(unsafeUrl.status, 0);
  assert.match(unsafeUrl.stderr, /http:\/\/ or https:\/\//);
  assert.equal(readFileSync(configPath, 'utf8'), before);
});

test('auth set rejects unsafe domains and account control characters', () => {
  const cwd = workspace('nit-auth-');
  initWorkspace(cwd);

  const configPath = join(cwd, '.nit', 'config');
  const before = readFileSync(configPath, 'utf8');

  const unsafeDomain = runNit(cwd, [
    'auth',
    'set',
    '../../config',
    '--provider',
    'google',
    '--account',
    'agent@example.com',
  ]);
  assert.notEqual(unsafeDomain.status, 0);
  assert.match(unsafeDomain.stderr, /unsafe characters|invalid/i);

  const unsafeAccount = runNit(cwd, [
    'auth',
    'set',
    'example.com',
    '--provider',
    'google',
    '--account',
    'agent@example.com\ninjected: true',
  ]);
  assert.notEqual(unsafeAccount.status, 0);
  assert.match(unsafeAccount.stderr, /control characters/i);
  assert.equal(readFileSync(configPath, 'utf8'), before);
});

test('init fails without overwriting malformed existing agent-card.json', () => {
  const cwd = workspace('nit-init-');
  const cardPath = join(cwd, 'agent-card.json');
  writeFileSync(cardPath, '{bad json', 'utf8');

  const result = runNit(cwd, ['init']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid agent-card\.json/);
  assert.equal(readFileSync(cardPath, 'utf8'), '{bad json');
  assert.equal(existsSync(join(cwd, '.nit')), false);
});

test('init fails before creating .nit when existing card lacks required fields', () => {
  const cwd = workspace('nit-init-required-');
  const cardPath = join(cwd, 'agent-card.json');
  writeFileSync(cardPath, JSON.stringify({ description: 'missing name' }), 'utf8');

  const result = runNit(cwd, ['init']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing "name"/);
  assert.equal(existsSync(join(cwd, '.nit')), false);
});

test('init rejects malformed skill entries before creating .nit', () => {
  const cwd = workspace('nit-init-skill-shape-');
  const cardPath = join(cwd, 'agent-card.json');
  writeFileSync(cardPath, JSON.stringify({
    name: 'agent',
    description: 'bad skills',
    skills: [123],
  }), 'utf8');

  const result = runNit(cwd, ['init']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /skills\[0\] must be a JSON object/);
  assert.equal(existsSync(join(cwd, '.nit')), false);
});

test('checkout fails closed when working card is malformed', () => {
  const cwd = workspace('nit-checkout-malformed-');
  initWorkspace(cwd);
  assert.equal(runNit(cwd, ['branch', 'feature']).status, 0);

  const cardPath = join(cwd, 'agent-card.json');
  writeFileSync(cardPath, '{bad json', 'utf8');

  const result = runNit(cwd, ['checkout', 'feature']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid agent-card\.json/);
  assert.equal(readFileSync(cardPath, 'utf8'), '{bad json');
  assert.match(readFileSync(join(cwd, '.nit', 'HEAD'), 'utf8'), /refs\/heads\/main/);
});

test('commit rejects control characters in identity metadata', () => {
  const cwd = workspace('nit-commit-control-');
  initWorkspace(cwd);

  const cardPath = join(cwd, 'agent-card.json');
  const card = JSON.parse(readFileSync(cardPath, 'utf8'));
  card.name = 'bad\nname';
  card.description = 'changed';
  writeFileSync(cardPath, JSON.stringify(card, null, 2), 'utf8');

  const result = runNit(cwd, ['commit', '-m', 'bad metadata']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /control characters/);
});

test('corrupt objects are rejected instead of trusted by path', () => {
  const cwd = workspace('nit-corrupt-object-');
  initWorkspace(cwd);

  const commitHash = readFileSync(join(cwd, '.nit', 'refs', 'heads', 'main'), 'utf8').trim();
  const objectPath = join(cwd, '.nit', 'objects', commitHash.slice(0, 2), commitHash.slice(2));
  writeFileSync(objectPath, 'corrupted object', 'utf8');

  const result = runNit(cwd, ['log']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Object hash mismatch/);
});

test('init uses Newtype as the default nit skill source', async () => {
  const cwd = workspace('nit-skill-default-');
  const api = await import(pathToFileURL(join(repoRoot, 'dist', 'index.js')).href);
  const oldFetch = globalThis.fetch;
  const remoteSkill = `---\nname: nit\ndescription: remote nit skill\n---\n\n# Remote nit skill\n`;
  const seenUrls = [];

  globalThis.fetch = async (url) => {
    seenUrls.push(String(url));
    return new Response(remoteSkill, {
      status: 200,
      headers: { 'content-type': 'text/markdown' },
    });
  };

  try {
    const result = await api.init({ projectDir: cwd });
    assert.equal(result.nitSkillSource, 'newtype');
    assert.equal(result.nitSkillUrl, api.DEFAULT_NIT_SKILL_URL);
    assert.deepEqual(seenUrls, [api.DEFAULT_NIT_SKILL_URL]);
    assert.equal(readFileSync(result.nitSkillPath, 'utf8'), remoteSkill);
    const config = readFileSync(join(cwd, '.nit', 'config'), 'utf8');
    assert.match(config, /\[nit "skill"\]/);
    assert.match(config, /source = newtype/);
    assert.match(config, /url = https:\/\/api\.newtype-ai\.org\/nit\/skill\.md/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('init can skip installing the nit skill without deleting features', () => {
  const cwd = workspace('nit-skill-none-');
  const result = runNit(cwd, ['init', '--skill-source', 'none']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const plain = stripAnsi(result.stdout);
  assert.match(plain, /nit skill:\s+\(not installed\)/);
  assert.doesNotMatch(plain, /cat .*SKILL\.md/);
  assert.equal(existsSync(join(cwd, '.claude', 'skills', 'nit', 'SKILL.md')), false);
  const config = readFileSync(join(cwd, '.nit', 'config'), 'utf8');
  assert.match(config, /source = none/);
});

test('skill refresh can switch between embedded and custom URL sources', async () => {
  const cwd = workspace('nit-skill-refresh-');
  initWorkspace(cwd);
  const api = await import(pathToFileURL(join(repoRoot, 'dist', 'index.js')).href);
  const skillPath = join(cwd, '.claude', 'skills', 'nit', 'SKILL.md');
  const remoteSkill = `---\nname: nit\ndescription: custom nit skill\n---\n\n# Custom nit skill\n`;
  const oldFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'http://skill.test/nit.md');
    return new Response(remoteSkill, {
      status: 200,
      headers: { 'content-type': 'text/markdown' },
    });
  };

  try {
    const custom = await api.skillRefresh({
      projectDir: cwd,
      skillUrl: 'http://skill.test/nit.md',
    });
    assert.equal(custom.config.source, 'url');
    assert.equal(custom.config.url, 'http://skill.test/nit.md');
    assert.equal(readFileSync(skillPath, 'utf8'), remoteSkill);
    let config = readFileSync(join(cwd, '.nit', 'config'), 'utf8');
    assert.match(config, /source = url/);
    assert.match(config, /url = http:\/\/skill\.test\/nit\.md/);

    const embedded = runNit(cwd, ['skill', 'refresh', '--source', 'embedded']);
    assert.equal(embedded.status, 0, embedded.stderr || embedded.stdout);
    assert.match(readFileSync(skillPath, 'utf8'), /# nit — Git for Agent Identity/);
    config = readFileSync(join(cwd, '.nit', 'config'), 'utf8');
    assert.match(config, /source = embedded/);
    assert.doesNotMatch(config, /url = http:\/\/skill\.test\/nit\.md/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('skill refresh falls back when remote skill is oversized', async () => {
  const cwd = workspace('nit-skill-oversized-');
  initWorkspace(cwd);
  const api = await import(pathToFileURL(join(repoRoot, 'dist', 'index.js')).href);
  const skillPath = join(cwd, '.claude', 'skills', 'nit', 'SKILL.md');
  const oldFetch = globalThis.fetch;

  globalThis.fetch = async () => new Response('x', {
    status: 200,
    headers: { 'content-length': String(70 * 1024) },
  });

  try {
    const result = await api.skillRefresh({
      projectDir: cwd,
      skillUrl: 'http://skill.test/nit.md',
    });
    assert.equal(result.config.source, 'url');
    assert.equal(result.contentSource, 'embedded');
    assert.match(readFileSync(skillPath, 'utf8'), /# nit — Git for Agent Identity/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('push and pull exit nonzero on network failures', () => {
  const cwd = workspace('nit-network-');
  initWorkspace(cwd);

  assert.equal(runNit(cwd, ['remote', 'set-url', 'origin', 'http://127.0.0.1:9']).status, 0);

  const pushResult = runNit(cwd, ['push']);
  assert.notEqual(pushResult.status, 0);
  assert.match(pushResult.stdout, /main/);

  const pullResult = runNit(cwd, ['pull']);
  assert.notEqual(pullResult.status, 0);
  assert.match(pullResult.stdout, /main/);
  assert.equal(pullResult.stdout.includes('up to date'), false);
});

test('push works against a non-Newtype compatible remote', async () => {
  const cwd = workspace('nit-local-remote-');
  initWorkspace(cwd);
  const api = await import(pathToFileURL(join(repoRoot, 'dist', 'index.js')).href);
  const oldFetch = globalThis.fetch;
  const pushed = [];

  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, 'http://remote.test');
    assert.equal(parsed.pathname, '/agent-card/branches/main');
    assert.equal(init.method, 'PUT');
    assert.match(init.headers['X-Nit-Agent-Id'], /^[0-9a-f-]+$/);
    assert.equal(typeof init.headers['X-Nit-Signature'], 'string');
    const body = JSON.parse(String(init.body));
    assert.equal(typeof body.card_json, 'string');
    assert.match(body.commit_hash, /^[0-9a-f]{64}$/);
    pushed.push(body);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    await api.remoteSetUrl('origin', 'http://remote.test', { projectDir: cwd });
    const result = await api.push({ projectDir: cwd });
    assert.equal(result[0].success, true);
    assert.equal(pushed.length, 1);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('doctor default stays local and skips network checks', () => {
  const cwd = workspace('nit-doctor-local-');
  initWorkspace(cwd);

  const result = runNit(cwd, ['doctor']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /nit version/);
  assert.match(result.stdout, /workspace/);
  assert.match(result.stdout, /remote/);
  assert.equal(result.stdout.includes('remote health'), false);
  assert.equal(result.stdout.includes('newtype api'), false);
  assert.equal(result.stdout.includes('npm latest'), false);
  assert.equal(result.stdout.includes('npm auth'), false);
});

test('pull reads custom remotes from /.well-known/agent-card.json', async () => {
  const cwd = workspace('nit-pull-url-');
  initWorkspace(cwd);
  const api = await import(pathToFileURL(join(repoRoot, 'dist', 'index.js')).href);

  const cardPath = join(cwd, 'agent-card.json');
  const remoteCard = JSON.parse(readFileSync(cardPath, 'utf8'));
  remoteCard.description = 'remote card version';

  const seenPaths = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    seenPaths.push(new URL(String(url)).pathname);
    return new Response(JSON.stringify(remoteCard), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    await api.remoteSetUrl('origin', 'http://example.test', { projectDir: cwd });

    const pullResult = await api.pull({ projectDir: cwd });
    assert.equal(pullResult[0].error, undefined);
    assert.deepEqual(seenPaths, ['/.well-known/agent-card.json']);
    assert.equal(JSON.parse(readFileSync(cardPath, 'utf8')).description, 'remote card version');
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('pull rejects remote cards with mismatched identity fields', async () => {
  const cwd = workspace('nit-pull-identity-mismatch-');
  initWorkspace(cwd);
  const api = await import(pathToFileURL(join(repoRoot, 'dist', 'index.js')).href);

  const cardPath = join(cwd, 'agent-card.json');
  const before = JSON.parse(readFileSync(cardPath, 'utf8'));
  const remoteCard = {
    ...before,
    publicKey: `ed25519:${Buffer.alloc(32, 1).toString('base64')}`,
    description: 'poisoned remote card',
  };

  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(remoteCard), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  try {
    const pullResult = await api.pull({ projectDir: cwd });
    assert.match(pullResult[0].error, /publicKey does not match local identity/);
    assert.equal(JSON.parse(readFileSync(cardPath, 'utf8')).description, before.description);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('pull normalizes remote cards that omit local identity fields', async () => {
  const cwd = workspace('nit-pull-normalize-');
  initWorkspace(cwd);
  const api = await import(pathToFileURL(join(repoRoot, 'dist', 'index.js')).href);

  const cardPath = join(cwd, 'agent-card.json');
  const before = JSON.parse(readFileSync(cardPath, 'utf8'));
  const remoteCard = {
    ...before,
    description: 'remote description without identity fields',
    url: 'https://evil.example/card',
  };
  delete remoteCard.publicKey;
  delete remoteCard.wallet;

  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(remoteCard), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  try {
    const pullResult = await api.pull({ projectDir: cwd });
    assert.equal(pullResult[0].error, undefined);
    const after = JSON.parse(readFileSync(cardPath, 'utf8'));
    assert.equal(after.description, 'remote description without identity fields');
    assert.equal(after.publicKey, before.publicKey);
    assert.deepEqual(after.wallet, before.wallet);
    assert.equal(after.url, before.url);
    assert.notEqual(after.url, 'https://evil.example/card');
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('remote branch APIs work against a non-Newtype compatible remote', async () => {
  const cwd = workspace('nit-remote-branches-');
  initWorkspace(cwd);
  const api = await import(pathToFileURL(join(repoRoot, 'dist', 'index.js')).href);
  const oldFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(String(url));
    calls.push({ pathname: parsed.pathname, method: init.method ?? 'GET', headers: init.headers ?? {} });
    assert.equal(parsed.origin, 'http://remote.test');

    if (parsed.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (parsed.pathname === '/agent-card/branches') {
      assert.equal(typeof init.headers['X-Nit-Agent-Id'], 'string');
      assert.equal(typeof init.headers['X-Nit-Signature'], 'string');
      return new Response(JSON.stringify({
        branches: [{ name: 'main' }, { name: 'faam.io' }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    throw new Error(`unexpected request ${parsed.pathname}`);
  };

  try {
    await api.remoteSetUrl('origin', 'http://remote.test', { projectDir: cwd });
    assert.deepEqual(await api.remoteBranches({ projectDir: cwd }), ['main', 'faam.io']);

    const check = await api.remoteCheck({ projectDir: cwd });
    assert.equal(check.health.ok, true);
    assert.equal(check.branches.ok, true);
    assert.deepEqual(check.branches.names, ['main', 'faam.io']);

    assert.deepEqual(
      calls.map((call) => `${call.method} ${call.pathname}`),
      ['GET /agent-card/branches', 'GET /health', 'GET /agent-card/branches'],
    );
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('named remotes are selected explicitly for push pull check and delete', async () => {
  const cwd = workspace('nit-named-remotes-');
  initWorkspace(cwd);
  const api = await import(pathToFileURL(join(repoRoot, 'dist', 'index.js')).href);
  const remoteCard = JSON.parse(readFileSync(join(cwd, 'agent-card.json'), 'utf8'));
  remoteCard.description = 'backup remote version';
  const oldFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, 'http://backup.test');
    calls.push(`${init.method ?? 'GET'} ${parsed.pathname}`);

    if (parsed.pathname === '/agent-card/branches/main' && init.method === 'PUT') {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (parsed.pathname === '/.well-known/agent-card.json') {
      return new Response(JSON.stringify(remoteCard), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (parsed.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (parsed.pathname === '/agent-card/branches' && !init.method) {
      return new Response(JSON.stringify({ branches: [{ name: 'main' }, { name: 'faam.io' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (parsed.pathname === '/agent-card/branches/faam.io' && init.method === 'DELETE') {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    throw new Error(`unexpected request ${init.method ?? 'GET'} ${parsed.pathname}`);
  };

  try {
    await api.remoteSetUrl('origin', 'http://origin.test', { projectDir: cwd });
    await api.remoteAdd('backup', 'http://backup.test', { projectDir: cwd });

    await assert.rejects(
      () => api.remoteBranches({ projectDir: cwd, remoteName: 'missing' }),
      /Remote "missing" does not exist/,
    );

    const pushResult = await api.push({ projectDir: cwd, remoteName: 'backup' });
    assert.equal(pushResult[0].success, true);

    const pullResult = await api.pull({ projectDir: cwd, remoteName: 'backup' });
    assert.equal(pullResult[0].error, undefined);
    assert.equal(JSON.parse(readFileSync(join(cwd, 'agent-card.json'), 'utf8')).description, 'backup remote version');

    assert.deepEqual(await api.remoteBranches({ projectDir: cwd, remoteName: 'backup' }), ['main', 'faam.io']);
    const check = await api.remoteCheck({ projectDir: cwd, remoteName: 'backup' });
    assert.equal(check.name, 'backup');
    assert.equal(check.health.ok, true);
    assert.equal(check.branches.ok, true);

    await api.branch('faam.io', { projectDir: cwd });
    await api.branchDelete('faam.io', { projectDir: cwd, remote: true, remoteName: 'backup' });
    assert.equal((await api.branch(undefined, { projectDir: cwd })).some((b) => b.name === 'faam.io'), false);

    assert.deepEqual(calls, [
      'PUT /agent-card/branches/main',
      'GET /.well-known/agent-card.json',
      'GET /agent-card/branches',
      'GET /health',
      'GET /agent-card/branches',
      'DELETE /agent-card/branches/faam.io',
    ]);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('fetchBranchCard completes non-main challenge-response flow', async () => {
  const cwd = workspace('nit-fetch-challenge-');
  initWorkspace(cwd);
  const api = await import(pathToFileURL(join(repoRoot, 'dist', 'index.js')).href);
  const card = JSON.parse(readFileSync(join(cwd, 'agent-card.json'), 'utf8'));
  card.description = 'private branch card';
  const oldFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(String(url));
    calls.push({ search: parsed.search, headers: init.headers ?? {} });
    assert.equal(parsed.origin, 'http://card.test');
    assert.equal(parsed.pathname, '/.well-known/agent-card.json');
    assert.equal(parsed.searchParams.get('branch'), 'faam.io');

    if (!init.headers?.['X-Nit-Challenge']) {
      return new Response(JSON.stringify({
        challenge: 'challenge-token',
        expires: Math.floor(Date.now() / 1000) + 60,
      }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }

    assert.equal(init.headers['X-Nit-Challenge'], 'challenge-token');
    assert.equal(typeof init.headers['X-Nit-Signature'], 'string');
    return new Response(JSON.stringify(card), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const result = await api.fetchBranchCard('http://card.test', 'faam.io', join(cwd, '.nit'));
    assert.equal(result.description, 'private branch card');
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('fetchBranchCard rejects oversized and malformed remote responses', async () => {
  const api = await import(pathToFileURL(join(repoRoot, 'dist', 'index.js')).href);
  const oldFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => new Response('x', {
      status: 200,
      headers: { 'content-length': String(300_000) },
    });
    await assert.rejects(
      () => api.fetchBranchCard('http://example.test', 'main'),
      /exceeds 262144 bytes/,
    );

    globalThis.fetch = async () => new Response('{bad json', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    await assert.rejects(
      () => api.fetchBranchCard('http://example.test', 'main'),
      /Agent card is not valid JSON/,
    );
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('fetchBranchCard validates challenge response shape before signing', async () => {
  const cwd = workspace('nit-challenge-shape-');
  initWorkspace(cwd);
  const api = await import(pathToFileURL(join(repoRoot, 'dist', 'index.js')).href);
  const oldFetch = globalThis.fetch;

  globalThis.fetch = async () => new Response(JSON.stringify({ challenge: 123, expires: Date.now() }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });

  try {
    await assert.rejects(
      () => api.fetchBranchCard('http://example.test', 'feature', join(cwd, '.nit')),
      /missing challenge/,
    );

    globalThis.fetch = async () => new Response(JSON.stringify({
      challenge: 'expired-challenge',
      expires: Math.floor(Date.now() / 1000) - 1,
    }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
    await assert.rejects(
      () => api.fetchBranchCard('http://example.test', 'feature', join(cwd, '.nit')),
      /expired/,
    );
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('diffCards detects wallet and runtime changes', async () => {
  const { diffCards } = await import(pathToFileURL(join(repoRoot, 'dist', 'index.js')).href);
  const base = {
    protocolVersion: '0.3.0',
    name: 'agent',
    description: 'test agent',
    version: '1.0.0',
    url: 'https://example.com',
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
  };

  const withInjectedFields = {
    ...base,
    wallet: { solana: 'sol', evm: '0x123' },
    runtime: {
      provider: 'openai',
      model: 'gpt-test',
      harness: 'codex',
      declared_at: 1,
    },
  };

  const diff = diffCards(base, withInjectedFields);
  assert.equal(diff.changed, true);
  assert.deepEqual(diff.fields.map((field) => field.field).sort(), ['runtime', 'wallet']);
});

test('sign-tx rejects malformed hex before signing', () => {
  const cwd = workspace('nit-sign-tx-');
  initWorkspace(cwd);

  const malformed = runNit(cwd, ['sign-tx', '--chain', 'solana', 'zz']);
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /valid hex/i);

  const empty = runNit(cwd, ['sign-tx', '--chain', 'solana', '0x']);
  assert.notEqual(empty.status, 0);
  assert.match(empty.stderr, /cannot be empty/i);

  const valid = runNit(cwd, ['sign-tx', '--chain', 'solana', '00']);
  assert.equal(valid.status, 0, valid.stderr || valid.stdout);
  assert.equal(JSON.parse(valid.stdout).chain, 'solana');
});

test('broadcast validates RPC URL and caps responses', async () => {
  const cwd = workspace('nit-broadcast-rpc-');
  initWorkspace(cwd);
  const api = await import(pathToFileURL(join(repoRoot, 'dist', 'index.js')).href);

  await assert.rejects(
    () => api.broadcast('evm', '0x01', { projectDir: cwd, rpcUrl: 'file:///tmp/rpc' }),
    /http:\/\/ or https:\/\//,
  );

  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('x', {
    status: 200,
    headers: { 'content-length': String(70 * 1024) },
  });

  try {
    await assert.rejects(
      () => api.broadcast('evm', '0x01', { projectDir: cwd, rpcUrl: 'http://rpc.test' }),
      /RPC response exceeds/,
    );
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('sign --login emits clean JSON and verify-login checks it locally', () => {
  const cwd = workspace('nit-login-');
  initWorkspace(cwd);

  const login = runNit(cwd, ['sign', '--login', 'faam.io']);
  assert.equal(login.status, 0, login.stderr || login.stdout);
  assert.doesNotMatch(login.stderr, /Auth:|browser profile|OAuth/i);

  const payload = JSON.parse(login.stdout);
  assert.equal(payload.domain, 'faam.io');
  assert.equal(typeof payload.signature, 'string');
  assert.equal(typeof payload.public_key, 'string');
  assert.equal(payload.switchedBranch, undefined);
  assert.equal(payload.createdSkill, undefined);

  const payloadPath = join(cwd, 'login.json');
  writeFileSync(payloadPath, login.stdout, 'utf8');

  const verified = runNit(cwd, [
    'verify-login',
    payloadPath,
    '--card',
    'agent-card.json',
    '--domain',
    'faam.io',
  ]);
  assert.equal(verified.status, 0, verified.stderr || verified.stdout);
  const result = JSON.parse(verified.stdout);
  assert.equal(result.verified, true);
  assert.equal(result.agent_id, payload.agent_id);
  assert.equal(result.domain, 'faam.io');

  const wrongDomain = runNit(cwd, [
    'verify-login',
    payloadPath,
    '--card',
    'agent-card.json',
    '--domain',
    'discord.com',
  ]);
  assert.notEqual(wrongDomain.status, 0);
  assert.equal(JSON.parse(wrongDomain.stdout).verified, false);
  assert.match(JSON.parse(wrongDomain.stdout).error, /expected domain/);

  payload.domain = 'discord.com';
  writeFileSync(payloadPath, JSON.stringify(payload), 'utf8');
  const tampered = runNit(cwd, [
    'verify-login',
    payloadPath,
    '--card',
    'agent-card.json',
    '--max-age',
    '600',
  ]);
  assert.notEqual(tampered.status, 0);
  assert.equal(JSON.parse(tampered.stdout).verified, false);
  assert.match(JSON.parse(tampered.stdout).error, /signature is invalid/);
});

test('verify-login rejects malformed ids, timestamps, and base64 strictly', async () => {
  const cwd = workspace('nit-login-strict-');
  initWorkspace(cwd);
  const api = await import(pathToFileURL(join(repoRoot, 'dist', 'index.js')).href);

  const login = runNit(cwd, ['sign', '--login', 'faam.io']);
  assert.equal(login.status, 0, login.stderr || login.stdout);
  const payload = JSON.parse(login.stdout);
  const card = JSON.parse(readFileSync(join(cwd, 'agent-card.json'), 'utf8'));

  assert.match(
    api.verifyLoginPayload({ ...payload, agent_id: 'not-a-uuid' }, card).error,
    /agent_id must be a UUID/,
  );
  assert.match(
    api.verifyLoginPayload({ ...payload, timestamp: payload.timestamp + 0.5 }, card).error,
    /timestamp must be an integer/,
  );
  assert.match(
    api.verifyLoginPayload({ ...payload, signature: payload.signature.replace(/=$/, '') }, card).error,
    /64-byte Ed25519 signature/,
  );
  assert.match(
    api.verifyLoginPayload(payload, card, { now: payload.timestamp + 301 }).error,
    /stale/,
  );
  assert.match(
    api.verifyLoginPayload(payload, card, { now: payload.timestamp - 301 }).error,
    /future/,
  );
});
