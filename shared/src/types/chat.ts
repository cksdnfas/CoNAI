import type { ChatPageProposal, ChatPageSnapshot } from './chatPage'
import type { ChatWorkflowProposal } from './chatWorkflow'
import type { ChatPageActionProposal } from './chatPageAction'
import type { ChatProfileAssetsProposal } from './chatAssets'
import type { ChatTaskPlanProposal, ChatTaskRouting } from './chatTask'
import type { ChatRoutineRouting } from './chatRoutine'
import type { ChatChoiceProposal } from './chatChoice'
import type { PostKnowledgeTaskPurpose } from './postKnowledgeRuntime'

/** A recipient is a member profile, the human, or a room announcement (no automatic reply). */
export type ChatRecipient = number | 'user' | 'room'

export type ChatReplyQuote = {
  messageId: number
  role: 'user' | 'assistant'
  speakerProfileId: number | null
  speakerName: string
  excerpt: string
  alternative: number
  media?: { compositeHash: string; name: string; mimeType: string | null }
  unavailable?: boolean
}

export type ChatMessageRouting = {
  /** Stable for this particular generation, including before its message is stored. */
  replyId?: string
  replyTo: ChatReplyQuote | null
  recipients: ChatRecipient[]
  /** A request the server sent to move a task on (see ChatTask), not something the person typed. */
  task?: ChatTaskRouting
  /** A request an automation (routine or workflow) sent, not something the person typed. */
  routine?: ChatRoutineRouting
}

/** Server-issued MCP binding. Models cannot choose their sender, room, or active reply. */
export type ChatExecutionContext = {
  threadId: number
  profileId: number
  kind: 'direct' | 'group'
  replyId?: string
  /** Server root shared by retries, regenerated replies and members answering the same request. */
  rootExecutionId?: string
  /** Internal runtime facts; never populated from model arguments or browser input. */
  knowledgeExecutionId?: string
  knowledgeProvider?: string
  knowledgeModel?: string
  knowledgeOutputLimit?: number
  /** Captured only from an authorized server-side human order. Never a model/browser-supplied execution field. */
  knowledgeTaskPurpose?: PostKnowledgeTaskPurpose
  /** Validated, opted-in browser state for this reply only; never grants server-side authority. */
  page?: ChatPageSnapshot
}

/**
 * A text file one reply's tool wrote (a linked file, a lore file, a file store document). The chip under the reply
 * names it and offers undo: back to the text it had before that reply, or, for a file the reply made, removing it.
 */
export type ChatFileChange = {
  fileId: string
  name: string
  /** The folder it is in, from the store root (`/` at the top); null when the file is gone. */
  folder: string | null
  created: boolean
  undone: boolean
}

/** Wire contracts shared by the chat server and client. */
export type ChatPageOperation = { commandId: string; tier: 'view' | 'draft' | 'direct'; label: string }

export type ChatToolCall = {
  id: string
  tool: string
  status: 'running' | 'completed' | 'failed'
  arguments: unknown
  summary: string | null
  historyIds: number[]
  compositeHashes: string[]
  /**
   * Audio workspace candidates this call references or made (audio orders attach them as their jobs finish). The
   * client plays them through `/api/audio/candidates/:id/file`; absent when the call has none.
   */
  audioCandidateIds?: string[]
  /** Truncated tool output retained for later model requests. */
  output?: string
  /** A view/draft operation the chat ran on the connected page; the reader's tab keeps the undo for drafts under this id. */
  pageOperation?: ChatPageOperation
  jobIds?: number[]
  pendingJobIds?: number[]
  /** Terminal linked jobs without a completed image, derived when reading the reply. */
  failedJobs?: Array<{ jobId: number; status: 'failed' | 'cancelled' | 'completed'; failureCode: string | null; failureMessage: string }>
  /** Results this call created; lookups retain references without claiming authorship. */
  generated?: boolean
  /**
   * A picture asked for under an `after` generation preset whose job is not queued yet: its prompt is being written
   * from the finished reply, or writing it failed (`error` says why). Derived when reading the reply.
   */
  deferred?: { state: 'writing' | 'failed'; error: string | null }
  /** A setting the model proposed with this call (propose_* tools); the card under the reply lets a person save it. */
  proposal?: ChatProposal
}

/**
 * A setting proposed from a chat. The server validates the payload with the same normalizers as the admin routes before
 * it is attached, so the client can render it as is; saving goes through the admin REST with the viewer's own session.
 * `savedId` / `saved` are written back once a person saves the proposal from the card; `dismissed` once they set it
 * aside (무시).
 */
