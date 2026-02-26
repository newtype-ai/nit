// ---------------------------------------------------------------------------
// nit — JSON diff engine for agent cards
//
// Produces structured, field-level diffs between two agent cards.
// Detects scalar field changes, skill additions/removals/modifications,
// and array changes.
// ---------------------------------------------------------------------------

import type { AgentCard, AgentCardSkill, DiffResult, FieldDiff } from './types.js';

/**
 * Compare two agent cards and return a structured diff.
 */
export function diffCards(oldCard: AgentCard, newCard: AgentCard): DiffResult {
  const fields: FieldDiff[] = [];

  // Scalar and simple array fields
  const scalarFields: (keyof AgentCard)[] = [
    'protocolVersion',
    'name',
    'description',
    'version',
    'url',
    'publicKey',
    'iconUrl',
    'documentationUrl',
  ];

  for (const field of scalarFields) {
    const oldVal = oldCard[field];
    const newVal = newCard[field];
    if (oldVal !== newVal) {
      fields.push({ field, old: oldVal, new: newVal });
    }
  }

  // Provider (nested object)
  const oldProvider = JSON.stringify(oldCard.provider ?? null);
  const newProvider = JSON.stringify(newCard.provider ?? null);
  if (oldProvider !== newProvider) {
    fields.push({ field: 'provider', old: oldCard.provider, new: newCard.provider });
  }

  // Array fields (order-sensitive comparison)
  const arrayFields: (keyof AgentCard)[] = [
    'defaultInputModes',
    'defaultOutputModes',
  ];
  for (const field of arrayFields) {
    const oldArr = JSON.stringify(oldCard[field]);
    const newArr = JSON.stringify(newCard[field]);
    if (oldArr !== newArr) {
      fields.push({ field, old: oldCard[field], new: newCard[field] });
    }
  }

  // Skills diff (by ID)
  const oldSkillMap = new Map(oldCard.skills.map((s) => [s.id, s]));
  const newSkillMap = new Map(newCard.skills.map((s) => [s.id, s]));

  const skillsAdded: string[] = [];
  const skillsRemoved: string[] = [];
  const skillsModified: string[] = [];

  for (const [id] of newSkillMap) {
    if (!oldSkillMap.has(id)) {
      skillsAdded.push(id);
    }
  }

  for (const [id] of oldSkillMap) {
    if (!newSkillMap.has(id)) {
      skillsRemoved.push(id);
    }
  }

  for (const [id, newSkill] of newSkillMap) {
    const oldSkill = oldSkillMap.get(id);
    if (oldSkill && !skillsEqual(oldSkill, newSkill)) {
      skillsModified.push(id);
    }
  }

  const changed =
    fields.length > 0 ||
    skillsAdded.length > 0 ||
    skillsRemoved.length > 0 ||
    skillsModified.length > 0;

  return { changed, fields, skillsAdded, skillsRemoved, skillsModified };
}

/**
 * Format a diff result for terminal display.
 */
export function formatDiff(diff: DiffResult): string {
  if (!diff.changed) {
    return 'No changes.';
  }

  const lines: string[] = [];

  // Field changes
  for (const fd of diff.fields) {
    const oldStr = formatValue(fd.old);
    const newStr = formatValue(fd.new);
    lines.push(`  ${fd.field}:`);
    lines.push(`\x1b[31m    - ${oldStr}\x1b[0m`);
    lines.push(`\x1b[32m    + ${newStr}\x1b[0m`);
  }

  // Skill changes
  for (const id of diff.skillsAdded) {
    lines.push(`\x1b[32m  + skill: ${id}\x1b[0m`);
  }

  for (const id of diff.skillsRemoved) {
    lines.push(`\x1b[31m  - skill: ${id}\x1b[0m`);
  }

  for (const id of diff.skillsModified) {
    lines.push(`\x1b[33m  ~ skill: ${id} (modified)\x1b[0m`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function skillsEqual(a: AgentCardSkill, b: AgentCardSkill): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function formatValue(val: unknown): string {
  if (val === undefined) return '(unset)';
  if (val === null) return '(null)';
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}
