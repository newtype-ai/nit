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
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { AgentCard, SkillMetadata } from './types.js';

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
 * For each skill in the card, look up the matching SKILL.md and update
 * name/description from its frontmatter. Returns a new card (immutable).
 *
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
