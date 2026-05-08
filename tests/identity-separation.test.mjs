import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = join(repoRoot, 'dist', 'cli.js');
const env = { ...process.env, NIT_NO_AUTO_UPDATE: '1', CI: 'true' };

function tempRoot(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function mkdirp(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

function runNit(cwd, args, envOverride = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    env: { ...env, ...envOverride },
    encoding: 'utf8',
  });
}

function initCli(cwd) {
  const result = runNit(cwd, ['init', '--skill-source', 'none']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

async function nitApi() {
  return import(pathToFileURL(join(repoRoot, 'dist', 'index.js')).href);
}

function readCard(projectDir) {
  return JSON.parse(readFileSync(join(projectDir, 'agent-card.json'), 'utf8'));
}

function readHead(projectDir) {
  return readFileSync(join(projectDir, '.nit', 'refs', 'heads', 'main'), 'utf8').trim();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function configuredStressCount() {
  const raw = process.env.NIT_IDENTITY_STRESS_COUNT;
  if (!raw) return 24;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 2) {
    throw new Error('NIT_IDENTITY_STRESS_COUNT must be an integer >= 2');
  }
  return parsed;
}

test('nit workspace lookup is exact and never inherits from a parent directory', async () => {
  const api = await nitApi();
  const parent = tempRoot('nit-parent-exact-');
  const child = mkdirp(join(parent, 'nested', 'runtime-b'));

  initCli(parent);
  const parentStatus = await api.status({ projectDir: parent });

  assert.equal(api.findNitDir(parent), join(parent, '.nit'));
  assert.throws(
    () => api.findNitDir(child),
    /Not a nit workspace/,
  );
  await assert.rejects(
    () => api.status({ projectDir: child }),
    /Not a nit workspace/,
  );

  const childStatus = runNit(child, ['status']);
  assert.notEqual(childStatus.status, 0);
  assert.match(childStatus.stderr, /Not a nit workspace/);
  assert.equal(existsSync(join(child, '.nit')), false);

  const afterParentStatus = await api.status({ projectDir: parent });
  assert.equal(afterParentStatus.agentId, parentStatus.agentId);
});

test('a child runtime can initialize only its own identity and cannot mutate the parent identity', async () => {
  const api = await nitApi();
  const parent = tempRoot('nit-parent-child-');
  const child = mkdirp(join(parent, 'child-runtime'));

  initCli(parent);
  const parentBefore = await api.status({ projectDir: parent });
  const parentHeadBefore = readHead(parent);
  const parentCardBefore = readCard(parent);

  initCli(child);
  const childBefore = await api.status({ projectDir: child });
  const childHeadBefore = readHead(child);

  assert.notEqual(childBefore.agentId, parentBefore.agentId);
  assert.notEqual(childBefore.publicKey, parentBefore.publicKey);
  assert.notEqual(childBefore.cardUrl, parentBefore.cardUrl);
  assert.equal(childBefore.cardUrl, `https://agent-${childBefore.agentId}.newtype-ai.org`);
  assert.equal(parentBefore.cardUrl, `https://agent-${parentBefore.agentId}.newtype-ai.org`);
  assert.equal(api.findNitDir(child), join(child, '.nit'));

  const childCard = readCard(child);
  childCard.description = 'child runtime owns its own card';
  writeFileSync(join(child, 'agent-card.json'), JSON.stringify(childCard, null, 2) + '\n', 'utf8');
  await api.commit('child-only update', { projectDir: child });

  assert.notEqual(readHead(child), childHeadBefore);
  assert.equal(readHead(parent), parentHeadBefore);
  assert.deepEqual(readCard(parent), parentCardBefore);

  const parentAfter = await api.status({ projectDir: parent });
  const childAfter = await api.status({ projectDir: child });
  assert.equal(parentAfter.agentId, parentBefore.agentId);
  assert.equal(childAfter.agentId, childBefore.agentId);
});

test('sibling agent runtimes get independent identities with the same installed CLI', async () => {
  const api = await nitApi();
  const root = tempRoot('nit-siblings-');
  const runtimeA = mkdirp(join(root, 'runtime-a'));
  const runtimeB = mkdirp(join(root, 'runtime-b'));

  initCli(runtimeA);
  initCli(runtimeB);

  const a = await api.status({ projectDir: runtimeA });
  const b = await api.status({ projectDir: runtimeB });

  assert.notEqual(a.agentId, b.agentId);
  assert.notEqual(a.publicKey, b.publicKey);
  assert.notEqual(a.walletAddresses.solana, b.walletAddresses.solana);
  assert.notEqual(a.walletAddresses.ethereum, b.walletAddresses.ethereum);
  assert.notEqual(readCard(runtimeA).url, readCard(runtimeB).url);

  const aNested = mkdirp(join(runtimeA, 'subdir'));
  const bNested = mkdirp(join(runtimeB, 'subdir'));
  assert.notEqual(runNit(aNested, ['status']).status, 0);
  assert.notEqual(runNit(bNested, ['status']).status, 0);
});

test('login auto-bootstrap creates identity in the exact target directory, not an initialized parent', async () => {
  const api = await nitApi();
  const parent = tempRoot('nit-login-parent-');
  const child = mkdirp(join(parent, 'login-child'));

  initCli(parent);
  const parentStatus = await api.status({ projectDir: parent });
  const pushes = [];
  const oldFetch = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, 'https://api.newtype-ai.org');
    assert.equal(parsed.pathname, '/agent-card/branches/main');
    assert.equal(init.method, 'PUT');
    pushes.push({
      agentId: init.headers['X-Nit-Agent-Id'],
      workspaceHash: init.headers['X-Nit-Workspace-Hash'],
      body: JSON.parse(String(init.body)),
    });
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const payload = await api.loginPayload('app.test', {
      projectDir: child,
      skillSource: 'none',
    });
    assert.equal(payload.autoInitialized, true);
    assert.equal(payload.autoPushed, true);
    assert.equal(payload.switchedBranch, 'app.test');
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0].agentId, payload.agent_id);
    assert.notEqual(payload.agent_id, parentStatus.agentId);
    assert.equal(pushes[0].workspaceHash, sha256(join(child, '.nit')));
    assert.equal(existsSync(join(child, '.nit')), true);

    const parentAfter = await api.status({ projectDir: parent });
    const childAfter = await api.status({ projectDir: child });
    assert.equal(parentAfter.agentId, parentStatus.agentId);
    assert.equal(childAfter.agentId, payload.agent_id);
    assert.equal(childAfter.branch, 'app.test');
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('remote push signs and declares the identity of the selected workspace only', async () => {
  const api = await nitApi();
  const root = tempRoot('nit-push-identity-');
  const runtimeA = mkdirp(join(root, 'runtime-a'));
  const runtimeB = mkdirp(join(root, 'runtime-b'));
  const pushes = [];
  const oldFetch = globalThis.fetch;

  await api.init({ projectDir: runtimeA, skillSource: 'none' });
  await api.init({ projectDir: runtimeB, skillSource: 'none' });
  await api.remoteSetUrl('origin', 'http://remote.test', { projectDir: runtimeA });
  await api.remoteSetUrl('origin', 'http://remote.test', { projectDir: runtimeB });

  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, 'http://remote.test');
    assert.equal(parsed.pathname, '/agent-card/branches/main');
    assert.equal(init.method, 'PUT');
    pushes.push({
      agentId: init.headers['X-Nit-Agent-Id'],
      signature: init.headers['X-Nit-Signature'],
      workspaceHash: init.headers['X-Nit-Workspace-Hash'],
      body: JSON.parse(String(init.body)),
    });
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    await api.push({ projectDir: runtimeA });
    await api.push({ projectDir: runtimeB });
  } finally {
    globalThis.fetch = oldFetch;
  }

  assert.equal(pushes.length, 2);
  assert.notEqual(pushes[0].agentId, pushes[1].agentId);
  assert.notEqual(pushes[0].signature, pushes[1].signature);
  assert.notEqual(pushes[0].workspaceHash, pushes[1].workspaceHash);
  assert.equal(pushes[0].workspaceHash, sha256(join(runtimeA, '.nit')));
  assert.equal(pushes[1].workspaceHash, sha256(join(runtimeB, '.nit')));
  assert.equal(JSON.parse(pushes[0].body.card_json).url, `https://agent-${pushes[0].agentId}.newtype-ai.org`);
  assert.equal(JSON.parse(pushes[1].body.card_json).url, `https://agent-${pushes[1].agentId}.newtype-ai.org`);
});

