#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
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
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cliPath = join(repoRoot, 'dist', 'cli.js');
const defaultSdkPath = resolve(repoRoot, '..', 'nit-sdk', 'dist', 'index.js');
const textEncoder = new TextEncoder();

function parseArgs(argv) {
  const opts = {
    agents: 50,
    fullAgents: 10,
    concurrency: 8,
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

    if (arg === '--agents') opts.agents = parsePositiveInt(next(), arg);
    else if (arg === '--full-agents') {
      const value = next();
      opts.fullAgents = value === 'all' ? 'all' : parsePositiveInt(value, arg);
    } else if (arg === '--concurrency') opts.concurrency = parsePositiveInt(next(), arg);
    else if (arg === '--sdk-path') opts.sdkPath = resolve(next());
    else if (arg === '--tmp') opts.tmp = resolve(next());
    else if (arg === '--timeout-ms') opts.commandTimeoutMs = parsePositiveInt(next(), arg);
    else if (arg === '--keep') opts.keep = true;
    else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (opts.fullAgents === 'all') opts.fullAgents = opts.agents;
  opts.fullAgents = Math.min(opts.fullAgents, opts.agents);
  opts.concurrency = Math.min(opts.concurrency, opts.agents);
  return opts;
}

function parsePositiveInt(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function printUsage() {
  console.log(`Usage: node scripts/identity-flow-harness.mjs [options]

Options:
  --agents <n>        Number of isolated agent runtimes to create. Default: 50
  --full-agents <n>   Agents that run every CLI feature check. Default: 10
                       Use "all" to run full checks for every agent.
  --concurrency <n>   Concurrent agent flows. Default: 8
  --sdk-path <path>   Path to @newtype-ai/nit-sdk dist/index.js
  --tmp <path>        Workspace root. Default: mktemp under OS tmp
  --timeout-ms <n>    Per-command timeout. Default: 30000
  --keep              Keep generated workspaces after the run`);
}

function mkdirp(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function workspaceHashFor(projectDir) {
  return sha256(join(realpathSync(projectDir), '.nit'));
}

function base64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64url(value) {
  let s = value.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

async function readRequestBody(req, maxBytes = 512 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.byteLength;
    if (total > maxBytes) throw httpError(413, `Request exceeds ${maxBytes} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function jsonResponse(res, status, body, headers = {}) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(raw),
    ...headers,
  });
  res.end(raw);
}

function textResponse(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

export class LocalNewtypeHarness {
  constructor(nitApi) {
    this.nitApi = nitApi;
    this.server = null;
    this.origin = '';
    this.branches = new Map();
    this.pubkeys = new Map();
    this.identities = new Map();
    this.pushSignals = [];
    this.loginDomains = new Map();
    this.challenges = new Map();
    this.readTokenSecret = randomBytes(32).toString('hex');
    this.defaultReadAgentId = '';
  }

  async listen() {
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        const status = Number.isInteger(err.status) ? err.status : 500;
        jsonResponse(res, status, { error: err.message || 'Internal server error' });
      });
    });
    await new Promise((resolveListen) => this.server.listen(0, '127.0.0.1', resolveListen));
    const address = this.server.address();
    this.origin = `http://127.0.0.1:${address.port}`;
    return this.origin;
  }

  async close() {
    if (!this.server) return;
    await new Promise((resolveClose) => this.server.close(resolveClose));
  }

  async handle(req, res) {
    const url = new URL(req.url ?? '/', this.origin || 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/health') {
      jsonResponse(res, 200, { status: 'ok', service: 'local-newtype-flow-harness' });
      return;
    }

    if (req.method === 'POST' && (url.pathname === '/rpc/solana' || url.pathname === '/rpc/evm')) {
      await this.handleRpc(req, res);
      return;
    }

    const branchMatch = url.pathname.match(/^\/agent-card\/branches\/([^/]+)$/);
    if (branchMatch && req.method === 'PUT') {
      await this.handlePush(req, res, url, decodeURIComponent(branchMatch[1]));
      return;
    }
    if (url.pathname === '/agent-card/branches' && req.method === 'GET') {
      await this.handleListBranches(req, res, url);
      return;
    }
    if (branchMatch && req.method === 'DELETE') {
      await this.handleDeleteBranch(req, res, url, decodeURIComponent(branchMatch[1]));
      return;
    }
    if (url.pathname === '/agent-card/verify' && req.method === 'POST') {
      await this.handleVerify(req, res);
      return;
    }

    const cardMatch = url.pathname.match(/^\/agent\/([^/]+)\/\.well-known\/agent-card\.json$/);
    if (cardMatch && req.method === 'GET') {
      await this.handleCardRead(req, res, decodeURIComponent(cardMatch[1]), url.searchParams.get('branch') || 'main');
      return;
    }
    if (url.pathname === '/.well-known/agent-card.json' && req.method === 'GET') {
      if (!this.defaultReadAgentId) throw httpError(404, 'No default read agent configured');
      await this.handleCardRead(req, res, this.defaultReadAgentId, url.searchParams.get('branch') || 'main');
      return;
    }

    jsonResponse(res, 404, { error: 'Not found' });
  }

  async handleRpc(req, res) {
    const raw = await readRequestBody(req);
    const body = JSON.parse(raw);
    if (body.method === 'getBalance') {
      jsonResponse(res, 200, { jsonrpc: '2.0', id: body.id ?? 1, result: { value: 123_000_000 } });
      return;
    }
    if (body.method === 'sendTransaction') {
      jsonResponse(res, 200, {
        jsonrpc: '2.0',
        id: body.id ?? 1,
        result: `solana-${sha256(JSON.stringify(body.params ?? [])).slice(0, 40)}`,
      });
      return;
    }
    if (body.method === 'eth_sendRawTransaction') {
      jsonResponse(res, 200, {
        jsonrpc: '2.0',
        id: body.id ?? 1,
        result: `0x${sha256(JSON.stringify(body.params ?? [])).slice(0, 64)}`,
      });
      return;
    }
    jsonResponse(res, 400, { jsonrpc: '2.0', id: body.id ?? 1, error: { message: 'unsupported method' } });
  }

  async handlePush(req, res, url, branch) {
    validateRefName(branch, 'branch');
    const raw = await readRequestBody(req, 128 * 1024);
    const body = JSON.parse(raw);
    assert.equal(typeof body.card_json, 'string');
    assert.match(body.commit_hash, /^[0-9a-f]{64}$/);
    if (body.machine_hash !== undefined) assert.match(body.machine_hash, /^[0-9a-f]{64}$/);

    const card = JSON.parse(body.card_json);
    this.nitApi.assertAgentCardShape(card);
    if (branch === 'main' && typeof card.publicKey !== 'string') {
      throw httpError(400, 'main branch agent card must include publicKey');
    }

    const auth = await this.authenticateNitRequest(req, url, {
      body: raw,
      cardPublicKey: branch === 'main' ? card.publicKey : undefined,
    });

    if (branch !== 'main' && !this.pubkeys.has(auth.agentId)) {
      throw httpError(404, 'Agent not found. Push main branch first to register identity.');
    }

    const key = `${auth.agentId}:${branch}`;
    this.branches.set(key, {
      card_json: body.card_json,
      commit_hash: body.commit_hash,
      pushed_at: new Date().toISOString(),
    });

    const now = Math.floor(Date.now() / 1000);
    const ipHash = sha256(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unknown');
    const workspaceHash = getHeader(req, 'x-nit-workspace-hash') || null;
    const platform = getHeader(req, 'x-nit-platform') || null;
    const hostnameHash = getHeader(req, 'x-nit-hostname-hash') || null;
    const runtime = branch === 'main' && card.runtime && typeof card.runtime === 'object'
      ? card.runtime
      : null;

    if (branch === 'main') {
      this.pubkeys.set(auth.agentId, card.publicKey);
      if (!this.identities.has(auth.agentId)) {
        this.identities.set(auth.agentId, {
          agent_id: auth.agentId,
          public_key: card.publicKey,
          machine_hash: body.machine_hash || null,
          reg_ip_hash: ipHash,
          reg_timestamp: now,
          login_count: 0,
          last_login_ts: null,
          last_push_ip_hash: ipHash,
          platform,
          hostname_hash: hostnameHash,
          workspace_hash: workspaceHash,
          runtime_provider: null,
          runtime_model: null,
          runtime_harness: null,
          runtime_declared_at: null,
        });
      }
      const identity = this.identities.get(auth.agentId);
      identity.last_push_ip_hash = ipHash;
      identity.platform = platform;
      identity.hostname_hash = hostnameHash;
      identity.workspace_hash = workspaceHash;
      if (runtime) {
        identity.runtime_provider = runtime.provider ?? null;
        identity.runtime_model = runtime.model ?? null;
        identity.runtime_harness = runtime.harness ?? null;
        identity.runtime_declared_at = runtime.declared_at ?? null;
      }
    }

    this.pushSignals.push({
      agent_id: auth.agentId,
      ip_hash: ipHash,
      workspace_hash: workspaceHash,
      platform,
      hostname_hash: hostnameHash,
      runtime_provider: runtime?.provider ?? null,
      runtime_model: runtime?.model ?? null,
      runtime_harness: runtime?.harness ?? null,
    });

    jsonResponse(res, 200, { success: true, branch, commit_hash: body.commit_hash });
  }

  async handleListBranches(req, res, url) {
    const auth = await this.authenticateNitRequest(req, url);
    const prefix = `${auth.agentId}:`;
    const branches = [...this.branches.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({
        name: key.slice(prefix.length),
        commit_hash: value.commit_hash,
        pushed_at: value.pushed_at,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    jsonResponse(res, 200, { branches });
  }

  async handleDeleteBranch(req, res, url, branch) {
    validateRefName(branch, 'branch');
    if (branch === 'main') throw httpError(400, 'Cannot delete the main branch');
    const auth = await this.authenticateNitRequest(req, url);
    this.branches.delete(`${auth.agentId}:${branch}`);
    jsonResponse(res, 200, { success: true, deleted: branch });
  }

  async handleVerify(req, res) {
    const raw = await readRequestBody(req, 32 * 1024);
    const body = JSON.parse(raw);
    validateRefName(body.domain, 'domain');
    const pubKeyField = this.pubkeys.get(body.agent_id);
    if (!pubKeyField) {
      jsonResponse(res, 404, { verified: false, error: 'Agent not found. Push main branch first to register identity.' });
      return;
    }
    if (this.nitApi.deriveAgentId(pubKeyField) !== body.agent_id) {
      throw httpError(500, 'Stored publicKey does not match agent_id');
    }
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(body.timestamp) || Math.abs(now - body.timestamp) > 300) {
      jsonResponse(res, 401, { verified: false, error: 'Timestamp expired (must be within 5 minutes)' });
      return;
    }

    const message = `${body.agent_id}\n${body.domain}\n${body.timestamp}`;
    const valid = this.nitApi.verifySignature(pubKeyField.slice('ed25519:'.length), message, body.signature);
    if (!valid) {
      jsonResponse(res, 403, { verified: false, error: 'Signature verification failed' });
      return;
    }

    const branchKey = this.branches.has(`${body.agent_id}:${body.domain}`)
      ? `${body.agent_id}:${body.domain}`
      : `${body.agent_id}:main`;
    const stored = this.branches.get(branchKey);
    const card = stored ? JSON.parse(stored.card_json) : null;
    if (card) this.nitApi.assertAgentCardShape(card);

    const identity = this.identityMetadata(body.agent_id);
    let admitted = true;
    const policy = body.policy;
    if (policy) {
      if (policy.max_identities_per_ip != null && identity.ip_identity_count > policy.max_identities_per_ip) admitted = false;
      if (policy.max_identities_per_machine != null && identity.machine_identity_count > policy.max_identities_per_machine) admitted = false;
      if (policy.min_age_seconds != null && now - identity.registration_timestamp < policy.min_age_seconds) admitted = false;
      if (policy.max_login_rate_per_hour != null) {
        const age = Math.max(1, now - identity.registration_timestamp);
        const rate = (identity.total_logins * 3600) / age;
        if (rate > policy.max_login_rate_per_hour) admitted = false;
      }
    }

    const row = this.identities.get(body.agent_id);
    row.login_count++;
    row.last_login_ts = now;
    if (!this.loginDomains.has(body.agent_id)) this.loginDomains.set(body.agent_id, new Set());
    this.loginDomains.get(body.agent_id).add(body.domain);

    jsonResponse(res, 200, {
      verified: true,
      admitted,
      agent_id: body.agent_id,
      domain: body.domain,
      card,
      branch: branchKey.endsWith(`:${body.domain}`) ? body.domain : 'main',
      wallet: card?.wallet ?? null,
      readToken: this.createReadToken(body.agent_id, body.domain),
      identity,
    });
  }

  async handleCardRead(req, res, agentId, branch) {
    validateRefName(branch, 'branch');
    const key = `${agentId}:${branch}`;
    const stored = this.branches.get(key);

    if (branch === 'main') {
      if (!stored) throw httpError(404, 'Agent not found');
      jsonResponse(res, 200, JSON.parse(stored.card_json), {
        'x-agent-card-branch': 'main',
      });
      return;
    }

    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      const token = this.verifyReadToken(auth.slice('Bearer '.length));
      if (!token || token.sub !== agentId || token.dom !== branch) {
        throw httpError(403, 'Invalid read token');
      }
      if (!stored) throw httpError(404, `Branch '${branch}' not found`);
      jsonResponse(res, 200, JSON.parse(stored.card_json), {
        'x-agent-card-branch': branch,
      });
      return;
    }

    const challenge = getHeader(req, 'x-nit-challenge');
    const signature = getHeader(req, 'x-nit-signature');
    if (!challenge || !signature) {
      const token = randomBytes(32).toString('base64url');
      this.challenges.set(token, {
        agentId,
        branch,
        expires: Math.floor(Date.now() / 1000) + 60,
      });
      jsonResponse(res, 401, { challenge: token, expires: this.challenges.get(token).expires });
      return;
    }

    const challengeState = this.challenges.get(challenge);
    if (
      !challengeState ||
      challengeState.agentId !== agentId ||
      challengeState.branch !== branch ||
      challengeState.expires <= Math.floor(Date.now() / 1000)
    ) {
      throw httpError(403, 'Invalid challenge');
    }
    const pubKeyField = this.pubkeys.get(agentId);
    if (!pubKeyField) throw httpError(404, 'Agent not found');
    const valid = this.nitApi.verifySignature(pubKeyField.slice('ed25519:'.length), challenge, signature);
    if (!valid) throw httpError(403, 'Invalid challenge signature');
    if (!stored) throw httpError(404, `Branch '${branch}' not found`);
    jsonResponse(res, 200, JSON.parse(stored.card_json), {
      'x-agent-card-branch': branch,
    });
  }

  async authenticateNitRequest(req, url, options = {}) {
    const agentId = getHeader(req, 'x-nit-agent-id');
    const timestamp = getHeader(req, 'x-nit-timestamp');
    const signature = getHeader(req, 'x-nit-signature');
    if (!agentId || !timestamp || !signature) {
      throw httpError(401, 'Missing required nit auth headers');
    }
    assert.match(agentId, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    const ts = Number.parseInt(timestamp, 10);
    if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) {
      throw httpError(401, 'Timestamp expired or invalid');
    }

    let pubKeyField = this.pubkeys.get(agentId);
    if (!pubKeyField && options.cardPublicKey) {
      const expected = this.nitApi.deriveAgentId(options.cardPublicKey);
      if (expected !== agentId) throw httpError(403, 'Agent ID does not match public key');
      pubKeyField = options.cardPublicKey;
    }
    if (!pubKeyField) throw httpError(404, 'Agent not found. Push main branch first to register identity.');

    let message = `${req.method}\n${url.pathname}\n${agentId}\n${timestamp}`;
    if (options.body !== undefined) {
      message += `\n${sha256(options.body)}`;
    }
    const valid = this.nitApi.verifySignature(pubKeyField.slice('ed25519:'.length), message, signature);
    if (!valid) throw httpError(403, 'Signature verification failed');
    return { agentId };
  }

  createReadToken(agentId, domain) {
    const payload = {
      sub: agentId,
      dom: domain,
      exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    };
    const encodedPayload = base64url(JSON.stringify(payload));
    const sig = createHmac('sha256', this.readTokenSecret).update(encodedPayload).digest();
    return `${encodedPayload}.${base64url(sig)}`;
  }

  verifyReadToken(token) {
    const [encodedPayload, encodedSig] = token.split('.');
    if (!encodedPayload || !encodedSig) return null;
    const expected = base64url(createHmac('sha256', this.readTokenSecret).update(encodedPayload).digest());
    if (expected !== encodedSig) return null;
    const payload = JSON.parse(fromBase64url(encodedPayload).toString('utf8'));
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  }

  identityMetadata(agentId) {
    const row = this.identities.get(agentId);
    if (!row) throw httpError(404, 'Identity not found');
    const machineCount = row.machine_hash
      ? [...this.identities.values()].filter((item) => item.machine_hash === row.machine_hash).length
      : 1;
    const ipCount = [...this.identities.values()].filter((item) => item.reg_ip_hash === row.reg_ip_hash).length;
    const agentPushes = this.pushSignals.filter((item) => item.agent_id === agentId);
    const runtimeProviders = new Set(agentPushes.map((item) => item.runtime_provider).filter(Boolean));
    return {
      registration_timestamp: row.reg_timestamp,
      machine_identity_count: machineCount,
      ip_identity_count: ipCount,
      total_logins: row.login_count + 1,
      last_login_timestamp: row.last_login_ts,
      unique_domains: this.loginDomains.get(agentId)?.size ?? 0,
      last_push_country: null,
      last_push_asn: null,
      unique_push_ips: new Set(agentPushes.map((item) => item.ip_hash)).size,
      total_pushes: agentPushes.length,
      platform: row.platform,
      hostname_hash: row.hostname_hash,
      workspace_hash: row.workspace_hash,
      runtime_provider: row.runtime_provider,
      runtime_model: row.runtime_model,
      runtime_harness: row.runtime_harness,
      runtime_declared_at: row.runtime_declared_at,
      distinct_runtime_providers: runtimeProviders.size,
    };
  }
}

function getHeader(req, name) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function validateRefName(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw httpError(400, `${label} is required`);
  if (value.length > 253) throw httpError(400, `${label} is too long`);
  if (/[\x00-\x1f\x7f]/.test(value)) throw httpError(400, `${label} contains control characters`);
  if (value.includes(':') || value.includes('/') || value.includes('\\') || value.includes('..')) {
    throw httpError(400, `${label} contains unsafe characters`);
  }
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/.test(value)) {
    throw httpError(400, `${label} has invalid format`);
  }
}

function runNit(cwd, args, opts) {
  return runCommand(process.execPath, [cliPath, ...args], {
    cwd,
    timeoutMs: opts.commandTimeoutMs,
    env: {
      ...process.env,
      NIT_NO_AUTO_UPDATE: '1',
      CI: 'true',
    },
    input: opts.input,
  });
}

function runCommand(file, args, options) {
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
    }, options.timeoutMs);

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
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

function expectOk(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label} failed with ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result;
}

function expectFail(result, pattern, label) {
  if (result.status === 0 || !pattern.test(stripAnsi(result.stderr + result.stdout))) {
    throw new Error(`${label} did not fail as expected\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function runAgentFlow(index, context) {
  const { opts, server, sdk, root, parentRuntime } = context;
  const id = String(index).padStart(5, '0');
  const projectDir = mkdirp(join(parentRuntime, `agent-${id}`));
  const nestedDir = mkdirp(join(projectDir, 'nested-runtime'));
  const domain = `app-${id}.test`;
  const full = index < opts.fullAgents;

  expectFail(
    await runNit(projectDir, ['status'], opts),
    /Not a nit workspace/,
    `agent ${id} pre-init status`,
  );

  expectOk(await runNit(projectDir, ['init', '--skill-source', 'none'], opts), `agent ${id} init`);
  expectFail(
    await runNit(nestedDir, ['status'], opts),
    /Not a nit workspace/,
    `agent ${id} nested status`,
  );

  expectOk(await runNit(projectDir, ['remote', 'set-url', 'origin', server.origin], opts), `agent ${id} remote set-url`);
  expectOk(await runNit(projectDir, ['runtime', 'set', 'local', `model-${id}`, 'flow-harness'], opts), `agent ${id} runtime set`);

  const mainCardPath = join(projectDir, 'agent-card.json');
  const mainCard = readJson(mainCardPath);
  mainCard.name = `flow-agent-${id}`;
  mainCard.description = `Production flow harness agent ${id}`;
  mainCard.skills = [{ id: `base-${id}`, name: `Base ${id}`, description: 'Base test capability' }];
  writeJson(mainCardPath, mainCard);
  expectOk(await runNit(projectDir, ['commit', '-m', 'main runtime identity'], opts), `agent ${id} main commit`);

  if (full) {
    await runFullLocalFeatureChecks(projectDir, id, opts, server);
  }

  expectOk(await runNit(projectDir, ['branch', domain], opts), `agent ${id} branch`);
  expectOk(await runNit(projectDir, ['checkout', domain], opts), `agent ${id} checkout domain`);
  const domainCard = readJson(mainCardPath);
  domainCard.description = `Domain persona for ${domain}`;
  domainCard.skills = [{ id: `domain-${id}`, name: `Domain ${id}`, description: 'Domain branch capability' }];
  writeJson(mainCardPath, domainCard);
  expectOk(await runNit(projectDir, ['auth', 'set', domain, '--provider', 'github', '--account', `agent-${id}@example.test`], opts), `agent ${id} auth set`);
  const afterAuth = readJson(mainCardPath);
  afterAuth.description = `Domain persona for ${domain} with auth`;
  writeJson(mainCardPath, afterAuth);
  expectOk(await runNit(projectDir, ['commit', '-m', 'domain persona'], opts), `agent ${id} domain commit`);

  const push = expectOk(await runNit(projectDir, ['push', '--all'], opts), `agent ${id} push all`);
  assert.match(stripAnsi(push.stdout), /main/);
  assert.match(stripAnsi(push.stdout), new RegExp(domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const branches = expectOk(await runNit(projectDir, ['remote', 'branches'], opts), `agent ${id} remote branches`);
  assert.match(branches.stdout, /main/);
  assert.match(branches.stdout, new RegExp(domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  if (full) {
    const check = expectOk(await runNit(projectDir, ['remote', 'check'], opts), `agent ${id} remote check`);
    assert.match(stripAnsi(check.stdout), /Health:\s+ok/);
    if (index === 0) {
      server.defaultReadAgentId = readFileSync(join(projectDir, '.nit', 'identity', 'agent-id'), 'utf8').trim();
      expectOk(await runNit(projectDir, ['pull', '--all'], opts), `agent ${id} pull all`);
    }
    expectOk(await runNit(projectDir, ['branch', 'remote-delete.test'], opts), `agent ${id} remote delete branch create`);
    expectOk(await runNit(projectDir, ['push', '--all'], opts), `agent ${id} remote delete branch push`);
    expectOk(await runNit(projectDir, ['branch', '-D', 'remote-delete.test'], opts), `agent ${id} branch -D remote`);
  }

  const login = expectOk(await runNit(projectDir, ['sign', '--login', domain], opts), `agent ${id} login payload`);
  const payload = JSON.parse(login.stdout);
  writeJson(join(projectDir, 'login.json'), payload);
  expectOk(
    await runNit(projectDir, ['verify-login', 'login.json', '--card', 'agent-card.json', '--domain', domain], opts),
    `agent ${id} local verify-login`,
  );

  const verify = await sdk.verifyAgent(payload, {
    apiUrl: server.origin,
    policy: { max_identities_per_ip: opts.agents + 1, max_identities_per_machine: opts.agents + 1 },
  });
  assert.equal(verify.verified, true);
  assert.equal(verify.agent_id, payload.agent_id);
  assert.equal(verify.domain, domain);
  assert.equal(verify.identity.workspace_hash, workspaceHashFor(projectDir));
  assert.equal(verify.identity.runtime_provider, 'local');
  assert.equal(verify.identity.runtime_harness, 'flow-harness');

  const fetchedCard = await sdk.fetchAgentCard(payload.agent_id, domain, verify.readToken, {
    baseUrl: `${server.origin}/agent/${payload.agent_id}`,
  });
  assert.equal(fetchedCard.description, `Domain persona for ${domain} with auth`);

  return {
    index,
    projectDir,
    agentId: payload.agent_id,
    publicKey: readJson(mainCardPath).publicKey,
    solana: readJson(mainCardPath).wallet?.solana,
    evm: readJson(mainCardPath).wallet?.evm,
    workspaceHash: workspaceHashFor(projectDir),
    domain,
  };
}

async function runFullLocalFeatureChecks(projectDir, id, opts, server) {
  const cardPath = join(projectDir, 'agent-card.json');

  expectOk(await runNit(projectDir, ['status'], opts), `agent ${id} status`);
  expectOk(await runNit(projectDir, ['log'], opts), `agent ${id} log`);
  expectOk(await runNit(projectDir, ['show'], opts), `agent ${id} show`);
  expectOk(await runNit(projectDir, ['skill', 'dir', 'generated-skills'], opts), `agent ${id} skill dir set`);
  expectOk(await runNit(projectDir, ['skill', 'dir', '--reset'], opts), `agent ${id} skill dir reset`);
  expectOk(await runNit(projectDir, ['skill', 'refresh', '--source', 'embedded'], opts), `agent ${id} skill refresh embedded`);

  const card = readJson(cardPath);
  card.description = `${card.description} diff-reset`;
  writeJson(cardPath, card);
  const diff = expectOk(await runNit(projectDir, ['diff'], opts), `agent ${id} diff`);
  assert.match(stripAnsi(diff.stdout), /description/);
  expectOk(await runNit(projectDir, ['reset'], opts), `agent ${id} reset`);

  const sign = expectOk(await runNit(projectDir, ['sign', `message-${id}`], opts), `agent ${id} sign`);
  assert.match(sign.stdout.trim(), /^[A-Za-z0-9+/]+={0,2}$/);

  expectOk(await runNit(projectDir, ['rpc', 'set-url', 'solana', `${server.origin}/rpc/solana`], opts), `agent ${id} rpc solana`);
  expectOk(await runNit(projectDir, ['wallet'], opts), `agent ${id} wallet`);

  const signTx = expectOk(await runNit(projectDir, ['sign-tx', '--chain', 'solana', '00'], opts), `agent ${id} sign tx`);
  const tx = JSON.parse(signTx.stdout);
  assert.equal(tx.chain, 'solana');
  expectOk(await runNit(projectDir, ['broadcast', '--chain', 'solana', tx.signature], opts), `agent ${id} broadcast`);

  expectOk(await runNit(projectDir, ['remote', 'add', 'backup', server.origin], opts), `agent ${id} remote add`);
  expectOk(await runNit(projectDir, ['remote', 'backup'], opts), `agent ${id} remote show backup`);
  expectOk(await runNit(projectDir, ['branch', 'delete.test'], opts), `agent ${id} branch delete.test`);
  expectOk(await runNit(projectDir, ['branch', '-d', 'delete.test'], opts), `agent ${id} branch -d`);
  expectOk(await runNit(projectDir, ['doctor', '--remote', '--strict'], opts), `agent ${id} doctor remote strict`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(cliPath)) {
    throw new Error(`Missing ${cliPath}. Run npm run build first.`);
  }
  if (!existsSync(opts.sdkPath)) {
    throw new Error(`Missing nit-sdk build at ${opts.sdkPath}. Run npm run build in nit-sdk or pass --sdk-path.`);
  }

  const nitApi = await import(pathToFileURL(join(repoRoot, 'dist', 'index.js')).href);
  const sdk = await import(pathToFileURL(opts.sdkPath).href);
  const server = new LocalNewtypeHarness(nitApi);
  const root = opts.tmp || mkdtempSync(join(tmpdir(), 'nit-production-flow-'));
  mkdirp(root);
  const parentRuntime = mkdirp(join(root, 'parent-runtime'));

  await server.listen();
  console.log(`flow harness root: ${root}`);
  console.log(`local newtype-compatible server: ${server.origin}`);
  console.log(`agents=${opts.agents} full_agents=${opts.fullAgents} concurrency=${opts.concurrency}`);

  let passed = false;
  try {
    expectOk(await runNit(parentRuntime, ['init', '--skill-source', 'none'], opts), 'parent runtime init');
    const parentAgentId = readFileSync(join(parentRuntime, '.nit', 'identity', 'agent-id'), 'utf8').trim();

    const started = Date.now();
    const results = await mapLimit(
      Array.from({ length: opts.agents }, (_, index) => index),
      opts.concurrency,
      (index) => runAgentFlow(index, { opts, server, sdk, root, parentRuntime }),
    );

    const ids = new Set(results.map((r) => r.agentId));
    const keys = new Set(results.map((r) => r.publicKey));
    const sol = new Set(results.map((r) => r.solana));
    const evm = new Set(results.map((r) => r.evm));
    const workspaces = new Set(results.map((r) => r.workspaceHash));

    assert.equal(ids.size, opts.agents, 'agent_id collision detected');
    assert.equal(keys.size, opts.agents, 'public key collision detected');
    assert.equal(sol.size, opts.agents, 'solana wallet collision detected');
    assert.equal(evm.size, opts.agents, 'evm wallet collision detected');
    assert.equal(workspaces.size, opts.agents, 'workspace hash collision detected');
    assert.equal(ids.has(parentAgentId), false, 'child runtime inherited parent identity');
    assert.equal(server.identities.size, opts.agents, 'server registered wrong identity count');

    if (opts.agents > 1) {
      const first = results[0];
      const policyCheck = await sdk.verifyAgent(
        JSON.parse(readFileSync(join(first.projectDir, 'login.json'), 'utf8')),
        { apiUrl: server.origin, policy: { max_identities_per_machine: 1 } },
      );
      assert.equal(policyCheck.verified, true);
      assert.equal(policyCheck.admitted, false);
      assert.ok(policyCheck.identity.machine_identity_count >= opts.agents);
    }

    const elapsed = ((Date.now() - started) / 1000).toFixed(2);
    console.log(`passed: ${opts.agents} isolated agents in ${elapsed}s`);
    console.log(`registered identities: ${server.identities.size}`);
    console.log(`pushed branches: ${server.branches.size}`);
    console.log(`push signals: ${server.pushSignals.length}`);
    passed = true;
    console.log(`workspace root: ${opts.keep ? root : '(cleaned)'}`);
  } finally {
    await server.close();
    if (!opts.keep && passed) {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err?.stack || err?.message || String(err));
    process.exit(1);
  });
}
