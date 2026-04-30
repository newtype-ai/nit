#!/usr/bin/env node
// ---------------------------------------------------------------------------
// nit — CLI entry point
//
// Usage: nit <command> [options]
// ---------------------------------------------------------------------------

import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import {
  init,
  status,
  commit,
  log,
  diff,
  branch,
  branchDelete,
  checkout,
  push,
  remote,
  remoteBranches,
  remoteCheck,
  remoteAdd,
  remoteSetUrl,
  sign,
  loginPayload,
  signTx,
  broadcast,
  rpcSetUrl,
  rpcInfo,
  runtimeSet,
  runtimeShow,
  runtimeUnset,
  authSet,
  authShow,
  reset,
  show,
  pull,
  verifyLoginPayload,
  skillRefresh,
  findNitDir,
} from './index.js';
import type { AuthProvider, NitSkillSource } from './types.js';
import { formatDiff } from './diff.js';
import { autoUpdate, version as nitVersion } from './update-check.js';
import { loadMachineHash } from './fingerprint.js';

// ANSI color helpers
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function main() {
  const [, , command, ...args] = process.argv;
  const skipUpdateCommands = new Set(['help', 'doctor', 'verify-login', '--help', '-h', '--version', '-v', undefined]);
  if (!skipUpdateCommands.has(command)) {
    // Auto-update before running mutating/network commands (CLI only, never library)
    await autoUpdate();
  }

  try {
    switch (command) {
      case 'init':
        await cmdInit(args);
        break;
      case 'status':
        await cmdStatus();
        break;
      case 'commit':
        await cmdCommit(args);
        break;
      case 'log':
        await cmdLog();
        break;
      case 'diff':
        await cmdDiff(args);
        break;
      case 'branch':
        await cmdBranch(args);
        break;
      case 'checkout':
        await cmdCheckout(args);
        break;
      case 'push':
        await cmdPush(args);
        break;
      case 'sign':
        await cmdSign(args);
        break;
      case 'remote':
        await cmdRemote(args);
        break;
      case 'sign-tx':
        await cmdSignTx(args);
        break;
      case 'broadcast':
        await cmdBroadcast(args);
        break;
      case 'rpc':
        await cmdRpc(args);
        break;
      case 'runtime':
        await cmdRuntime(args);
        break;
      case 'auth':
        await cmdAuth(args);
        break;
      case 'skill':
        await cmdSkill(args);
        break;
      case 'wallet':
        await cmdWallet();
        break;
      case 'reset':
        await cmdReset(args);
        break;
      case 'show':
        await cmdShow(args);
        break;
      case 'pull':
        await cmdPull(args);
        break;
      case 'verify-login':
        await cmdVerifyLogin(args);
        break;
      case 'doctor':
        await cmdDoctor(args);
        break;
      case 'help':
      case '--help':
      case '-h':
      case undefined:
        printUsage();
        break;
      case '--version':
      case '-v':
        break; // version printed below via update check
      default:
        console.error(`nit: '${command}' is not a nit command. See 'nit help'.`);
        process.exit(1);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(red(`error: ${msg}`));
    process.exit(1);
  }

  // Version command
  if (command === '--version' || command === '-v') {
    console.log(`nit ${nitVersion}`);
  }

}

// ---------------------------------------------------------------------------
// Command implementations
// ---------------------------------------------------------------------------

declare const __NIT_INSTALL_COUNT__: number;

function parseNitSkillSource(value: string): NitSkillSource {
  if (value === 'newtype' || value === 'url' || value === 'embedded' || value === 'none') {
    return value;
  }
  throw new Error('nit skill source must be one of: newtype, url, embedded, none');
}

function parseSkillOptions(
  args: string[],
  names: { source: string; url: string },
): { skillSource?: NitSkillSource; skillUrl?: string } {
  let skillSource: NitSkillSource | undefined;
  let skillUrl: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === names.source) {
      if (!args[i + 1]) {
        throw new Error(`Missing value for ${names.source}`);
      }
      skillSource = parseNitSkillSource(args[++i]);
    } else if (arg === names.url) {
      if (!args[i + 1]) {
        throw new Error(`Missing value for ${names.url}`);
      }
      skillUrl = args[++i];
    } else {
      throw new Error(`Unknown flag: ${arg}`);
    }
  }

  return { skillSource, skillUrl };
}

