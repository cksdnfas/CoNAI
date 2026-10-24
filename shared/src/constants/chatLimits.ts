/**
 * The one source of chat profile and chat-wide number ranges and defaults. The server store, HTTP routes, the chat
 * setup MCP tools, the profile editor and the page assistants all read these; nothing copies the numbers.
 */
export const CHAT_PROFILE_LIMITS = {
  temperature: { min: 0, max: 2 },
  maxTokens: { min: 1, max: 1_000_000 },
  contextTurns: { min: 1, max: 200 },
  contextTokens: { min: 1024, max: 4_000_000 },
  summaryTriggerTurns: { min: 1, max: 200 },
  loreScanDepth: { min: 1, max: 100 },
  loreTokenBudget: { min: 0, max: 32768 },
  loreDepth: { min: 0, max: 20 },
  loreRecursionDepth: { min: 0, max: 5 },
  toolOutputLimit: { min: 500, max: 100_000 },
} as const

/** Character limits (array limits are named explicitly); shared by profile writes, card import and editors. */
export const CHAT_PROFILE_TEXT_LIMITS = {
  name: 60, tagline: 200, text: 20_000, authorNote: 4000,
  sections: 30, sectionTitle: 80, alternateGreetings: 100, openingHistory: 100,
  translationInstructions: 4000, summaryPrompt: 4000, extraParams: 20_000,
} as const

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

/** Raw request captures kept per chat (ChatSettings.diagnostics.captureLimit). */
export const CHAT_CAPTURE_LIMITS = { min: 1, max: 200, default: 20 } as const
