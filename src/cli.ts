#!/usr/bin/env node
// ---------------------------------------------------------------------------
// nit — CLI entry point
//
// Usage: nit <command> [options]
// ---------------------------------------------------------------------------

import {
  init,
  status,
  commit,
  log,
  diff,
  branch,
  checkout,
  push,
  remote,
  remoteAdd,
  remoteSetUrl,
  sign,
  loginPayload,
  signTx,
  broadcast,
  rpcSetUrl,
  rpcInfo,
  authSet,
  authShow,
  reset,
  show,
  pull,
} from './index.js';
import type { AuthProvider } from './types.js';
import { formatDiff } from './diff.js';
import { autoUpdate, version as nitVersion } from './update-check.js';

// ANSI color helpers
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function main() {
  // Auto-update before running any command (CLI only, never library)
  await autoUpdate();

  const [, , command, ...args] = process.argv;

  try {
    switch (command) {
      case 'init':
        await cmdInit();
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
      case 'auth':
        await cmdAuth(args);
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

async function cmdInit() {
  const result = await init();

  console.log(bold('Initialized nit repository'));
  console.log();
  console.log(`  Agent ID:    ${green(result.agentId)}`);
  console.log(`  Public key:  ${dim(result.publicKey)}`);
  console.log(`  Card URL:    ${result.cardUrl}`);
  console.log();
  console.log(`  ${bold('Wallet addresses:')}`);
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
  console.log(dim('Created .nit/ with initial commit on main.'));
  console.log(dim('Fund the wallet addresses above to use blockchain features in apps.'));
  console.log();
  console.log(`Next: open ${bold('agent-card.json')} and set your name, description, and skills.`);
}

async function cmdStatus() {
  const s = await status();

  console.log(`On branch ${bold(s.branch)}`);
  console.log();
  console.log(`  Agent ID:    ${green(s.agentId)}`);
  console.log(`  Public key:  ${dim(s.publicKey)}`);
  console.log(`  Card URL:    ${s.cardUrl}`);
  console.log();
  console.log(`  ${bold('Wallet addresses:')}`);
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
  const name = args[0];
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

  await checkout(branchName);
  console.log(`Switched to branch '${green(branchName)}'.`);
}

async function cmdPush(args: string[]) {
  const all = args.includes('--all');
  const results = await push({ all });

  for (const r of results) {
    if (r.success) {
      console.log(`${green('✓')} ${r.branch} → ${r.remoteUrl}`);
    } else {
      console.log(`${red('✗')} ${r.branch}: ${r.error}`);
    }
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

  if (subcommand) {
    console.error(`nit remote: unknown subcommand '${subcommand}'`);
    console.error('Usage: nit remote [set-url <name> <url> | add <name> <url>]');
    process.exit(1);
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
    if (payload.switchedBranch) {
      console.error(`Switched to branch '${payload.switchedBranch}'`);
    }
    if (payload.createdSkill) {
      console.error(`Created skill template '${payload.createdSkill}'`);
    }
    console.error(`Auth: use browser profile="user" to reuse existing sessions. If login required, click OAuth buttons. Do NOT enter credentials.`);
    const { switchedBranch: _s, createdSkill: _c, ...output } = payload;
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
  const all = args.includes('--all');
  const results = await pull({ all });

  for (const r of results) {
    if (r.updated) {
      console.log(`${green('✓')} ${r.branch} ← ${dim(r.commitHash.slice(0, 8))}`);
    } else {
      console.log(`${dim('—')} ${r.branch} ${dim('(up to date)')}`);
    }
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

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printUsage() {
  console.log(`
${bold('nit')} — version control for agent cards

${bold('Usage:')} nit <command> [options]

${bold('Commands:')}
  init               Initialize .nit/ in current directory
  status             Show identity, branch, and uncommitted changes
  commit -m "msg"    Snapshot agent-card.json
  log                Show commit history
  diff [target]      Compare card vs HEAD, branch, or commit
  branch [name]      List branches or create a new one
  checkout <branch>  Switch branch (overwrites agent-card.json)
  push [--all]       Push branch(es) to remote
  pull [--all]       Pull branch(es) from remote
  reset [target]     Restore agent-card.json from HEAD or target
  show [target]      Show commit metadata and card content
  sign "message"     Sign a message with your Ed25519 key
  sign --login <dom> Switch to domain branch + generate login payload
  remote             Show remote info
  remote add <n> <u> Add a new remote
  remote set-url <n> <u>  Change remote URL
  sign-tx --chain <c> <data>  Sign tx data (evm: hash, solana: message)
  broadcast --chain <c> <tx>  Send signed tx to RPC endpoint
  rpc                Show configured RPC endpoints
  rpc set-url <c> <url>  Set RPC endpoint for a chain
  auth set <dom> --provider <p> --account <a>
                     Configure OAuth auth for a branch
  auth show [dom]    Show auth config for branch(es)

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
