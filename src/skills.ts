// ---------------------------------------------------------------------------
// nit — SKILL.md discovery and resolution
//
// Searches ALL known agent framework locations for SKILL.md files, parses
// YAML frontmatter, and resolves skill pointers in agent cards.
//
// SKILL.md is an open standard (agentskills.io/specification) adopted by
// Claude Code, Cursor, Windsurf, Codex, OpenClaw, Aider, and others.
// The file format is identical — only the directory path differs per framework.
//
// Search locations (project-local first, then user-global):
//   Project-local:
//     1. ./.claude/skills/       — Claude Code
//     2. ./.cursor/skills/       — Cursor
//     3. ./.windsurf/skills/     — Windsurf
//     4. ./.codex/skills/        — OpenAI Codex CLI
//     5. ./.agents/skills/       — Generic / agent-local
//   User-global:
//     6. ~/.claude/skills/       — Claude Code + Cursor (shared)
//     7. ~/.codex/skills/        — Codex CLI
//     8. ~/.codeium/windsurf/skills/ — Windsurf
// ---------------------------------------------------------------------------

import { promises as fs } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { AgentCard, SkillMetadata } from './types.js';

// ---------------------------------------------------------------------------
// Framework detection and skills directory discovery
// ---------------------------------------------------------------------------

/** Known framework directory markers and their skills subdirectory. */
const FRAMEWORK_MARKERS: Array<{ marker: string; skillsPath: string }> = [
  { marker: '.claude', skillsPath: '.claude/skills' },
  { marker: '.cursor', skillsPath: '.cursor/skills' },
  { marker: '.codex', skillsPath: '.codex/skills' },
  { marker: '.windsurf', skillsPath: '.windsurf/skills' },
  { marker: '.openclaw', skillsPath: '.openclaw/workspace/skills' },
];

const GLOBAL_SKILLS_DIRS = [
  { marker: '.claude', skillsPath: '.claude/skills' },
  { marker: '.codex', skillsPath: '.codex/skills' },
  { marker: '.codeium', skillsPath: '.codeium/windsurf/skills' },
];

/**
 * Detect the skills directory for this nit repository.
 *
 * Detection layers:
 *   1. Path-based: nit repo's own path reveals the framework
 *   2. Project-local: check for framework directories at project level
 *   3. User-global: check for framework directories at ~/
 *   4. Fallback: <projectDir>/.agents/skills/
 */
export async function discoverSkillsDir(
  projectDir: string,
): Promise<string> {
  const absProject = resolve(projectDir);
  const home = homedir();

  // Layer 1: Detect from nit repo's location (path contains framework marker)
  // Extract the root ABOVE the marker to avoid double-nesting
  // (e.g., projectDir = ~/.openclaw/workspace → root = ~, result = ~/.openclaw/workspace/skills)
  for (const { marker, skillsPath } of FRAMEWORK_MARKERS) {
    const idx = absProject.indexOf(`/${marker}`);
    if (idx !== -1) {
      const root = absProject.slice(0, idx);
      return join(root, skillsPath);
    }
  }

  // Layer 2: Detect from framework directories at project level
  for (const { marker, skillsPath } of FRAMEWORK_MARKERS) {
    try {
      const stat = await fs.stat(join(absProject, marker));
      if (stat.isDirectory()) {
        return join(absProject, skillsPath);
      }
    } catch {
      // Directory doesn't exist — try next
    }
  }

  // Layer 3: Detect from user-global framework directories
  for (const { marker, skillsPath } of GLOBAL_SKILLS_DIRS) {
    try {
      const stat = await fs.stat(join(home, marker));
      if (stat.isDirectory()) {
        return join(home, skillsPath);
      }
    } catch {
      // Directory doesn't exist — try next
    }
  }

  // Fallback: generic .agents/skills/ at project level
  return join(absProject, '.agents', 'skills');
}

/**
 * Ensure a SKILL.md exists for a domain, fetching from the server if possible.
 *
 * - If no local SKILL.md → fetch from `https://{domain}/skill.md`, fallback to template
 * - If local exists → fetch remote, compare `version` field, update if remote is newer
 * - If fetch fails (offline, no skill.md served) → keep local or create template
 *
 * Returns the skill ID (sanitized directory name).
 */
export async function createSkillTemplate(
  skillsDir: string,
  domain: string,
): Promise<string> {
  const skillId = domain.replace(/\./g, '-');
  const skillDir = join(skillsDir, skillId);
  const skillPath = join(skillDir, 'SKILL.md');

  // Read local version if it exists
  let localVersion: string | undefined;
  try {
    const existing = await fs.readFile(skillPath, 'utf-8');
    localVersion = parseVersion(existing);
  } catch {
    // Doesn't exist yet
  }

  // Fetch remote skill from the domain
  let remoteContent: string | null = null;
  let remoteVersion: string | undefined;
  try {
    const res = await fetch(`https://${domain}/skill.md`, {
      headers: { 'Accept': 'text/markdown, text/plain' },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const text = await res.text();
      if (text.startsWith('---')) {
        remoteContent = text;
        remoteVersion = parseVersion(text);
      }
    }
  } catch {
    // Network error — fall through
  }

  // If local exists, only overwrite when remote has a newer version
  if (localVersion !== undefined) {
    if (!remoteVersion || !isNewerVersion(remoteVersion, localVersion)) {
      return skillId; // Local is current (or remote unavailable)
    }
  }

  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    skillPath,
    remoteContent ?? fallbackTemplate(skillId, domain),
    'utf-8',
  );
  return skillId;
}

