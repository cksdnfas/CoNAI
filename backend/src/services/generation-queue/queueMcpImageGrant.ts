import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getAuthDb } from '../../database/authDb'
import { runtimePaths } from '../../config/runtimePaths'
import type { McpRequestContext } from '../../mcp/context'
import { mcpHttpSettingsService } from '../mcpHttpSettingsService'

/** Reserved for a server-issued authorization; clients may not submit it themselves. */
export const MCP_QUEUE_IMAGE_GRANT_KEY = '__conaiMcpImageGrant'

type McpQueueImageGrant = {
  keyId: string
  groupKey: string
  signature: string
}

type TrustedQueueImageGrant = {
  kind: 'stdio' | 'legacy-schedule'
  signature: string
}

/** Read the key file, not the per-process settings cache: API and queue workers can be separate processes. */
export function requireCurrentMcpKeyImagePermission(keyId: string): string {
  const settings = JSON.parse(fs.readFileSync(path.join(runtimePaths.basePath, 'config', 'mcp-http.json'), 'utf8')) as {
    keys?: Array<{ id?: unknown; groupKey?: unknown }>
  }
  const key = Array.isArray(settings.keys) ? settings.keys.find((item) => item.id === keyId) : undefined
  const groupKey = typeof key?.groupKey === 'string' ? key.groupKey.trim() : ''
  if (!groupKey) throw new Error('MCP key authorization is no longer valid')
  const allowed = getAuthDb().prepare(`
    WITH RECURSIVE inherited(id, parent_group_id) AS (
      SELECT id, parent_group_id FROM auth_permission_groups WHERE group_key = ?
      UNION
      SELECT g.id, g.parent_group_id FROM auth_permission_groups g
      JOIN inherited child ON g.id = child.parent_group_id
    )
    SELECT 1 FROM inherited g
    JOIN auth_group_permissions gp ON gp.group_id = g.id AND gp.allowed = 1
    JOIN auth_permissions p ON p.id = gp.permission_id
    WHERE p.permission_key = 'images.view' LIMIT 1
  `).get(groupKey)
  if (!allowed) throw new Error('Permission required: images.view')
  return groupKey
}

function signGrant(keyId: string, groupKey: string, workflowId: number, promptData: Record<string, unknown>) {
  return crypto.createHmac('sha256', mcpHttpSettingsService.getSigningSecret())
    .update('conai:mcp-queue-image:v1\0')
    .update(JSON.stringify({ keyId, groupKey, workflowId, promptData }))
    .digest('hex')
}

/** Bind accountless key authority to the actual normalized workflow input, including on retries. */
export function createMcpQueueImageGrant(context: McpRequestContext, workflowId: number, promptData: Record<string, unknown>): McpQueueImageGrant {
  if (!context.keyId) throw new Error('Invalid MCP key authorization for queued image input')
  const groupKey = requireCurrentMcpKeyImagePermission(context.keyId)
  return { keyId: context.keyId, groupKey, signature: signGrant(context.keyId, groupKey, workflowId, promptData) }
}

function signTrustedGrant(kind: TrustedQueueImageGrant['kind'], workflowId: number, promptData: Record<string, unknown>) {
  return crypto.createHmac('sha256', mcpHttpSettingsService.getSigningSecret())
    .update('conai:trusted-queue-image:v1\0')
    .update(JSON.stringify({ kind, workflowId, promptData }))
    .digest('hex')
}

/** A trusted local/system caller is recorded explicitly and bound to its normalized input. */
export function createTrustedQueueImageGrant(kind: TrustedQueueImageGrant['kind'], workflowId: number, promptData: Record<string, unknown>): TrustedQueueImageGrant {
  return { kind, signature: signTrustedGrant(kind, workflowId, promptData) }
}

/** Verify the server-issued grant and re-read an HTTP key's current permissions. */
export function requireMcpQueueImageGrant(value: unknown, workflowId: number, promptData: Record<string, unknown>): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid MCP queue image authorization')
  const grant = value as Partial<McpQueueImageGrant & TrustedQueueImageGrant>
  if ((grant.kind === 'stdio' || grant.kind === 'legacy-schedule')
    && typeof grant.signature === 'string' && /^[a-f0-9]{64}$/.test(grant.signature)) {
    const expected = signTrustedGrant(grant.kind, workflowId, promptData)
    if (!crypto.timingSafeEqual(Buffer.from(grant.signature, 'hex'), Buffer.from(expected, 'hex'))) {
      throw new Error('Invalid MCP queue image authorization')
    }
    return
  }
  if (typeof grant.keyId !== 'string' || typeof grant.groupKey !== 'string'
    || typeof grant.signature !== 'string' || !/^[a-f0-9]{64}$/.test(grant.signature)) {
    throw new Error('Invalid MCP queue image authorization')
  }
  const expected = signGrant(grant.keyId, grant.groupKey, workflowId, promptData)
  if (!crypto.timingSafeEqual(Buffer.from(grant.signature, 'hex'), Buffer.from(expected, 'hex'))) {
    throw new Error('Invalid MCP queue image authorization')
  }
  requireCurrentMcpKeyImagePermission(grant.keyId)
}
