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
export type WorkspaceBinding = { project: WorkspaceProject; bindingRevision: string; write: boolean }
