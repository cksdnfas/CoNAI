/**
 * The one source of chat profile and chat-wide number ranges and defaults. The server store, HTTP routes, the chat
 * setup MCP tools, the profile editor and the page assistants all read these; nothing copies the numbers.
 */
export const CHAT_PROFILE_LIMITS = {
  temperature: { min: 0, max: 2 },
  maxTokens: { min: 1 },
  contextTurns: { min: 1 },
  contextTokens: { min: 1 },
  summaryTriggerTurns: { min: 1 },
  loreScanDepth: { min: 1, max: 100 },
  loreTokenBudget: { min: 0, max: 32768 },
  loreDepth: { min: 0, max: 20 },
  loreRecursionDepth: { min: 0, max: 5 },
  toolOutputLimit: { min: 500, max: 100_000 },
} as const

/** Existing profile style limit, shared by server normalization and editor rebasing. */
export const CHAT_MAX_EMOTICON_GROUPS = 10

/** Character limits (array limits are named explicitly); shared by profile writes, card import and editors. */
export const CHAT_PROFILE_TEXT_LIMITS = {
  name: 60, tagline: 200, agentDescription: 300, text: 20_000, authorNote: 4000,
  sections: 30, sectionTitle: 80, alternateGreetings: 100, openingHistory: 100,
  translationInstructions: 4000, summaryPrompt: 4000, extraParams: 20_000,
} as const

/**
 * Shared chat skills: the name and "use when" text of each linked skill go into the system prompt; the overview
 * (`instructions`, with a table of the sections) and each section come through use_skill. `perProfile`: skills one
 * profile links. `description` matches the Agent Skills format, so an imported SKILL.md fits.
 */
export const CHAT_SKILL_LIMITS = {
  name: 80, description: 1024, category: 60, instructions: 20_000, perProfile: 20,
  sections: 100, sectionPath: 120, sectionTitle: 120, sectionSummary: 300, sectionContent: 20_000,
} as const

/** Earlier states kept per skill for its history (the oldest go first). */
export const CHAT_SKILL_VERSIONS_KEPT = 20

/** One segment of a skill section path: a letter or digit, then letters, digits, '.', '_' or '-'. */
const SKILL_SECTION_SEGMENT = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u

/**
 * A skill section path as saved: `name` or `group/name` (one group level, so a table of contents stays one read
 * away), or null when `value` is not one.
 */
export function normalizeSkillSectionPath(value: string): string | null {
  const path = value.normalize('NFKC').trim()
  const parts = path.split('/')
  if (!path || path.length > CHAT_SKILL_LIMITS.sectionPath || parts.length > 2 || !parts.every((part) => SKILL_SECTION_SEGMENT.test(part))) return null
  return path
}

/** Section paths compare without case. */
export function skillSectionPathKey(path: string) {
  return path.normalize('NFKC').trim().toLowerCase()
}

/** The group of `group/name`, or null for a top-level section. */
export function skillSectionGroup(path: string) {
  const slash = path.indexOf('/')
  return slash < 0 ? null : path.slice(0, slash)
}

export const CHAT_PROFILE_DEFAULTS = {
  loreScanDepth: 4,
  loreTokenBudget: 1024,
  /** Turns before the end where keyword lore is merged in (0: the latest user message). */
  loreDepth: 4,
  /** Recursive lore scan levels (0: off). */
  loreRecursionDepth: 0,
  contextTurns: 20,
  summaryTriggerTurns: 6,
  /** Characters of one tool result handed to the model within a reply. */
  toolOutputLimit: 12_000,
} as const

/** Model ↔ tool round trips one reply may take, app-wide (ChatSettings.toolRoundLimit). */
export const TOOL_ROUND_LIMITS = { min: 1, max: 200, default: 50 } as const

/**
 * Keyword lore entries one judge or plugin selection keeps, best matches first, app-wide (ChatSettings.loreSelectionLimit).
 * Always-on entries are not counted.
 */
export const LORE_SELECTION_LIMITS = { min: 1, max: 100, default: 8 } as const

/** Raw request captures kept per chat (ChatSettings.diagnostics.captureLimit). */
export const CHAT_CAPTURE_LIMITS = { min: 1, max: 200, default: 20 } as const

/** The top folder of the file store that holds the lorebooks; it cannot be linked to a chat or profile. */
export const LOREBOOK_ROOT_FOLDER = '로어북'

/** Image files a linked file can be: the characters look at them with linked_view (text, PDF and XLSX are the other linkable files). */
export const LINKABLE_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'] as const
