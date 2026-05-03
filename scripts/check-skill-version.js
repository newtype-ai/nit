import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const skill = readFileSync(resolve(root, 'SKILL.md'), 'utf8');

const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/);
if (!frontmatter) {
  console.error('SKILL.md is missing YAML frontmatter');
  process.exit(1);
}

const version = frontmatter[1].match(/^\s*version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$/m);
if (!version) {
  console.error('SKILL.md frontmatter is missing metadata.version');
  process.exit(1);
}

if (pkg.version !== version[1]) {
  console.error(`Version mismatch: package.json is ${pkg.version}, SKILL.md is ${version[1]}`);
  process.exit(1);
}

console.log(`SKILL.md metadata.version matches package.json (${pkg.version})`);
