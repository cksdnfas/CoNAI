import type { WorkspaceProject, WorkspaceSummary, WorkspaceEntry, WorkspaceText, WorkspaceBinding, WorkspaceOperation, WorkspaceBatchResult } from '@conai/shared'
import { requestApiData } from './api-request'
const headers = { 'Content-Type': 'application/json' }
const post = <T>(url: string, body: unknown) => requestApiData<T>(url, { method: 'POST', headers, body: JSON.stringify(body) })
export const listWorkspaces = (offset = 0) => requestApiData<WorkspaceSummary[]>(`/api/workspaces?offset=${offset}`)
export const getWorkspace = (id: string) => requestApiData<WorkspaceProject>(`/api/workspaces/${id}`)
export const createWorkspace = (name: string, guidelines: string) => post<WorkspaceProject>('/api/workspaces', { name, guidelines })
export const listWorkspaceEntries = (id: string, target: string, offset = 0) => requestApiData<{ entries: WorkspaceEntry[]; nextOffset: number | null }>(`/api/workspaces/${id}/entries?target=${encodeURIComponent(target)}&offset=${offset}`)
export const readWorkspace = (id: string, targets: Array<{ target: string; offset?: number; limit?: number; revision?: string }>) => post<{ files: WorkspaceText[]; remaining: unknown[]; truncated: boolean }>(`/api/workspaces/${id}/read`, { targets })
export const searchWorkspace = (id: string, query: string, offset = 0) => post<{ hits: Array<WorkspaceEntry & { excerpt?: string }>; nextOffset: number | null; partialFiles: number; note: string }>(`/api/workspaces/${id}/search`, { query, offset })
export const applyWorkspace = (id: string, operations: WorkspaceOperation[], requestId = crypto.randomUUID()) => post<WorkspaceBatchResult>(`/api/workspaces/${id}/apply`, { requestId, operations })
export const workspaceChanges = (id: string) => requestApiData<Array<{ requestId: string; status: string; result: string; completed: number; createdAt: string }>>(`/api/workspaces/${id}/changes`)
export const getChatWorkspace = (threadId: number) => requestApiData<WorkspaceBinding | null>(`/api/workspaces/threads/${threadId}`)
export const setChatWorkspace = (threadId: number, projectId: string | null, write: boolean) => requestApiData<WorkspaceBinding | null>(`/api/workspaces/threads/${threadId}`, { method: 'PUT', headers, body: JSON.stringify({ projectId, write }) })