test('many isolated runtime folders generate unique non-floating identities', async () => {
  const api = await nitApi();
  const root = tempRoot('nit-identity-scale-');
  const count = configuredStressCount();
  const agentIds = new Set();
  const publicKeys = new Set();
  const cardUrls = new Set();
  const walletSolana = new Set();
  const walletEvm = new Set();

  for (let i = 0; i < count; i++) {
    const projectDir = mkdirp(join(root, `agent-${String(i).padStart(5, '0')}`));
    const initResult = await api.init({ projectDir, skillSource: 'none' });
    const status = await api.status({ projectDir });
    const nested = mkdirp(join(projectDir, 'nested'));

    assert.equal(status.agentId, initResult.agentId);
    assert.equal(api.findNitDir(projectDir), join(projectDir, '.nit'));
    assert.throws(() => api.findNitDir(nested), /Not a nit workspace/);

    agentIds.add(status.agentId);
    publicKeys.add(status.publicKey);
    cardUrls.add(status.cardUrl);
    walletSolana.add(status.walletAddresses.solana);
    walletEvm.add(status.walletAddresses.ethereum);
  }

  assert.equal(agentIds.size, count);
  assert.equal(publicKeys.size, count);
  assert.equal(cardUrls.size, count);
  assert.equal(walletSolana.size, count);
  assert.equal(walletEvm.size, count);
});