function parseRemoteFlag(
  args: string[],
  usage: string,
): { remoteName?: string; rest: string[] } {
  let remoteName: string | undefined;
  const rest: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--remote') {
      if (!args[i + 1]) {
        console.error(`Missing value for --remote. ${usage}`);
        process.exit(1);
      }
      remoteName = args[++i];
    } else {
      rest.push(arg);
    }
  }

  return { remoteName, rest };
}

async function cmdInit(args: string[]) {
  const skillOptions = parseSkillOptions(args, {
    source: '--skill-source',
    url: '--skill-url',
  });
  const result = await init(skillOptions);

  console.log();
  console.log(dim('  _   _                 _____'));
  console.log(dim(' | \\ |"|       ___     |_ " _|'));
  console.log(dim('<|  \\| |>     |_"_|      | |'));
  console.log(dim('U| |\\  |u      | |      /| |\\'));
  console.log(dim(' |_| \\_|     U/| |\\u   u |_|U'));
  console.log(dim(' ||   \\\\,-.-,_|___|_,-._// \\\\_'));
  console.log(dim(' (_")  (_/ \\_)-\' \'-(_/(__) (__)'));
  console.log();
  const count = typeof __NIT_INSTALL_COUNT__ === 'number' && __NIT_INSTALL_COUNT__ > 0
    ? `the ~${__NIT_INSTALL_COUNT__.toLocaleString()}th`
    : 'a new';
  console.log(bold(`welcome ${count} nit!`));
  console.log();
  console.log(`  Agent ID:    ${green(result.agentId)}`);
  console.log(`  Public key:  ${dim(result.publicKey)}`);
  console.log(`  Card URL:    ${result.cardUrl}`);
  console.log();
  console.log(`  ${bold('Chain addresses:')}`);
  console.log(`    Solana:    ${result.walletAddresses.solana}`);
  console.log(`    Ethereum:  ${result.walletAddresses.ethereum}`);
  console.log();
  console.log(`  Skills dir:  ${dim(result.skillsDir)}`);
  if (result.skillsFound.length > 0) {
    console.log(`  Skills:      ${result.skillsFound.join(', ')}`);
  } else {
    console.log(`  Skills:      ${dim('(none discovered)')}`);
  }
  console.log();
  console.log(`  nit skill:   ${result.nitSkillPath ? dim(result.nitSkillPath) : dim('(not installed)')}`);
  console.log(`  Skill source:${dim(` ${result.nitSkillSource}${result.nitSkillUrl ? ` (${result.nitSkillUrl})` : ''}`)}`);
  console.log();
  console.log(dim('Created .nit/ with initial commit on main.'));
  console.log();
  if (result.nitSkillPath) {
    console.log(`IMPORTANT: Read the nit skill file for complete usage instructions:`);
    console.log(`  cat ${result.nitSkillPath}`);
  }
}

async function cmdStatus() {
  const s = await status();

  console.log(`On branch ${bold(s.branch)}`);
  console.log();
  console.log(`  Agent ID:    ${green(s.agentId)}`);
  console.log(`  Public key:  ${dim(s.publicKey)}`);
  console.log(`  Card URL:    ${s.cardUrl}`);
  console.log();
  const nitDir = findNitDir();
  const machineHash = await loadMachineHash(nitDir);
  if (machineHash) {
    console.log(`  Machine:     ${dim(machineHash.slice(0, 16) + '...')}`);
  }
  console.log();
  console.log(`  ${bold('Chain addresses:')}`);
  console.log(`    Solana:    ${s.walletAddresses.solana}`);
  console.log(`    Ethereum:  ${s.walletAddresses.ethereum}`);
  console.log();

  if (s.uncommittedChanges) {
    console.log(yellow('Uncommitted changes:'));
    console.log(formatDiff(s.uncommittedChanges));
    console.log();
  } else {
    console.log(green('Working card clean.'));
    console.log();
  }

  if (s.branches.length > 0) {
    for (const b of s.branches) {
      const marker = b.name === s.branch ? '* ' : '  ';
      const ahead = b.ahead > 0 ? yellow(` [ahead ${b.ahead}]`) : '';
      console.log(`${marker}${b.name}${ahead}`);
    }
  }
}

async function cmdCommit(args: string[]) {
  let message = '';

  const mIndex = args.indexOf('-m');
  if (mIndex !== -1 && args[mIndex + 1]) {
    message = args[mIndex + 1];
  } else {
    console.error('Usage: nit commit -m "message"');
    process.exit(1);
  }

  const c = await commit(message);
  console.log(
    `${dim(`[${c.hash.slice(0, 8)}]`)} ${c.message}`,
  );
}

