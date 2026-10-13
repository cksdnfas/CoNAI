export type WorkspaceProject = { id: string; name: string; revision: number; guidelines: string; createdAt: string }
export type WorkspaceSummary = Omit<WorkspaceProject, 'guidelines'>
export type WorkspaceEntry = { id: string; target: string; kind: 'file' | 'folder'; size: number }
export type WorkspaceText = { target: string; text: string; revision: string; size: number; offset: number; nextOffset: number | null }
export type WorkspaceOperation =
  | { kind: 'mkdir'; target: string }
  | { kind: 'write'; target: string; text: string; expectedRevision: string | null }
  | { kind: 'edit'; target: string; edits: Array<{ old_text: string; new_text: string; replace_all?: boolean }>; expectedRevision: string }
  | { kind: 'move'; target: string; destination: string; expectedRevision: string }
export type WorkspaceBatchResult = { requestId: string; status: 'completed' | 'failed' | 'interrupted'; results: Array<{ target: string; revision?: string }>; error?: string }
export type WorkspaceBinding = { project: WorkspaceProject; bindingRevision: string; write: boolean }
