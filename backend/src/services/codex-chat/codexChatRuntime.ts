import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import type { McpRequester } from '../../mcp/context'
import { runtimePaths } from '../../config/runtimePaths'
import type { CodexAppServerClient } from './codexAppServerClient'

const INERT_FEATURES = new Set(['secret_auth_storage', 'enable_request_compression'])
const REQUIRED_FEATURES = ['shell_tool', 'unified_exec', 'hooks', 'plugins', 'apps', 'code_mode_host', 'code_mode', 'browser_use', 'computer_use', 'multi_agent', 'image_generation', 'view_image', 'skill_mcp_dependency_install', 'skill_search', 'skip_host_skill_discovery']

/** Strictly parse the installed CLI inventory; absence/malformed output never means an empty capability set. */
export function parseChatFeatureInventory(output: string): Set<string> {
  const names = new Set<string>()
  for (const line of output.split(/\r?\n/).filter((line) => line.trim())) {
    const match = /^([a-z][a-z0-9_.]*)\s+(stable|experimental|under development|removed|deprecated)\s+(?:true|false)\s*$/.exec(line.trim())
    if (!match || names.has(match[1])) throw new Error('Codex feature inventory could not be verified.')
    if (match[2] !== 'removed') names.add(match[1])
  }
  if (REQUIRED_FEATURES.some((feature) => !names.has(feature))) throw new Error('This Codex CLI cannot enforce the required chat capability restrictions.')
  return names
}

export function chatFeatureOverrides(features: Set<string>): Record<string, boolean> {
  return Object.fromEntries([...features].map((feature) => [feature, feature === 'skip_host_skill_discovery' || INERT_FEATURES.has(feature)]))
}

function isWithin(candidate: string, root: string) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}

/** Account-private state and bounded auth reuse, outside every served runtime media directory. */
export function prepareChatRuntime(requester: McpRequester) {
  const root = path.join(runtimePaths.basePath, 'private-codex-chat', requester.accountId === null ? 'bootstrap' : `account-${requester.accountId}`)
  for (const served of [runtimePaths.uploadsDir, runtimePaths.tempDir, runtimePaths.saveDir, runtimePaths.artifactsDir]) {
    if (isWithin(path.resolve(root), path.resolve(served))) throw new Error('Codex chat state must be outside served media directories.')
  }
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  const actualRoot = fs.realpathSync(root)
  for (const served of [runtimePaths.uploadsDir, runtimePaths.tempDir, runtimePaths.saveDir, runtimePaths.artifactsDir]) {
    const actualServed = fs.existsSync(served) ? fs.realpathSync(served) : path.resolve(served)
    if (isWithin(actualRoot, actualServed)) throw new Error('Codex chat state must be outside served media directories.')
  }
  const home = path.join(actualRoot, 'home')
  const cwd = path.join(actualRoot, 'work')
  const temp = path.join(actualRoot, 'tmp')
  for (const directory of [home, cwd, temp]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    if (!isWithin(fs.realpathSync(directory), actualRoot)) throw new Error('Codex chat runtime directory escaped its private root.')
  }
  const authSource = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json')
  if (!fs.existsSync(authSource) || !fs.statSync(authSource).isFile()) throw new Error('Codex chat needs file-backed authentication; unrestricted host-home fallback is disabled.')
  const authTarget = path.join(home, 'auth.json')
  if (fs.existsSync(authTarget) && fs.lstatSync(authTarget).isSymbolicLink()) throw new Error('Invalid private Codex authentication location.')
  const stagingAuth = path.join(home, `.auth-${randomUUID()}`)
  fs.copyFileSync(authSource, stagingAuth)
  fs.chmodSync(stagingAuth, 0o600)
  fs.renameSync(stagingAuth, authTarget)
  // Do not inherit user/project configuration, instructions, plugins, skills or environment credentials.
  const stagingConfig = path.join(home, `.config-${randomUUID()}`)
  fs.writeFileSync(stagingConfig, 'approval_policy = "never"\nsandbox_mode = "read-only"\nweb_search = "disabled"\nproject_doc_max_bytes = 0\nproject_doc_fallback_filenames = []\nnotify = []\ncli_auth_credentials_store = "file"\n', { mode: 0o600 })
  fs.renameSync(stagingConfig, path.join(home, 'config.toml'))
  const env: NodeJS.ProcessEnv = {}
  for (const name of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT']) if (process.env[name]) env[name] = process.env[name]
  return { home, cwd, env: { ...env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, CODEX_HOME: home, TEMP: temp, TMP: temp, TMPDIR: temp, NO_COLOR: '1' } }
}

export function chatRuntimeArgs(features: Set<string>, cwd: string, port: string) {
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid CoNAI MCP port.')
  const overrides = chatFeatureOverrides(features)
  return [
    '--strict-config',
    '-c', `features={${Object.entries(overrides).map(([feature, enabled]) => `${JSON.stringify(feature)}=${enabled}`).join(',')}}`,
    '-c', `projects={${JSON.stringify(cwd)}={trust_level="untrusted"}}`,
    // Replace the table as a whole: inherited commands/header helpers can never survive URL overrides.
    '-c', `mcp_servers={conai={url="http://127.0.0.1:${port}/mcp",bearer_token_env_var="CONAI_CHAT_MCP_TOKEN",default_tools_approval_mode="approve"}}`,
  ]
}

/** Verify supported effective controls and every page of MCP inventory before any model turn. */
export async function verifyChatRuntime(client: Pick<CodexAppServerClient, 'request'>, features: Set<string>, cwd: string, port: string) {
  const { config } = await client.request<{ config: Record<string, unknown> }>('config/read', { includeLayers: false })
  if (!config || config.approval_policy !== 'never' || config.sandbox_mode !== 'read-only' || config.web_search !== 'disabled' || config.project_doc_max_bytes !== 0) throw new Error('Codex chat effective safety configuration could not be verified.')
  const actualFeatures = config.features as Record<string, unknown> | undefined
  for (const [name, enabled] of Object.entries(chatFeatureOverrides(features))) {
    if (actualFeatures?.[name] !== enabled) throw new Error(`Codex chat feature restriction was not applied: ${name}`)
  }
  const servers = config.mcp_servers as Record<string, Record<string, unknown>> | undefined
  if (!servers || Object.keys(servers).length !== 1 || servers.conai?.url !== `http://127.0.0.1:${port}/mcp` || servers.conai.command || servers.conai.http_headers_helper) throw new Error('Codex chat MCP configuration is not isolated.')
  const projects = config.projects as Record<string, { trust_level?: unknown }> | undefined
  if (projects?.[cwd]?.trust_level !== 'untrusted') throw new Error('Codex chat project isolation could not be verified.')
  let cursor: string | null = null
  const seen = new Set<string>()
  for (let page = 0; page < 20; page++) {
    const result: { data?: Array<{ name?: unknown }>; nextCursor?: unknown } = await client.request('mcpServerStatus/list', { cursor, limit: 100, detail: 'full' })
    if (!Array.isArray(result.data) || result.data.some((server) => server.name !== 'conai')) throw new Error('Codex chat reported an unexpected MCP server.')
    if (result.nextCursor === null || result.nextCursor === undefined) return config
    if (typeof result.nextCursor !== 'string' || !result.nextCursor || seen.has(result.nextCursor)) throw new Error('Codex chat MCP inventory pagination could not be verified.')
    cursor = result.nextCursor
    seen.add(cursor)
  }
  throw new Error('Codex chat MCP inventory was incomplete.')
}

export function chatTurnRestrictions(cwd: string) {
  return { cwd, approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly', networkAccess: false } }
}