async function cmdLog() {
  const commits = await log();

  for (const c of commits) {
    const date = new Date(c.timestamp * 1000).toISOString().slice(0, 19);
    console.log(
      `${yellow(c.hash.slice(0, 8))} ${c.message} ${dim(`(${c.author}, ${date})`)}`,
    );
  }

  if (commits.length === 0) {
    console.log(dim('No commits yet.'));
  }
}

async function cmdDiff(args: string[]) {
  const target = args[0];
  const d = await diff(target);
  console.log(formatDiff(d));
}

async function cmdBranch(args: string[]) {
  // nit branch -d <name>  → delete local branch
  // nit branch -D <name>  → delete local + remote branch
  if (args[0] === '-d' || args[0] === '-D') {
    const name = args[1];
    if (!name) {
      console.error(`Usage: nit branch ${args[0]} <name> [--remote <name>]`);
      process.exit(1);
    }
    const deleteRemote = args[0] === '-D';
    const { remoteName, rest } = parseRemoteFlag(
      args.slice(2),
      `Usage: nit branch ${args[0]} <name> [--remote <name>]`,
    );
    if (rest.length > 0) {
      console.error(`Unknown argument: ${rest[0]}`);
      console.error(`Usage: nit branch ${args[0]} <name> [--remote <name>]`);
      process.exit(1);
    }
    if (!deleteRemote && remoteName) {
      console.error('--remote is only valid with nit branch -D');
      process.exit(1);
    }
    await branchDelete(name, { remote: deleteRemote, remoteName });
    console.log(`Deleted branch '${name}'${deleteRemote ? ` (local + ${remoteName ?? 'origin'})` : ''}`);
    return;
  }

  // Reject flags that aren't branch names
  const name = args[0];
  if (name?.startsWith('-')) {
    console.error(`Unknown flag: ${name}`);
    console.error('Usage: nit branch [name] | nit branch -d <name> | nit branch -D <name>');
    process.exit(1);
  }

  const branches = await branch(name);

  if (name) {
    console.log(`Branch '${green(name)}' created.`);
  }

  // Always list branches
  let currentBranch: string;
  try {
    const s = await status();
    currentBranch = s.branch;
  } catch {
    currentBranch = '';
  }

  for (const b of branches) {
    if (b.name === currentBranch) {
      console.log(`* ${green(b.name)}`);
    } else {
      console.log(`  ${b.name}`);
    }
  }
}

async function cmdCheckout(args: string[]) {
  const branchName = args[0];
  if (!branchName) {
    console.error('Usage: nit checkout <branch>');
    process.exit(1);
  }

  const result = await checkout(branchName);
  if (result.autoCommitted) {
    console.log(dim('Auto-committed changes on current branch'));
  }
  console.log(`Switched to branch '${green(branchName)}'.`);
}

async function cmdPush(args: string[]) {
  const { remoteName, rest } = parseRemoteFlag(args, 'Usage: nit push [--all] [--remote <name>]');
  let all = false;
  for (const arg of rest) {
    if (arg === '--all') {
      all = true;
    } else {
      console.error(`Unknown flag: ${arg}`);
      console.error('Usage: nit push [--all] [--remote <name>]');
      process.exit(1);
    }
  }
  const results = await push({ all, remoteName });
  let failed = false;

  for (const r of results) {
    if (r.success) {
      console.log(`${green('✓')} ${r.branch} → ${r.remoteUrl}`);
    } else {
      failed = true;
      console.log(`${red('✗')} ${r.branch}: ${r.error}`);
    }
  }

  if (failed) {
    process.exit(1);
  }
}