// ---------------------------------------------------------------------------
// Version helpers
// ---------------------------------------------------------------------------

/** Extract the `version` field from YAML frontmatter, or undefined. */
function parseVersion(content: string): string | undefined {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return undefined;
  const versionMatch = fmMatch[1].match(/^version:\s*(.+)$/m);
  return versionMatch ? versionMatch[1].trim() : undefined;
}

/** True if `remote` is a strictly newer semver than `local`. */
function isNewerVersion(remote: string, local: string): boolean {
  const r = remote.split('.').map(Number);
  const l = local.split('.').map(Number);
  const len = Math.max(r.length, l.length);
  for (let i = 0; i < len; i++) {
    const rv = r[i] ?? 0;
    const lv = l[i] ?? 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false; // Equal
}

function fallbackTemplate(skillId: string, domain: string): string {
  return `---
name: ${skillId}
description: Skills and context for ${domain}
---

# ${skillId}

Configure your skills and context for ${domain} here.
`;
}

/**
 * Discover all SKILL.md files from standard locations.
 * Returns metadata parsed from each file's YAML frontmatter.
 * Later entries do NOT override earlier ones (project-local takes priority).
 */
export async function discoverSkills(
  projectDir: string,
): Promise<SkillMetadata[]> {
  const home = homedir();
  const searchDirs = [
    // Project-local (all known agent frameworks)
    join(projectDir, '.claude', 'skills'),
    join(projectDir, '.cursor', 'skills'),
    join(projectDir, '.windsurf', 'skills'),
    join(projectDir, '.codex', 'skills'),
    join(projectDir, '.agents', 'skills'),
    // User-global
    join(home, '.claude', 'skills'),       // Claude Code + Cursor (shared)
    join(home, '.codex', 'skills'),        // Codex CLI
    join(home, '.codeium', 'windsurf', 'skills'), // Windsurf
  ];

  const seen = new Set<string>();
  const skills: SkillMetadata[] = [];

  for (const searchDir of searchDirs) {
    const found = await scanSkillDir(searchDir);
    for (const skill of found) {
      if (!seen.has(skill.id)) {
        seen.add(skill.id);
        skills.push(skill);
      }
    }
  }

  return skills;
}

/**
 * For each skill in the card, look up the matching SKILL.md and resolve
 * name/description from its frontmatter. Returns a new card (immutable).
 *
 * Supports both full skills and pointer-only skills ({ id: "..." }).
 * SKILL.md is the source of truth — its data always wins when present.
 * Skills without a matching SKILL.md are kept as-is.
 */
export async function resolveSkillPointers(
  card: AgentCard,
  projectDir: string,
): Promise<AgentCard> {
  const discovered = await discoverSkills(projectDir);
  const skillMap = new Map(discovered.map((s) => [s.id, s]));

  const resolvedSkills = card.skills.map((skill) => {
    const meta = skillMap.get(skill.id);
    if (!meta) return skill;

    return {
      ...skill,
      name: meta.name,
      description: meta.description,
    };
  });

  return { ...card, skills: resolvedSkills };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Scan a directory for subdirectories containing SKILL.md, parse each.
 */
async function scanSkillDir(dir: string): Promise<SkillMetadata[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const skills: SkillMetadata[] = [];

  for (const entry of entries) {
    const skillMdPath = join(dir, entry, 'SKILL.md');
    try {
      const content = await fs.readFile(skillMdPath, 'utf-8');
      const meta = parseFrontmatter(content, entry, skillMdPath);
      if (meta) skills.push(meta);
    } catch {
      // No SKILL.md in this subdirectory — skip
    }
  }

  return skills;
}

/**
 * Parse YAML frontmatter from a SKILL.md file.
 *
 * Expected format:
 *   ---
 *   name: skill-name
 *   description: Some description text
 *   metadata:
 *     version: 1.0.0
 *   ---
 *
 * This is a minimal parser — handles only the specific key-value format
 * used by SKILL.md files, not arbitrary YAML.
 */
function parseFrontmatter(
  content: string,
  dirName: string,
  filePath: string,
): SkillMetadata | null {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return null;

  const fmBlock = fmMatch[1];
  const fields: Record<string, string> = {};
  let inMetadata = false;
  let metadataVersion: string | undefined;

  for (const line of fmBlock.split('\n')) {
    const trimmed = line.trimEnd();

    // Nested metadata block
    if (trimmed === 'metadata:') {
      inMetadata = true;
      continue;
    }

    if (inMetadata) {
      const nestedMatch = trimmed.match(/^\s+(\w+):\s*(.+)$/);
      if (nestedMatch) {
        if (nestedMatch[1] === 'version') {
          metadataVersion = nestedMatch[2].trim();
        }
        continue;
      }
      // Line is no longer indented — exit metadata block
      inMetadata = false;
    }

    // Top-level key: value
    const kvMatch = trimmed.match(/^(\w+):\s*(.+)$/);
    if (kvMatch) {
      fields[kvMatch[1]] = kvMatch[2].trim();
    }
  }

  const name = fields['name'];
  const description = fields['description'];

  if (!name || !description) return null;

  return {
    id: dirName,
    name,
    description,
    version: metadataVersion,
    path: filePath,
  };
}
