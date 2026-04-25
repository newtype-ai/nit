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
  const result = runNit(cwd, ['init']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

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
