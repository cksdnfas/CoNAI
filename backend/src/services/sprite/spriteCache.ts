import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { runtimePaths } from '../../config/runtimePaths'

/**
 * Temporary sprite workspaces (one per extraction build, normalisation or animation run). A build keeps its final
 * frames here so re-layout, post-crop, re-encode, frame ZIPs and "save to library" never re-run extraction.
 * Workspaces expire an hour after their last use and the oldest are evicted past the size cap.
 */

export const SPRITE_WORKSPACE_TTL_MS = 60 * 60 * 1000
export const SPRITE_WORKSPACE_CAP_BYTES = 4 * 1024 * 1024 * 1024
const OWNER_FILE = 'owner.json'
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export type SpriteWorkspaceKind = 'build' | 'normalize' | 'animation' | 'batch'

export interface SpriteWorkspaceOwner {
  kind: SpriteWorkspaceKind
  accountId: number | null
  accountType: string | null
  createdAt: string
}

export interface SpriteWorkspace {
  id: string
  dir: string
  owner: SpriteWorkspaceOwner
}

/** Owner or admin. Unbound MCP keys (no account) own their own null-owner workspaces; accounts never see those. */
export function canAccessSpriteWorkspace(owner: { accountId: number | null }, requester: { accountId: number | null; accountType: string | null }): boolean {
  return requester.accountType === 'admin' || owner.accountId === requester.accountId
}

export function spriteWorkspaceRoot(): string {
  return path.join(runtimePaths.tempDir, 'sprite-workspaces')
}

function directorySize(dir: string): number {
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) total += directorySize(full)
    else if (entry.isFile()) total += fs.statSync(full).size
  }
  return total
}

function lastUsed(dir: string): number {
  try { return fs.statSync(path.join(dir, OWNER_FILE)).mtimeMs } catch { return 0 }
}

/** Drop expired workspaces, then the least recently used ones while the total is over the cap. */
export function pruneSpriteWorkspaces(now = Date.now(), keep?: string): void {
  const root = spriteWorkspaceRoot()
  if (!fs.existsSync(root)) return
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== keep)
    .map((entry) => ({ dir: path.join(root, entry.name), used: lastUsed(path.join(root, entry.name)) }))
  const live: typeof entries = []
  for (const entry of entries) {
    if (now - entry.used > SPRITE_WORKSPACE_TTL_MS) fs.rmSync(entry.dir, { recursive: true, force: true })
    else live.push(entry)
  }
  let total = live.reduce((sum, entry) => sum + directorySize(entry.dir), 0)
  if (keep && fs.existsSync(path.join(root, keep))) total += directorySize(path.join(root, keep))
  for (const entry of live.sort((a, b) => a.used - b.used)) {
    if (total <= SPRITE_WORKSPACE_CAP_BYTES) break
    const size = directorySize(entry.dir)
    fs.rmSync(entry.dir, { recursive: true, force: true })
    total -= size
  }
}

export function createSpriteWorkspace(kind: SpriteWorkspaceKind, owner: { accountId: number | null; accountType: string | null }): SpriteWorkspace {
  pruneSpriteWorkspaces()
  const id = crypto.randomUUID()
  const dir = path.join(spriteWorkspaceRoot(), id)
  fs.mkdirSync(dir, { recursive: true })
  const record: SpriteWorkspaceOwner = { kind, accountId: owner.accountId, accountType: owner.accountType, createdAt: new Date().toISOString() }
  fs.writeFileSync(path.join(dir, OWNER_FILE), JSON.stringify(record))
  return { id, dir, owner: record }
}

/** Look up a workspace by id and mark it used. Null when unknown, expired or malformed. */
export function getSpriteWorkspace(id: string): SpriteWorkspace | null {
  if (!ID_PATTERN.test(id)) return null
  const dir = path.join(spriteWorkspaceRoot(), id)
  const ownerPath = path.join(dir, OWNER_FILE)
  if (!fs.existsSync(ownerPath)) return null
  try {
    const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8')) as SpriteWorkspaceOwner
    if (Date.now() - lastUsed(dir) > SPRITE_WORKSPACE_TTL_MS) {
      fs.rmSync(dir, { recursive: true, force: true })
      return null
    }
    const now = new Date()
    fs.utimesSync(ownerPath, now, now)
    return { id, dir, owner }
  } catch {
    return null
  }
}

export function removeSpriteWorkspace(id: string): void {
  if (!ID_PATTERN.test(id)) return
  fs.rmSync(path.join(spriteWorkspaceRoot(), id), { recursive: true, force: true })
}

/** A path inside the workspace; rejects names that would escape it. */
export function workspaceFile(workspace: SpriteWorkspace, name: string): string {
  const resolved = path.resolve(workspace.dir, name)
  if (!resolved.startsWith(path.resolve(workspace.dir) + path.sep)) throw new Error('Invalid workspace file name')
  return resolved
}
