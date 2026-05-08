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
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const defaultWorkerRoot = resolve(repoRoot, '..', 'newtype-ai', 'worker');
const defaultSdkPath = resolve(repoRoot, '..', 'nit-sdk', 'dist', 'index.js');

function parseArgs(argv) {
  const opts = {
    keep: false,
    sdkPath: defaultSdkPath,
    workerRoot: defaultWorkerRoot,
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
    else if (arg === '--worker-root') opts.workerRoot = resolve(next());
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
  console.log(`Usage: node tests/harness/newtype-worker-flow-harness.mjs [options]

Options:
  --worker-root <path>  Path to newtype-ai/worker
  --sdk-path <path>     Path to @newtype-ai/nit-sdk dist/index.js
  --tmp <path>          Workspace root. Default: mktemp under OS tmp
  --timeout-ms <n>      Per-command timeout. Default: 30000
  --keep                Keep generated folders after the run`);
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

async function bundleWorker(workerRoot, outdir) {
  const esbuildPath = join(workerRoot, 'node_modules', 'esbuild', 'lib', 'main.js');
  if (!existsSync(esbuildPath)) {
    throw new Error(`Missing esbuild in ${workerRoot}. Run npm install in newtype-ai/worker.`);
  }
  const { build } = await import(pathToFileURL(esbuildPath).href);
  const outfile = join(outdir, 'newtype-worker.mjs');
  await build({
    entryPoints: [join(workerRoot, 'src', 'index.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
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
  return { bin, npmCache };
}

function runNit(bin, cwd, args, opts, env) {
  return runCommand(bin, args, {
    cwd,
    env,
    timeoutMs: opts.commandTimeoutMs,
  });
}

class MemoryKV {
  constructor() {
    this.store = new Map();
  }
  async get(key) {
    return this.store.get(key) ?? null;
  }
  async put(key, value) {
    this.store.set(key, String(value));
  }
  async delete(key) {
    this.store.delete(key);
  }
  async list(options = {}) {
    const prefix = options.prefix ?? '';
    const keys = [...this.store.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort()
      .map((name) => ({ name }));
    return { keys, list_complete: true };
  }
}

class MemoryD1 {
  constructor() {
    this.identities = new Map();
    this.identitySignals = new Set();
    this.loginDomains = new Set();
    this.pushSignals = [];
    this.auditLog = [];
  }
  prepare(sql) {
    return new MemoryD1Statement(this, sql);
  }
  async batch(statements) {
    const results = [];
    for (const statement of statements) {
      results.push(await statement.run());
    }
    return results;
  }
}

class MemoryD1Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.replace(/\s+/g, ' ').trim();
    this.args = [];
  }
  bind(...args) {
    this.args = args;
    return this;
  }
  async run() {
    const sql = this.sql;
    if (sql.startsWith('INSERT INTO identities ')) {
      const [agentId, publicKey, machineHash, regIpHash, regTimestamp] = this.args;
      if (this.db.identities.has(agentId)) return { meta: { changes: 0 } };
      this.db.identities.set(agentId, {
        agent_id: agentId,
        public_key: publicKey,
        machine_hash: machineHash,
        reg_ip_hash: regIpHash,
        reg_timestamp: regTimestamp,
        login_count: 0,
        last_login_ts: null,
        last_push_ip_hash: null,
        last_push_country: null,
        last_push_asn: null,
        last_push_tls: null,
        platform: null,
        hostname_hash: null,
        workspace_hash: null,
        runtime_provider: null,
        runtime_model: null,
        runtime_harness: null,
        runtime_declared_at: null,
      });
      return { meta: { changes: 1 } };
    }

    if (sql.startsWith('INSERT INTO identity_signals ')) {
      const [signalHash, agentId] = this.args;
      const signalType = sql.includes("VALUES ('machine'") ? 'machine' : 'ip';
      const before = this.db.identitySignals.size;
      this.db.identitySignals.add(`${signalType}:${signalHash}:${agentId}`);
      return { meta: { changes: this.db.identitySignals.size === before ? 0 : 1 } };
    }

    if (sql.startsWith('INSERT INTO audit_log ')) {
      const [agentId, ipHash, detail] = this.args;
      this.db.auditLog.push({ agent_id: agentId, ip_hash: ipHash, detail });
      return { meta: { changes: 1 } };
    }

    if (sql.startsWith('UPDATE identities SET last_push_ip_hash')) {
      const hasRuntime = sql.includes('runtime_provider');
      const row = this.db.identities.get(this.args.at(-1));
      if (!row) return { meta: { changes: 0 } };
      row.last_push_ip_hash = this.args[0];
      row.last_push_country = this.args[1];
      row.last_push_asn = this.args[2];
      row.last_push_tls = this.args[3];
      row.platform = this.args[4];
      row.hostname_hash = this.args[5];
      row.workspace_hash = this.args[6];
      if (hasRuntime) {
        row.runtime_provider = this.args[7];
        row.runtime_model = this.args[8];
        row.runtime_harness = this.args[9];
        row.runtime_declared_at = this.args[10];
      }
      return { meta: { changes: 1 } };
    }

    if (sql.startsWith('INSERT INTO push_signals ')) {
      const [
        agentId,
        ipHash,
        country,
        asn,
        tlsVersion,
        tlsCipher,
        platform,
        hostnameHash,
        workspaceHash,
        clientVersion,
        runtimeProvider,
        runtimeModel,
        runtimeHarness,
      ] = this.args;
      this.db.pushSignals.push({
        agent_id: agentId,
        ip_hash: ipHash,
        country,
        asn,
        tls_version: tlsVersion,
        tls_cipher: tlsCipher,
        platform,
        hostname_hash: hostnameHash,
        workspace_hash: workspaceHash,
        client_version: clientVersion,
        runtime_provider: runtimeProvider,
        runtime_model: runtimeModel,
        runtime_harness: runtimeHarness,
      });
      return { meta: { changes: 1 } };
    }

    if (sql.startsWith('UPDATE identities SET login_count')) {
      const [lastLoginTs, agentId] = this.args;
      const row = this.db.identities.get(agentId);
      if (!row) return { meta: { changes: 0 } };
      row.login_count += 1;
      row.last_login_ts = lastLoginTs;
      return { meta: { changes: 1 } };
    }

    if (sql.startsWith('INSERT INTO login_domains ')) {
      const [agentId, domain] = this.args;
      const before = this.db.loginDomains.size;
      this.db.loginDomains.add(`${agentId}:${domain}`);
      return { meta: { changes: this.db.loginDomains.size === before ? 0 : 1 } };
    }

    throw new Error(`Unhandled D1 run SQL: ${sql}`);
  }
  async first() {
    const sql = this.sql;
    if (!sql.startsWith('SELECT i.*,')) {
      throw new Error(`Unhandled D1 first SQL: ${sql}`);
    }
    const [agentId] = this.args;
    const row = this.db.identities.get(agentId);
    if (!row) return null;
    const machineIdentityCount = row.machine_hash
      ? [...this.db.identities.values()].filter((item) => item.machine_hash === row.machine_hash).length
      : 0;
    const ipIdentityCount = [...this.db.identitySignals]
      .filter((item) => item.startsWith(`ip:${row.reg_ip_hash}:`)).length;
    const agentPushes = this.db.pushSignals.filter((item) => item.agent_id === agentId);
    return {
      ...row,
      machine_identity_count: machineIdentityCount,
      ip_identity_count: ipIdentityCount,
      unique_domains: [...this.db.loginDomains].filter((item) => item.startsWith(`${agentId}:`)).length,
      unique_push_ips: new Set(agentPushes.map((item) => item.ip_hash)).size,
      total_pushes: agentPushes.length,
      distinct_runtime_providers: new Set(agentPushes.map((item) => item.runtime_provider).filter(Boolean)).size,
    };
  }
}

class WorkerServer {
  constructor(app, env) {
    this.app = app;
    this.env = env;
    this.server = null;
    this.origin = '';
    this.defaultReadAgentId = '';
  }
  async listen() {
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        const body = JSON.stringify({ error: err.message || 'Internal server error' });
        res.writeHead(err.status || 500, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(body),
        });
        res.end(body);
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
    const incoming = new URL(req.url ?? '/', this.origin || 'http://127.0.0.1');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyBuffer = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, item);
      } else if (value !== undefined) {
        headers.set(key, value);
      }
    }

    let workerPath = incoming.pathname + incoming.search;
    let host = 'api.newtype-ai.org';
    const agentRoute = incoming.pathname.match(/^\/agent\/([^/]+)(\/\.well-known\/agent-card\.json)$/);
    if (agentRoute) {
      const agentId = decodeURIComponent(agentRoute[1]);
      host = `agent-${agentId}.newtype-ai.org`;
      workerPath = `${agentRoute[2]}${incoming.search}`;
    } else if (incoming.pathname === '/.well-known/agent-card.json') {
      if (!this.defaultReadAgentId) {
        throw Object.assign(new Error('defaultReadAgentId is not set'), { status: 404 });
      }
      host = `agent-${this.defaultReadAgentId}.newtype-ai.org`;
    }

    headers.set('host', host);
    if (!headers.has('cf-connecting-ip')) {
      const agentId = headers.get('x-nit-agent-id');
      const ipSeed = agentId ? Number.parseInt(sha256(agentId).slice(0, 6), 16) : 1;
      headers.set('cf-connecting-ip', `10.${(ipSeed >> 16) & 255}.${(ipSeed >> 8) & 255}.${ipSeed & 255}`);
    }

    const request = new Request(`http://${host}${workerPath}`, {
      method: req.method,
      headers,
      body: bodyBuffer.length > 0 ? bodyBuffer : undefined,
    });
    const response = await this.app.fetch(request, this.env, {
      waitUntil() {},
      passThroughOnException() {},
    });
    const outHeaders = {};
    response.headers.forEach((value, key) => {
      outHeaders[key] = value;
    });
    const responseBody = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, outHeaders);
    res.end(responseBody);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(opts.sdkPath)) {
    throw new Error(`Missing nit-sdk build at ${opts.sdkPath}. Run npm run build in ../nit-sdk first.`);
  }
  if (!existsSync(join(opts.workerRoot, 'src', 'index.ts'))) {
    throw new Error(`Missing newtype worker at ${opts.workerRoot}`);
  }

  const root = opts.tmp || mkdtempSync(join(tmpdir(), 'nit-newtype-worker-flow-'));
  mkdirp(root);
  const env = {
    ...process.env,
    HOME: mkdirp(join(root, 'home')),
    NIT_NO_AUTO_UPDATE: '1',
    CI: 'true',
  };

  const workerModule = await bundleWorker(opts.workerRoot, root);
  const sdk = await import(pathToFileURL(opts.sdkPath).href);
  const install = await installPackedNit(root, opts);
  env.NPM_CONFIG_CACHE = install.npmCache;
  env.npm_config_cache = install.npmCache;

  const bindings = {
    AGENT_BRANCHES: new MemoryKV(),
    DB: new MemoryD1(),
    CHALLENGE_SECRET: 'local-challenge-secret',
    READ_TOKEN_SECRET: 'local-read-token-secret',
    SERVER_PUBLIC_KEY: 'ed25519:aWN+o+D1R07aekui6wjVgQULw9ykscuPIk8KQeWpQDM=',
    ASSETS: { fetch: async () => new Response('Not found', { status: 404 }) },
  };
  const server = new WorkerServer(workerModule.default, bindings);
  await server.listen();

  let passed = false;
  console.log(`newtype worker harness root: ${root}`);
  console.log(`worker root: ${opts.workerRoot}`);
  console.log(`installed nit bin: ${install.bin}`);
  console.log(`local actual-worker server: ${server.origin}`);

  try {
    const projectDir = mkdirp(join(root, 'real-user', 'claude-code-project'));
    mkdirp(join(projectDir, '.claude', 'skills'));
    expectFail(await runNit(install.bin, projectDir, ['status'], opts, env), /Not a nit workspace/, 'status before init');

    const init = expectOk(await runNit(install.bin, projectDir, ['init', '--skill-source', 'none'], opts, env), 'nit init');
    assert.match(stripAnsi(init.stdout), /welcome (the ~[\d,]+th|a new) nit!/);
    const agentId = readFileSync(join(projectDir, '.nit', 'identity', 'agent-id'), 'utf8').trim();

    expectOk(await runNit(install.bin, projectDir, ['remote', 'set-url', 'origin', server.origin], opts, env), 'remote set-url');
    expectOk(await runNit(install.bin, projectDir, ['runtime', 'set', 'claude', 'sonnet-4', 'claude-code'], opts, env), 'runtime set');
    const cardPath = join(projectDir, 'agent-card.json');
    const mainCard = readJson(cardPath);
    mainCard.name = 'actual-newtype-worker-agent';
    mainCard.description = 'Actual newtype-ai worker integration main card';
    writeJson(cardPath, mainCard);
    expectOk(await runNit(install.bin, projectDir, ['commit', '-m', 'main card'], opts, env), 'commit main');

    const domain = 'worker-flow.test';
    expectOk(await runNit(install.bin, projectDir, ['branch', domain], opts, env), 'branch domain');
    expectOk(await runNit(install.bin, projectDir, ['checkout', domain], opts, env), 'checkout domain');
    const domainCard = readJson(cardPath);
    domainCard.description = 'Actual newtype-ai worker integration domain card';
    writeJson(cardPath, domainCard);
    expectOk(await runNit(install.bin, projectDir, ['commit', '-m', 'domain card'], opts, env), 'commit domain');
    expectOk(await runNit(install.bin, projectDir, ['push', '--all'], opts, env), 'push all');

    assert.equal(await bindings.AGENT_BRANCHES.get(`${agentId}:main:pubkey`), mainCard.publicKey);
    assert.notEqual(await bindings.AGENT_BRANCHES.get(`${agentId}:main`), null);
    assert.notEqual(await bindings.AGENT_BRANCHES.get(`${agentId}:${domain}`), null);
    assert.equal(bindings.DB.identities.size, 1);

    const branches = expectOk(await runNit(install.bin, projectDir, ['remote', 'branches'], opts, env), 'remote branches');
    assert.match(branches.stdout, /main/);
    assert.match(branches.stdout, new RegExp(domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    server.defaultReadAgentId = agentId;
    expectOk(await runNit(install.bin, projectDir, ['pull', '--all'], opts, env), 'pull all via actual worker challenge flow');

    const login = expectOk(await runNit(install.bin, projectDir, ['sign', '--login', domain], opts, env), 'sign login');
    const payload = JSON.parse(login.stdout);
    writeJson(join(projectDir, 'login.json'), payload);
    expectOk(
      await runNit(install.bin, projectDir, ['verify-login', 'login.json', '--card', 'agent-card.json', '--domain', domain], opts, env),
      'local verify-login',
    );

    const verify = await sdk.verifyAgent(payload, {
      apiUrl: server.origin,
      policy: { max_identities_per_ip: 10, max_identities_per_machine: 10 },
    });
    assert.equal(verify.verified, true, JSON.stringify(verify));
    assert.equal(verify.admitted, true);
    assert.equal(verify.agent_id, agentId);
    assert.equal(verify.branch, domain);
    assert.equal(verify.card.description, 'Actual newtype-ai worker integration domain card');
    assert.equal(verify.identity.workspace_hash, workspaceHashFor(projectDir));
    assert.equal(verify.identity.runtime_provider, 'claude');
    assert.equal(verify.identity.runtime_harness, 'claude-code');

    const fetched = await sdk.fetchAgentCard(agentId, domain, verify.readToken, {
      baseUrl: `${server.origin}/agent/${agentId}`,
    });
    assert.equal(fetched.description, 'Actual newtype-ai worker integration domain card');

    const replay = await sdk.verifyAgent({ ...payload, domain: 'other.test' }, { apiUrl: server.origin });
    assert.equal(replay.verified, false);
    assert.match(replay.error, /HTTP 403/);

    expectOk(await runNit(install.bin, projectDir, ['checkout', 'main'], opts, env), 'checkout main before delete');
    expectOk(await runNit(install.bin, projectDir, ['branch', '-D', domain], opts, env), 'delete remote domain branch');
    assert.equal(await bindings.AGENT_BRANCHES.get(`${agentId}:${domain}`), null);

    passed = true;
    console.log('passed actual newtype-ai worker flow');
    console.log(`agent: ${agentId}`);
    console.log(`identity rows: ${bindings.DB.identities.size}`);
    console.log(`push signals: ${bindings.DB.pushSignals.length}`);
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
