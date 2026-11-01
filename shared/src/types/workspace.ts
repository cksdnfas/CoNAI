export type WorkspaceProject = { id: string; name: string; revision: number; guidelines: string; createdAt: string }
export type WorkspaceSummary = Omit<WorkspaceProject, 'guidelines'>
/** `revision`: a file's, in the screen's listing only (chat tools list without it). */
export type WorkspaceEntry = { id: string; target: string; kind: 'file' | 'folder'; size: number; revision?: string }
export type WorkspaceText = { target: string; text: string; revision: string; size: number; offset: number; nextOffset: number | null }
export type WorkspaceOperation =
  | { kind: 'mkdir'; target: string }
  | { kind: 'write'; target: string; text: string; expectedRevision: string | null }
  | { kind: 'edit'; target: string; edits: Array<{ old_text: string; new_text: string; replace_all?: boolean }>; expectedRevision: string }
  | { kind: 'move'; target: string; destination: string; expectedRevision: string }
  /** Screen only (a person confirmed it): assistants and plugins cannot delete. A folder goes with everything in it. */
  | { kind: 'delete'; target: string; expectedRevision: string }
export type WorkspaceBatchResult = { requestId: string; status: 'completed' | 'failed' | 'interrupted'; results: Array<{ target: string; revision?: string; deleted?: true }>; error?: string; /** Stopped on a file or folder that changed since its revision was read (retry after re-reading). */ conflict?: true }
/**
 * One project a speaker works in. `source`: the chat's own choice (or its change to a profile's project) or the default
 * its profile brings. `off`: a project of the profile this chat turned off; only the chat's settings list those, a
 * speaker never gets them.
 */
export type WorkspaceBinding = { project: WorkspaceProject; bindingRevision: string; write: boolean; source?: 'chat' | 'profile'; off?: true }
/** How a chat treats one project: its own read or write link, or off for a project its profile brings. */
export type WorkspaceChatMode = 'read' | 'write' | 'off'
/** Projects one chat or one profile can bring: every project's guidelines go into the instructions. */
export const MAX_WORKSPACE_LINKS = 8