async function cmdRemote(args: string[]) {
  const subcommand = args[0];

  if (subcommand === 'set-url') {
    const name = args[1];
    const url = args[2];
    if (!name || !url) {
      console.error('Usage: nit remote set-url <name> <url>');
      process.exit(1);
    }
    await remoteSetUrl(name, url);
    console.log(`Set URL for '${name}' to ${url}`);
    return;
  }

  if (subcommand === 'add') {
    const name = args[1];
    const url = args[2];
    if (!name || !url) {
      console.error('Usage: nit remote add <name> <url>');
      process.exit(1);
    }
    await remoteAdd(name, url);
    console.log(`Added remote '${green(name)}' → ${url}`);
    return;
  }

  if (subcommand === 'branches') {
    const remoteName = args[1];
    if (args.length > 2) {
      console.error('Usage: nit remote branches [name]');
      process.exit(1);
    }
    const branches = await remoteBranches({ remoteName });
    for (const branchName of branches) {
      console.log(branchName);
    }
    return;
  }

  if (subcommand === 'check') {
    const remoteName = args[1];
    if (args.length > 2) {
      console.error('Usage: nit remote check [name]');
      process.exit(1);
    }
    const result = await remoteCheck({ remoteName });
    console.log(`${bold(result.name)}`);
    console.log(`  URL:        ${result.url}`);

    if (result.health.ok) {
      const detail = result.health.optional
        ? `HTTP ${result.health.status} (/health optional)`
        : `HTTP ${result.health.status}`;
      console.log(`  Health:     ${green('ok')} ${dim(detail)}`);
    } else {
      const detail = result.health.error ?? `HTTP ${result.health.status ?? 'unknown'}`;
      console.log(`  Health:     ${yellow('warn')} ${dim(detail)}`);
    }

    if (result.branches.ok) {
      console.log(`  Branches:   ${green('ok')} ${dim(`${result.branches.names.length} found`)}`);
      for (const branchName of result.branches.names) {
        console.log(`    ${branchName}`);
      }
    } else {
      console.log(`  Branches:   ${red('fail')} ${dim(result.branches.error ?? 'unknown error')}`);
      process.exit(1);
    }
    return;
  }

  if (subcommand) {
    if (args.length > 1) {
      console.error(`nit remote: unknown subcommand '${subcommand}'`);
      console.error('Usage: nit remote [name | branches [name] | check [name] | set-url <name> <url> | add <name> <url>]');
      process.exit(1);
    }
    const info = await remote({ remoteName: subcommand });
    console.log(`${bold(info.name)}`);
    console.log(`  URL:        ${info.url}`);
    console.log(`  Agent ID:   ${info.agentId}`);
    console.log(`  Auth:       ${green('Ed25519 keypair')}`);
    return;
  }

  // Default: show remote info
  const info = await remote();

  console.log(`${bold(info.name)}`);
  console.log(`  URL:        ${info.url}`);
  console.log(`  Agent ID:   ${info.agentId}`);
  console.log(`  Auth:       ${green('Ed25519 keypair')}`);
}

