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
  setCredential,
} from './index.js';
import { formatDiff } from './diff.js';

// ANSI color helpers
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function main() {
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
      case 'remote':
        await cmdRemote(args);
        break;
      case 'help':
      case '--help':
      case '-h':
      case undefined:
        printUsage();
        break;
      default:
        console.error(`nit: '${command}' is not a nit command. See 'nit help'.`);
        process.exit(1);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(red(`error: ${msg}`));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Command implementations
// ---------------------------------------------------------------------------

async function cmdInit() {
  const result = await init();

  console.log(bold('Initialized nit repository'));
  console.log();
  console.log(`  Public key:  ${green(result.publicKey)}`);
  if (result.cardUrl) {
    console.log(`  Card URL:    ${result.cardUrl}`);
  }
  if (result.skillsFound.length > 0) {
    console.log(`  Skills:      ${result.skillsFound.join(', ')}`);
  } else {
    console.log(`  Skills:      ${dim('(none discovered)')}`);
  }
  console.log();
  console.log(dim('Created .nit/ with initial commit on main.'));
}

async function cmdStatus() {
  const s = await status();

  console.log(`On branch ${bold(s.branch)}`);
  console.log(`Public key: ${dim(s.publicKey)}`);
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

  if (subcommand === 'set-credential') {
    const token = args[1];
    if (!token) {
      console.error('Usage: nit remote set-credential <agent-key>');
      process.exit(1);
    }
    await setCredential(token);
    console.log(`Credential ${green('configured')} for origin.`);
    return;
  }

  // Default: show remote info
  const info = await remote();

  console.log(`${bold(info.name)}`);
  console.log(`  URL:        ${info.url}`);
  console.log(
    `  Credential: ${info.hasCredential ? green('configured') : yellow('not set')}`,
  );
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
  status             Show current branch and uncommitted changes
  commit -m "msg"    Snapshot agent-card.json
  log                Show commit history
  diff [target]      Compare card vs HEAD, branch, or commit
  branch [name]      List branches or create a new one
  checkout <branch>  Switch branch (overwrites agent-card.json)
  push [--all]       Push branch(es) to remote
  remote             Show remote info
  remote set-credential <key>  Set push credential (agent key)

${bold('Examples:')}
  nit init
  nit branch faam.io
  nit checkout faam.io
  ${dim('# edit agent-card.json for FAAM...')}
  nit commit -m "FAAM config"
  nit push --all
`.trim());
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

main();
