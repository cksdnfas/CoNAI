import type { ChatPageAction, ChatPageData, ChatPageSchema } from './chatPageAction'
import type { ChatPageValue } from './chatPage'
import type { GenerationLayoutSurface } from '../constants/generationLayout'
import type { WorkspaceOperation } from './workspace'
import type { PluginPackageReview } from './pluginAuthoring'
import type { ChatJudgeItemResult, ChatJudgePreset } from './chatJudge'

/** Legacy manifest metadata; installed plugins use native account permissions instead of capability grants. */
export type PluginCapability = 'files.read' | 'files.write' | 'files.media' | 'workspace.read' | 'workspace.write' | 'workspace.media' | 'media.process' | 'server'
/** Icons a page may name as `icon`; the host draws its own set, never package files. Append only: installed manifests keep their names. */
export const PLUGIN_PAGE_ICONS = [
  'audio-lines', 'book-open', 'bot', 'box', 'braces', 'calendar', 'chart-column', 'code', 'database', 'dices', 'file-text', 'film', 'fish',
  'flask-conical', 'gamepad-2', 'globe', 'hammer', 'image', 'layers', 'layout-dashboard', 'list-checks', 'map', 'message-circle', 'music',
  'notebook-pen', 'palette', 'puzzle', 'rocket', 'scroll-text', 'search', 'shapes', 'sparkles', 'star', 'table', 'terminal', 'users',
  'wand-sparkles', 'workflow', 'wrench',
] as const
export type PluginPageIcon = (typeof PLUGIN_PAGE_ICONS)[number]
export type PluginPage = {
  id: string; title: string; entry: string; accepts: string[]
  actions: Array<ChatPageAction & { tier: 'view' | 'draft' }>
  serverActions?: string[]
  /** false: no header menu entry (a page that only lives as a layout block). */
  menu?: boolean
  /** Header menu and launcher icon; absent: the puzzle icon. */
  icon?: PluginPageIcon
}
/** One of the plugin's pages shown inline as a block of the listed layout surfaces. */
export type PluginGenerationBlock = { id: string; page: string; surfaces: GenerationLayoutSurface[]; height?: number }
/** A button next to Generate on the listed surfaces; the server module's `generation.action` hook answers it. */
export type PluginGenerationAction = { id: string; label: string; surfaces: GenerationLayoutSurface[] }
/** What `generation.action` may return: a short note and input values for the screen's form. */
export type PluginGenerationActionResult = { message?: string; fill?: Record<string, ChatPageValue> }
export type PluginServerAction = {
  id: string; label: string; description: string; schema: ChatPageSchema; tool: string
  /** JSON constants or { "$input": "field.nested" }; absent: forward validated input. */
  arguments?: Record<string, ChatPageData>
}
export type PluginManifest = {
  apiVersion: 1; id: string; name: string; version: string; description: string
  capabilities: PluginCapability[]; pages: PluginPage[]
  appTools?: string[]; serverActions?: PluginServerAction[]
  /** Optional server module; independent of legacy capability declarations. */
  server?: { entry: string }
  /** Blocks and Generate-bar buttons on the generation layouts. */
  generation?: { blocks: PluginGenerationBlock[]; actions: PluginGenerationAction[] }
}
export type PluginAppRequest = {
  id: string; pluginId: string; version: string; label: string; tool: string; arguments: Record<string, unknown>
  /** Trusted packages (a server module) also reach configure/backup/restore tools. */
  scope: 'organize' | 'generate' | 'configure' | 'backup' | 'restore'
  project?: { id: string; name: string }
  status: 'pending' | 'starting' | 'running' | 'completed' | 'failed' | 'cancelled'; jobId: string | null
  result?: unknown; error?: string; expiresAt: number
}
/** A server module's live state; `tools` are the names it registered (`p_<plugin>_<tool>`), `hooks` the hooks it listens to. */
export type PluginServerStatus = {
  state: 'off' | 'starting' | 'ready' | 'error'; error: string | null
  tools: Array<{ name: string; description: string }>; hooks: string[]
}
/** Host API serving a public repository: github.com, gitlab.com or self-hosted GitLab, codeberg.org or self-hosted Gitea/Forgejo. */
export type PluginSourceProvider = 'github' | 'gitlab' | 'gitea'
/** A public HTTPS repository, a branch/tag/commit (omitted: default branch) and the plugin folder in it ('' or omitted: root). `provider` is required for hosts other than github.com, gitlab.com and codeberg.org. */
export type PluginSourceInput = { url: string; provider?: PluginSourceProvider; ref?: string; path?: string }
/** A plugin linked to a Git repository (administrator responses only). A ZIP or editor install over it keeps the link. */
export type PluginSource = {
  url: string; provider: PluginSourceProvider; ref: string; path: string
  /** Commit the last Git install was built from. */
  commit: string
  /** The installed package is no longer that Git build: a ZIP or editor install replaced it. */
  modified: boolean
  /** The last update check; null until checked. */
  latestCommit: string | null; checkedAt: string | null; checkError: string | null
  /** The last check found a commit other than `commit`. */
  updateAvailable: boolean
}
export type InstalledPlugin = { manifest: PluginManifest; enabled: boolean; installedAt: string; server?: PluginServerStatus; source?: PluginSource }
/** What installing from Git would change. Reviewing installs nothing; apply `reviewId` with `digest` before `expiresAt`. */
export type PluginSourceReview = {
  reviewId: string; expiresAt: number
  source: { url: string; provider: PluginSourceProvider; ref: string; path: string; commit: string }
  pluginId: string; name: string; version: string; digest: string; baseDigest: string | null
  updated: boolean; enabled: boolean; server: boolean; size: number
  files: PluginPackageReview['files']
  /** Repository files left out of the package (dot-files and folders, Markdown, file types a package can't hold); the first 50. */
  skipped: string[]
  /** The link this install replaces when the plugin was linked to another repository, ref or folder; null otherwise. */
  previousSource: { url: string; ref: string; path: string } | null
}
/** One linked plugin after an update check. */
export type PluginSourceCheck = { pluginId: string; name: string; version: string; source: PluginSource }
/** `updated`: replaced an installed version in place, keeping data. `reenable`: an unreadable prior installation was recovered disabled. */
export type PluginInstallResult = { plugin: InstalledPlugin; updated: boolean; reenable: boolean }
/** One stateless character turn. History and world state belong to the plugin, not a native chat thread. */
export type PluginLlmInput = {
  requestId: string; profileId: number; message: string; history?: string; userName?: string
  /** profile: native chat execution with the profile's tools and its own plugin/account room. text: stateless compatibility mode. */
  mode?: 'text' | 'profile'
  /** Ordinary profile runs only: local names of this plugin's registered tools to add for this run. Default none. */
  pluginTools?: string[]
  /** Ordinary profile runs only: plugin-namespaced room identity, 1–100 ASCII letters/digits/_ . : -. */
  roomKey?: string
  /** Human-readable title suffix on room creation; 1–60 characters, requires roomKey. */
  roomTitle?: string
  /** Optional room precondition from llm.room; refuse stale context if the room was recreated. */
  expectedThreadId?: number
  /** Opt-in isolated, read-only published-post research using the selected profile's engine. */
  research?: PluginResearchInput
  /** Text mode only. judge: the profile's prompt on its judge model, else the default judge row (cheap quick calls). */
  model?: 'chat' | 'judge'
  useLorebooks?: boolean
  /** Optional positive safe integer; only lowers the profile cap. Omitted follows profile/provider settings. Codex cannot enforce it. */
  maxTokens?: number
  /** Optional 1,000–1,800,000 ms explicit deadline. Omitted follows engine/connection settings. */
  timeoutMs?: number
  /** JSON example/schema passed through native workflow JSON mode; no separate size cap beyond request transport/context. */
  structuredOutput?: string | Record<string, unknown>
  /** Opt-in prose translation. `only` translates message JSON without a character/model turn. */
  translation?: { fields: string[]; only?: boolean; direction?: 'model' | 'display' }
}
export type PluginLlmMeasureInput = Omit<PluginLlmInput, 'requestId' | 'mode' | 'research' | 'timeoutMs' | 'pluginTools' | 'roomKey' | 'roomTitle' | 'expectedThreadId'>
export type PluginLlmRoomInput = { profileId: number; roomKey?: string; roomTitle?: string }
export type PluginLlmRoom = { threadId: number }
export type PluginLlmForgetRoomsInput = { roomKey: string }
export type PluginLlmForgetRoomsResult = { rooms: Array<{ threadId: number; status: 'deleted' | 'unlinked' }> }
export type PluginLlmDiscardInput = { jobId: string }
export type PluginLlmDiscardResult = { jobId: string; deleted: number }
export type PluginLlmMeasurement = {
  /** outputReserve may be estimate-only when no cap is configured; available is then advisory, not a rejection rule.
   * Translation-only reports the largest input/reserve separately and the minimum per-chunk available, not their difference from contextTokens. */
  inputTokens: number; outputReserve: number; contextTokens: number | null; available: number | null
  engine: 'api' | 'claude-code' | 'codex'; estimator: 'tokenizer' | 'heuristic'
}
export type PluginLlmProfile = {
  id: number; name: string; tagline: string; engine: string
  context: { contextTokens: number | null; maxOutputTokens: number | null }
  /** Visible look as image-prompt tags (the profile's appearance field); empty when unset. */
  appearance: string
  /**
   * Where the look comes from: a character library setting (`synced`: `appearance` and the images are its live values;
   * otherwise the profile keeps a detached copy), or null for the profile's own look. Read the setting through the
   * `get_character_setting` app tool or `/api/character-library` (both need `characters.view`).
   */
  character: { settingId: number; synced: boolean } | null
  translation?: { enabled: boolean; modelLanguage: 'en' | 'ko' | 'ja' | 'zh'; displayLanguage: 'en' | 'ko' | 'ja' | 'zh' }
  assetVersion: string | null; avatarCrop: { x: number; y: number; scale: number } | null
  assets: { avatar: boolean; background: boolean; reference: boolean }
  judge: {
    presetId: number | null; presetName: string | null; available: boolean
    followUp: { maxConsecutive: number; delaySeconds: number; directive: string } | null
    fields: { enabled: boolean; threshold: number; window: number } | null
    room: {
      window: number
      route: { enabled: boolean; minProbability: number; instructions: string }
      next: { enabled: boolean; continueThreshold: number; instructions: string }
    } | null
  }
  statusBlocks: Array<{ key: string; name: string; fields: Array<{
    name: string; label: string; min: number | null; max: number | null; step: number | null; values: string[]; readonly: boolean
  }> }>
  /**
   * Every saved profile setting as the profile editor holds it (persona prompt and sections, greetings, opening history,
   * lore/summary/context/judge settings, style with its blocks, model rows…). Only image bytes are left out: read
   * them with `asset()`.
   */
  details: Record<string, unknown>
  /** App-wide (Settings › 채팅 › 자원 › 기억): keyword lore entries one selection keeps, best matches first. */
  loreSelectionLimit: number
}
/** `llm.profile({ profileId })`: one profile with what it links, read whole. */
export type PluginLlmProfileDetail = PluginLlmProfile & {
  /** The profile's lorebooks (shared account books, then global ones) with every entry. */
  lorebooks: Array<{ id: number; name: string; kind: string; entries: Array<Record<string, unknown>> }>
  /** The judge preset the profile uses, whole; null without one. */
  judgePreset: ChatJudgePreset | null
}
/** Stateless questions on the profile's judge model; no preset or chat thread is required. */
export type PluginLlmDecideInput = {
  profileId: number; state: Record<string, unknown>; timeoutMs?: number
  questions: Array<{
    id: string; instructions: string; criteria?: { yes: string; no: string }
  } & (
    | { kind: 'choice'; options: Array<{ id: string; description: string; yes?: boolean }> }
    | { kind: 'yesno'; options?: never }
  )>
}
export type PluginLlmDecision = {
  engine: 'typesafe' | 'llm'; model: string
  answers: Record<string, { probability: number; confidence: number | null; choice: string | null; distribution: Record<string, number> | null }>
  error: string | null
}
/** Run the profile's preset items, without executing actions or scheduling a follow-up. */
export type PluginJudgeTurnInput = {
  profileId: number; stage: 'before' | 'after'; user: string
  conversation: Array<{ from: 'user' | 'character'; name: string; text: string }>
  actions?: string[]; timeoutMs?: number
}
export type PluginJudgeTurn = {
  presetId: number | null; engine: 'typesafe' | 'llm' | null; model: string | null
  directive: string; offered: string[]; withheld: string[]; followUp: boolean
  items: Array<Pick<ChatJudgeItemResult, 'itemId' | 'name' | 'verdict' | 'probability' | 'action'>>
  error: string | null
}
/** Bounded native profile image; convert data to a Blob URL in sandboxed pages. */
export type PluginProfileAsset = {
  profileId: number; kind: 'avatar' | 'background' | 'reference'; state: 'ready' | 'missing' | 'hidden'
  version: string; crop: { x: number; y: number; scale: number } | null
  mimeType?: 'image/webp'; data?: string; width?: number; height?: number
}
export type PluginLlmJob = {
  jobId: string; requestId: string; profileId: number
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'; cancelRequested: boolean
  result: { text: string; truncated: boolean; model: string; engine: string; json?: unknown; profileRun?: PluginProfileRun; translation?: { status: 'completed' | 'failed' | 'disabled'; language: 'en' | 'ko' | 'ja' | 'zh'; sourceLanguage?: 'en' | 'ko' | 'ja' | 'zh'; json?: unknown } } | null
  error: string | null; expiresAt: number
  /** Durable receipt: the input was stored in the native room, even if generation subsequently failed/cancelled. */
  delivery?: { threadId: number; messageId: number }
}
export type PluginProfileRunIdentity = { requestId: string; profileId: number; threadId: number }
export type PluginProfileRun = {
  threadId: number; messageIds: number[]
  /** Later replies that failed; completed primary/follow-up speech is still returned. */
  incompleteMessageIds?: number[]
  /** A native follow-up writer failed or produced no reply; some engines store no failed message. */
  followUpFailed?: boolean
  /** Explicit plugin deadline expired after primary completion; completed speech is retained. */
  followUpTimedOut?: boolean
  research?: PluginResearchResult
  tools: Array<{ id: string; name: string; status: 'running' | 'completed' | 'failed'; summary: string; output: string;
    historyIds: number[]; compositeHashes: string[]; audioCandidateIds: string[]; pendingJobIds: number[];
    proposalId: number | null; failedJobs: Array<{ jobId: number; message: string }>; deferred?: { state: 'writing' | 'failed'; error: string | null } }>
  toolsTruncated: boolean
}
export type PluginResearchInput = {
  slotId: string; activityId: string; allowedPostIds: number[]
  /** Summary keeps the same source checks but exposes no tools on any engine. */
  purpose?: 'research' | 'summary'
  /** @deprecated Accepted and ignored: research follows the app-wide tool round limit (Settings › 채팅 › 자원 › 도구 사용). */
  maxModelCalls?: number
  /** @deprecated Accepted and ignored, as maxModelCalls. */
  maxToolCalls?: number
  /** @deprecated Accepted and ignored, as maxModelCalls. */
  maxTurns?: number
}
export type PluginResearchResult = {
  slotId: string; activityId: string; modelCalls: number | null; toolCalls: number
  stopReason: 'completed' | 'model_limit' | 'turn_limit'
  /**
   * The limits the run had. Null means the engine does not expose an enforceable provider-request/turn limit;
   * maxToolCalls is null outside a summary (no per-call cap; rounds bound the run) and 0 for a summary.
   */
  limits: { runtime: 'direct' | 'claude' | 'pi' | 'codex'; maxModelCalls: number | null; maxTurns: number | null; maxToolCalls: number | null }
  turns: number | null
  /** Legacy hosts could omit receipts; current hosts retain them up to the shared result-file protection. */
  evidenceTruncated?: boolean
  evidence: Array<{ postId: number; revision: number; contentVersion: number | null; offset: number; end: number; excerpt: string }>
}
export type PluginInstance = {
  id: string; plugin: PluginManifest; page: PluginPage; expiresAt: number
  files: Array<{ id: string; name: string; mimeType: string | null; size: number }>
  workspace?: { id: string; name: string; write: boolean }
}
export type PluginWriteProposal = {
  id: string; instanceId: string; fileId: string; name: string
  before: string; text: string; revision: string; expiresAt: number
}
export type PluginSnapshot = { revision: string; dirty?: boolean; data: Record<string, ChatPageData> }
export type PluginWorkspaceProposal = {
  source: 'workspace'; id: string; instanceId: string; projectId: string; target: string; name: string
  before: string; text: string; revision: string | null; expiresAt: number
  operations?: WorkspaceOperation[]
}
export type PluginMediaOperation =
  | { kind: 'crop'; left: number; top: number; width: number; height: number; outputWidth: number; outputHeight: number; quality: number }
  | { kind: 'extract_audio'; quality: number }
export type PluginMediaProposal = Omit<PluginWorkspaceProposal, 'source' | 'operations'> & {
  source: 'media'; sourceTarget: string; sourceRevision: string; fingerprint: string; operation: PluginMediaOperation
}