async function cmdSign(args: string[]) {
  // nit sign --login <domain>
  const loginIndex = args.indexOf('--login');
  if (loginIndex !== -1) {
    const domain = args[loginIndex + 1];
    if (!domain) {
      console.error('Usage: nit sign --login <domain>');
      process.exit(1);
    }
    const payload = await loginPayload(domain);
    if (payload.autoInitialized) {
      console.error(dim('Auto-initialized nit identity'));
      console.error(`  Agent ID: ${green(payload.agent_id)}`);
    }
    if (payload.autoPushed) {
      console.error(dim('Pushed main branch to remote'));
    }
    if (payload.switchedBranch) {
      console.error(`Switched to branch '${payload.switchedBranch}'`);
    }
    if (payload.createdSkill) {
      console.error(`Created skill template '${payload.createdSkill}'`);
    }
    const { switchedBranch: _s, createdSkill: _c, autoInitialized: _ai, autoPushed: _ap, ...output } = payload;
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // nit sign "message"
  const message = args[0];
  if (!message) {
    console.error('Usage: nit sign "message"');
    console.error('       nit sign --login <domain>');
    process.exit(1);
  }

  const signature = await sign(message);
  console.log(signature);
}

async function cmdSignTx(args: string[]) {
  const chainIndex = args.indexOf('--chain');
  if (chainIndex === -1 || !args[chainIndex + 1]) {
    console.error('Usage: nit sign-tx --chain <evm|solana> <hex-data>');
    process.exit(1);
  }
  const chain = args[chainIndex + 1] as 'evm' | 'solana';
  if (chain !== 'evm' && chain !== 'solana') {
    console.error(`Unknown chain: ${chain}. Use 'evm' or 'solana'.`);
    process.exit(1);
  }

  // Data is the remaining arg (not --chain or its value)
  const data = args.filter((_, i) => i !== chainIndex && i !== chainIndex + 1)[0];
  if (!data) {
    console.error('Usage: nit sign-tx --chain <evm|solana> <hex-data>');
    process.exit(1);
  }

  const result = await signTx(chain, data);
  console.log(JSON.stringify(result, null, 2));
}

async function cmdVerifyLogin(args: string[]) {
  const payloadPath = args[0];
  if (!payloadPath) {
    console.error('Usage: nit verify-login <payload.json|-> [--card agent-card.json] [--domain <domain>] [--max-age <seconds>]');
    process.exit(1);
  }

  let cardPath = 'agent-card.json';
  let expectedDomain: string | undefined;
  let maxAgeSeconds: number | undefined;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--card') {
      if (!args[i + 1]) {
        console.error('Missing value for --card');
        process.exit(1);
      }
      cardPath = args[++i];
    } else if (arg === '--domain') {
      if (!args[i + 1]) {
        console.error('Missing value for --domain');
        process.exit(1);
      }
      expectedDomain = args[++i];
    } else if (arg === '--max-age') {
      if (!args[i + 1]) {
        console.error('Missing value for --max-age');
        process.exit(1);
      }
      maxAgeSeconds = Number(args[++i]);
      if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds < 0) {
        console.error('--max-age must be a non-negative number of seconds');
        process.exit(1);
      }
    } else {
      console.error(`Unknown flag: ${arg}`);
      console.error('Usage: nit verify-login <payload.json|-> [--card agent-card.json] [--domain <domain>] [--max-age <seconds>]');
      process.exit(1);
    }
  }

  const payloadRaw = payloadPath === '-'
    ? await readStdin()
    : await fs.readFile(payloadPath, 'utf-8');
  const cardRaw = await fs.readFile(cardPath, 'utf-8');
  const payload = JSON.parse(payloadRaw) as unknown;
  const card = JSON.parse(cardRaw) as unknown;

  const result = verifyLoginPayload(payload, card, { expectedDomain, maxAgeSeconds });
  console.log(JSON.stringify(result, null, 2));
  if (!result.verified) {
    process.exit(1);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function cmdBroadcast(args: string[]) {
  const chainIndex = args.indexOf('--chain');
  if (chainIndex === -1 || !args[chainIndex + 1]) {
    console.error('Usage: nit broadcast --chain <evm|solana> <signed-tx>');
    process.exit(1);
  }
  const chain = args[chainIndex + 1] as 'evm' | 'solana';
  if (chain !== 'evm' && chain !== 'solana') {
    console.error(`Unknown chain: ${chain}. Use 'evm' or 'solana'.`);
    process.exit(1);
  }

  const signedTx = args.filter((_, i) => i !== chainIndex && i !== chainIndex + 1)[0];
  if (!signedTx) {
    console.error('Usage: nit broadcast --chain <evm|solana> <signed-tx>');
    process.exit(1);
  }

  const result = await broadcast(chain, signedTx);
  console.log(`${green('+')} ${result.txHash}`);
  console.log(dim(`  → ${result.rpcUrl}`));
}

async function cmdRpc(args: string[]) {
  if (args[0] === 'set-url') {
    const chain = args[1];
    const url = args[2];
    if (!chain || !url) {
      console.error('Usage: nit rpc set-url <chain> <url>');
      process.exit(1);
    }
    await rpcSetUrl(chain, url);
    console.log(`Set RPC URL for '${chain}' to ${url}`);
    return;
  }

  if (args[0]) {
    console.error(`nit rpc: unknown subcommand '${args[0]}'`);
    console.error('Usage: nit rpc [set-url <chain> <url>]');
    process.exit(1);
  }

  // Default: show RPC endpoints
  const info = await rpcInfo();
  const chains = Object.keys(info);

  if (chains.length === 0) {
    console.log(dim('No RPC endpoints configured.'));
    console.log(dim('Run: nit rpc set-url <chain> <url>'));
    return;
  }

  for (const [chain, config] of Object.entries(info)) {
    console.log(`  ${bold(chain)}: ${config.url}`);
  }
}

async function cmdRuntime(args: string[]) {
  if (args[0] === 'set') {
    const provider = args[1];
    const model = args[2];
    const harness = args[3];
    if (!provider || !model || !harness) {
      console.error('Usage: nit runtime set <provider> <model> <harness>');
      process.exit(1);
    }
    const runtime = await runtimeSet(provider, model, harness);
    console.log(`Set runtime: ${bold(runtime.provider)} / ${runtime.model} / ${runtime.harness}`);
    console.log(dim(`  declared_at = ${runtime.declared_at}`));
    return;
  }

  if (args[0] === 'unset') {
    await runtimeUnset();
    console.log('Runtime cleared.');
    return;
  }

  if (args[0] && args[0] !== 'show') {
    console.error(`nit runtime: unknown subcommand '${args[0]}'`);
    console.error('Usage: nit runtime [set <provider> <model> <harness> | show | unset]');
    process.exit(1);
  }

  // Default / show: display current runtime
  const runtime = await runtimeShow();
  if (!runtime) {
    console.log(dim('No runtime set.'));
    console.log(dim('Run: nit runtime set <provider> <model> <harness>'));
    return;
  }
  console.log(`  ${bold('provider')}    ${runtime.provider}`);
  console.log(`  ${bold('model')}       ${runtime.model}`);
  console.log(`  ${bold('harness')}     ${runtime.harness}`);
  console.log(`  ${bold('declared_at')} ${runtime.declared_at}`);
}

async function cmdReset(args: string[]) {
  const target = args[0];
  const result = await reset(target);
  console.log(`Reset to ${dim(result.hash.slice(0, 8))}`);
}

async function cmdShow(args: string[]) {
  const target = args[0];
  const s = await show(target);

  const date = new Date(s.timestamp * 1000).toISOString().slice(0, 19);
  console.log(`${bold('commit')} ${yellow(s.hash.slice(0, 8))}`);
  console.log(`Author: ${s.author}`);
  console.log(`Date:   ${date}`);
  if (s.parent) {
    console.log(`Parent: ${dim(s.parent.slice(0, 8))}`);
  }
  console.log();
  console.log(`    ${s.message}`);
  console.log();
  console.log(JSON.stringify(s.cardJson, null, 2));
}

async function cmdPull(args: string[]) {
  const { remoteName, rest } = parseRemoteFlag(args, 'Usage: nit pull [--all] [--remote <name>]');
  let all = false;
  for (const arg of rest) {
    if (arg === '--all') {
      all = true;
    } else {
      console.error(`Unknown flag: ${arg}`);
      console.error('Usage: nit pull [--all] [--remote <name>]');
      process.exit(1);
    }
  }
  const results = await pull({ all, remoteName });

  for (const r of results) {
    if (r.error) {
      console.log(`${red('✗')} ${r.branch}: ${r.error}`);
    } else if (r.updated) {
      console.log(`${green('✓')} ${r.branch} ← ${dim(r.commitHash.slice(0, 8))}`);
    } else {
      console.log(`${dim('—')} ${r.branch} ${dim('(up to date)')}`);
    }
  }

  if (results.some((r) => r.error)) {
    process.exit(1);
  }
}

async function cmdDoctor(args: string[]) {
  const strict = args.includes('--strict');
  const checkRemote = args.includes('--remote') || args.includes('--all');
  const checkPublish = args.includes('--publish') || args.includes('--all');
  const checks: Array<{ status: 'ok' | 'warn' | 'fail'; name: string; detail: string }> = [];
  const add = (status: 'ok' | 'warn' | 'fail', name: string, detail: string) => {
    checks.push({ status, name, detail });
  };

  add('ok', 'nit version', nitVersion);

  try {
    const s = await status();
    add('ok', 'workspace', `branch ${s.branch}, agent ${s.agentId}`);
  } catch (err) {
    add('warn', 'workspace', err instanceof Error ? err.message : String(err));
  }

  try {
    const info = await remote();
    add('ok', 'remote', info.url);

    if (checkRemote) {
      const healthUrl = new URL('/health', info.url).toString();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      let res: Response;
      try {
        res = await fetch(healthUrl, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
      } finally {
        clearTimeout(timeout);
      }

      if (res.ok) {
        add('ok', 'remote health', `${healthUrl} HTTP ${res.status}`);
      } else if (res.status === 404) {
        add('warn', 'remote health', `${healthUrl} returned 404; /health is optional`);
      } else {
        add('fail', 'remote health', `${healthUrl} HTTP ${res.status}`);
      }
    }
  } catch (err) {
    add('warn', 'remote', err instanceof Error ? err.message : String(err));
  }

  if (checkPublish) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3_000);
      let res: Response;
      try {
        res = await fetch('https://registry.npmjs.org/@newtype-ai/nit/latest', {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
      } finally {
        clearTimeout(timeout);
      }
      if (res.ok) {
        const data = (await res.json()) as { version?: string };
        const latest = data.version ?? 'unknown';
        add(latest === nitVersion ? 'ok' : 'warn', 'npm latest', latest);
      } else {
        add('warn', 'npm latest', `HTTP ${res.status}`);
      }
    } catch (err) {
      add('warn', 'npm latest', err instanceof Error ? err.message : String(err));
    }

    try {
      const user = execFileSync('npm', ['whoami'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5_000,
      }).trim();
      add('ok', 'npm auth', user);
    } catch {
      add('warn', 'npm auth', 'not logged in; publish with NPM_TOKEN or npm login');
    }
  }

  console.log(bold('nit doctor'));
  console.log();
  for (const check of checks) {
    const label =
      check.status === 'ok' ? green('ok') :
      check.status === 'warn' ? yellow('warn') :
      red('fail');
    console.log(`${label.padEnd(12)} ${check.name.padEnd(12)} ${dim(check.detail)}`);
  }

  if (strict && checks.some((check) => check.status !== 'ok')) {
    process.exit(1);
  }
}

async function cmdAuth(args: string[]) {
  const subcommand = args[0];

  if (subcommand === 'set') {
    const domain = args[1];
    if (!domain) {
      console.error('Usage: nit auth set <domain> --provider <google|github|x> --account <email>');
      process.exit(1);
    }

    const providerIndex = args.indexOf('--provider');
    if (providerIndex === -1 || !args[providerIndex + 1]) {
      console.error('Missing --provider. Usage: nit auth set <domain> --provider <google|github|x> --account <email>');
      process.exit(1);
    }
    const provider = args[providerIndex + 1];
    const validProviders: AuthProvider[] = ['google', 'github', 'x'];
    if (!validProviders.includes(provider as AuthProvider)) {
      console.error(`Unknown provider: ${provider}. Use: google, github, x`);
      process.exit(1);
    }

    const accountIndex = args.indexOf('--account');
    if (accountIndex === -1 || !args[accountIndex + 1]) {
      console.error('Missing --account. Usage: nit auth set <domain> --provider <google|github|x> --account <email>');
      process.exit(1);
    }
    const account = args[accountIndex + 1];

    const result = await authSet(domain, provider as AuthProvider, account);

    if (result.createdBranch) {
      console.log(`Created branch '${green(result.branch)}'`);
    }
    if (result.switchedBranch) {
      console.log(`Switched to branch '${green(result.switchedBranch)}'`);
    }
    console.log(`${green('✓')} Auth configured for ${bold(domain)}: ${result.provider} (${result.account})`);
    console.log(dim(`  Updated SKILL.md: ${result.skillId}/SKILL.md`));
    return;
  }

  if (subcommand === 'show') {
    const domain = args[1];
    const results = await authShow(domain);

    if (results.length === 0) {
      if (domain) {
        console.log(dim(`No auth configured for '${domain}'.`));
      } else {
        console.log(dim('No branches with auth configured.'));
      }
      return;
    }

    for (const r of results) {
      if (r.auth) {
        console.log(`  ${bold(r.branch)}: ${r.auth.provider} (${r.auth.account})`);
      } else {
        console.log(`  ${bold(r.branch)}: ${dim('(no auth)')}`);
      }
    }
    return;
  }

  if (subcommand) {
    console.error(`nit auth: unknown subcommand '${subcommand}'`);
  }
  console.error('Usage: nit auth set <domain> --provider <google|github|x> --account <email>');
  console.error('       nit auth show [domain]');
  process.exit(1);
}

async function cmdSkill(args: string[]) {
  const subcommand = args[0];

  if (subcommand === 'refresh') {
    const skillOptions = parseSkillOptions(args.slice(1), {
      source: '--source',
      url: '--url',
    });
    const result = await skillRefresh(skillOptions);
    if (!result.path) {
      console.log(dim('nit skill source is disabled; existing files left untouched.'));
      return;
    }
    console.log(`${green('✓')} nit skill refreshed: ${result.path}`);
    console.log(dim(`  source = ${result.config.source}${result.config.url ? ` (${result.config.url})` : ''}`));
    if (result.contentSource !== result.config.source) {
      console.log(dim(`  content = ${result.contentSource}`));
    }
    return;
  }

  if (subcommand) {
    console.error(`nit skill: unknown subcommand '${subcommand}'`);
  }
  console.error('Usage: nit skill refresh [--source <newtype|url|embedded|none>] [--url <url>]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Chain address card display
// ---------------------------------------------------------------------------

async function cmdWallet() {
  const s = await status();
  const sol = s.walletAddresses.solana;
  const evm = s.walletAddresses.ethereum;
  const agent = s.agentId;
  const network = 'devnet';

  // Try to fetch SOL balance from Solana RPC
  let solBalance = '';
  try {
    const { readConfig: rc } = await import('./config.js');
    const nitDir = findNitDir();
    const config = await rc(nitDir);
    const rpcUrl = config.rpc?.solana?.url || 'https://api.devnet.solana.com';
    {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'getBalance', params: [sol],
        }),
      });
      const data = await res.json() as { result?: { value?: number } };
      if (data.result?.value !== undefined) {
        const lamports = data.result.value;
        solBalance = (lamports / 1_000_000_000).toFixed(4) + ' SOL';
      }
    }
  } catch { solBalance = '(unavailable)'; }

  // Build card rows: [label, value, colorFn?]
  type CardRow = [string, string, ((s: string) => string)?] | null;
  const rows: CardRow[] = [
    ['Solana', sol],
    ['EVM', evm],
    null,
    ['Agent', agent],
    ['Network', network, green],
  ];
  if (solBalance) {
    rows.splice(2, 0, ['Balance', solBalance, green]);
  }

  printCard(rows);
}