export type ChatProposal = { id: number; dismissed?: boolean } & (
  | ChatPageProposal
  | ChatWorkflowProposal
  | ChatPageActionProposal
  | ChatProfileAssetsProposal
  | ChatTaskPlanProposal
  | ChatChoiceProposal
  | {
      kind: 'display_block'
      /** Shared block name (defaults to the block key). */
      name: string
      /** Normalized ChatDisplayBlock: key, instruction, example, template, css, rules, summary, fields, enabled. */
      block: Record<string, unknown>
      /** Profile the card offers to link the block to (the speaking profile), or null. */
      linkProfileId: number | null
      savedId?: number | null
    }
  | {
      kind: 'profile'
      /** Normalized ChatProfileInput subset: name, tagline, systemPrompt, promptSections, greeting, alternateGreetings, modelSlotId, lorebookIds, blockIds, style, authorNote. */
      input: Record<string, unknown>
      savedId?: number | null
    }
  | {
      kind: 'profile_update'
      profileId: number
      profileName: string
      /** Only the fields that change, normalized. */
      patch: Record<string, unknown>
      /** The current values of those same fields, for the before/after view. */
      before: Record<string, unknown>
      /** How ids in a row read (a rating tier, judge preset, profile or linked files by name), when the raw value would not. */
      display?: Record<string, { before: string; after: string }>
      saved?: boolean
    }
  | {
      /**
       * propose_chat_settings: this chat's own settings (linked account lorebooks, record book, linked files, minutes
       * folder). The chat's owner saves it (POST /api/chat-proposals/:id/apply) with the context tab's rules.
       */
      kind: 'chat_settings'
      /** Only the keys that change. */
      patch: { lorebookIds?: number[]; loreRecordBookId?: number | null; linkedFiles?: Array<{ id: string; write: boolean }>; minutesFolderId?: string | null }
      before: { lorebookIds?: number[]; loreRecordBookId?: number | null; linkedFiles?: Array<{ id: string; write: boolean }>; minutesFolderId?: string | null }
      /** Each changed key as it reads on the card (names, not ids). */
      display: Record<string, { before: string; after: string }>
      saved?: boolean
    }
  | {
      /** save_lore: an entry for the chat's own lorebook. Saving it is done by the server (POST /api/chat-proposals/:id/apply). */
      kind: 'lore'
      language?: import('./loreTranslation').BilingualLore['language']
      translation?: import('./loreTranslation').LoreTranslation | null
      /** The account book the chat recorded into when proposed (its record book); absent: the chat's own book. */
      bookId?: number
      bookName?: string
      title: string
      keys: string[]
      content: string
      constant: boolean
      /** A text file to put in the book's 자료/ and link to the entry. */
      file?: { name: string; text: string }
      /** The book's entry with the same title: saving replaces it in place. */
      replaces?: string
      /** That entry as it was when proposed, for the before/after view. */
      before?: { title: string; keys: string[]; content: string; constant: boolean; file: string | null; translation?: import('./loreTranslation').LoreTranslation | null }
      /** The book the entry went into. */
      savedId?: number | null
      /** Snapshots for undoing the saved entry: the replaced entry (replacements only) and the entry as saved. */
      undoBefore?: Record<string, unknown>
      undoAfter?: Record<string, unknown>
      /** The 자료/ file the save made (removed again on undo while the entry still links it). */
      createdFileId?: string
      undone?: boolean
    }
)

/** Message storage and client presentation can differ; the event envelope must stay identical. */
export type ChatStreamEvent<Message> =
  | { type: 'user'; message: Message }
  | { type: 'rewind'; mode: 'regenerate' | 'edit'; message: Message }
  | { type: 'delta'; text: string; profileId?: number }
  | { type: 'reasoning'; text: string; profileId?: number }
  | { type: 'tool'; call: ChatToolCall; profileId?: number }
  | { type: 'done'; message: Message }
  | { type: 'error'; message: string }
  | { type: 'speaker'; profileId: number; speakers: number[]; queue: number[] }
  | { type: 'queue'; speakers: number[]; queue: number[] }
  | { type: 'notice'; message: string }
  | { type: 'routing'; routing: ChatMessageRouting; profileId?: number }
  /** The reply is written; its translation for display is being made before it is stored. */
  | { type: 'translating'; profileId?: number }
  /** The reply waits for something before it starts (a running summary); repeated while it waits, keeping the stream alive. */
  | { type: 'waiting'; reason: 'summary' }
  /** The live reply's whole text so far, in place of what the deltas built (a paragraph the model repeated was dropped). */
  | { type: 'text'; text: string; profileId?: number }