function printCard(rows: ([string, string, ((s: string) => string)?] | null)[]) {
  const labelW = 10;
  const contentLines: string[] = [];
  const plainLines: string[] = [];

  for (const row of rows) {
    if (!row) {
      contentLines.push('');
      plainLines.push('');
    } else {
      const plain = `  ${row[0].padEnd(labelW)}${row[1]}`;
      const display = row[2]
        ? `  ${row[0].padEnd(labelW)}${row[2](row[1])}`
        : plain;
      contentLines.push(display);
      plainLines.push(plain);
    }
  }

  const maxLen = Math.max(...plainLines.map(l => l.length));
  const w = maxLen + 2;

  console.log();
  console.log(`  \u250c${'─'.repeat(w)}\u2510`);
  console.log(`  \u2502${''.padEnd(w)}\u2502`);
  for (let i = 0; i < contentLines.length; i++) {
    const pad = w - plainLines[i].length;
    console.log(`  \u2502${contentLines[i]}${' '.repeat(pad)}\u2502`);
  }
  console.log(`  \u2502${''.padEnd(w)}\u2502`);
  console.log(`  \u2514${'─'.repeat(w)}\u2518`);
  console.log();
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printUsage() {
  console.log(`
${bold('nit')} — version control for agent cards

${bold('Usage:')} nit <command> [options]

${bold('Commands:')}
  init               Initialize .nit/ in current directory
  init --skill-source <newtype|embedded|none|url>
                     Choose nit SKILL.md source (default: newtype)
  init --skill-url <url>
                     Fetch nit SKILL.md from a custom URL
  status             Show identity, branch, and uncommitted changes
  commit -m "msg"    Snapshot agent-card.json
  log                Show commit history
  diff [target]      Compare card vs HEAD, branch, or commit
  branch [name]      List branches or create a new one
  branch -d <name>   Delete a local branch
  branch -D <name> [--remote <remote>]
                     Delete local + selected remote branch
  checkout <branch>  Switch branch (overwrites agent-card.json)
  push [--all] [--remote <remote>]
                     Push branch(es) to selected remote
  pull [--all] [--remote <remote>]
                     Pull branch(es) from selected remote
  doctor [--remote] [--publish] [--strict]
                     Check local setup, optional remote health, and publish auth
  reset [target]     Restore agent-card.json from HEAD or target
  show [target]      Show commit metadata and card content
  sign "message"     Sign a message with your Ed25519 key
  sign --login <dom> Switch to domain branch + generate login payload
  verify-login <p>   Verify a login payload locally
  remote             Show remote info
  remote branches [remote]
                     List branches on the selected remote
  remote check [remote]
                     Check selected remote health and signed branch listing
  remote add <n> <u> Add a new remote
  remote set-url <n> <u>  Change remote URL
  sign-tx --chain <c> <data>  Sign tx data (evm: hash, solana: message)
  broadcast --chain <c> <tx>  Send signed tx to RPC endpoint
  rpc                Show configured RPC endpoints
  rpc set-url <c> <url>  Set RPC endpoint for a chain
  runtime [show]     Show self-declared LLM runtime (provider/model/harness)
  runtime set <provider> <model> <harness>
                     Set self-declared LLM runtime (injected at commit time)
  runtime unset      Clear runtime
  auth set <dom> --provider <p> --account <a>
                     Configure OAuth auth for a branch
  auth show [dom]    Show auth config for branch(es)
  skill refresh      Refresh nit SKILL.md from configured source
  skill refresh --source <newtype|embedded|none|url> [--url <url>]
                     Update the source and refresh nit SKILL.md

${bold('Examples:')}
  nit init
  nit branch faam.io
  nit checkout faam.io
  ${dim('# edit agent-card.json for this platform...')}
  nit commit -m "FAAM config"
  nit push --all
`.trim());
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

main();
