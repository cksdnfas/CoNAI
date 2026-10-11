import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { runtimePaths } from '../../config/runtimePaths'

/**
 * Outside MCP servers an administrator connects (a search engine, a browser, a company wiki…). Their tools reach the
 * chats through the app's own MCP server (tools/externalMcpTools.ts), never directly: Codex and Claude Code keep seeing
 * only `conai`, and every call goes through the usual access checks. One client per server stays connected; its tool
 * list is kept here so the tool registration (which is synchronous) can read it.
 */

export const EXTERNAL_MCP_SCOPES = ['read', 'organize', 'configure'] as const
export type ExternalMcpScope = typeof EXTERNAL_MCP_SCOPES[number]
export const EXTERNAL_MCP_TRANSPORTS = ['http', 'stdio'] as const
export type ExternalMcpTransport = typeof EXTERNAL_MCP_TRANSPORTS[number]

/** As stored. `headers` / `env` hold secrets (API keys) and never leave the server. */
export type ExternalMcpServerConfig = {
  id: string
  name: string
  enabled: boolean
  transport: ExternalMcpTransport
  url: string | null
  headers: Record<string, string>
  command: string | null
  args: string[]
  env: Record<string, string>
  /** The chat tool scope its tools count as: read and organize follow each profile's scopes, configure is administrators only. */
  scope: ExternalMcpScope
  timeoutSeconds: number
  /** Remote tool names left out. */
  disabledTools: string[]
}

export type ExternalMcpTool = { name: string; remoteName: string; serverId: string; serverName: string; scope: ExternalMcpScope; description: string; inputSchema: Record<string, unknown> }

export type ExternalMcpStatus = { state: 'off' | 'connecting' | 'ready' | 'error'; error: string | null; tools: Array<{ name: string; remoteName: string; description: string; enabled: boolean }>; refreshedAt: string | null }

/** What the settings screen gets: secrets by name only. */
export type ExternalMcpServerView = Omit<ExternalMcpServerConfig, 'headers' | 'env'> & { headerNames: string[]; envNames: string[]; status: ExternalMcpStatus }

/** An edit: a header or variable given without a value keeps the stored one; one left out is removed. */
export type ExternalMcpServerInput = Omit<ExternalMcpServerConfig, 'headers' | 'env'> & { headers: Array<{ name: string; value?: string }>; env: Array<{ name: string; value?: string }> }

export class ExternalMcpError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

const CONFIG_FILE_PATH = () => path.join(runtimePaths.basePath, 'config', 'external-mcp.json')
const SERVER_ID_PATTERN = /^[a-z][a-z0-9]{0,15}$/
const HEADER_NAME_PATTERN = /^[A-Za-z0-9-]{1,100}$/
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/
const MAX_SERVERS = 20
const MAX_TOOLS_PER_SERVER = 100
const CONNECT_TIMEOUT_MS = 30_000
export const DEFAULT_EXTERNAL_TIMEOUT_SECONDS = 60
const MAX_TIMEOUT_SECONDS = 600
// Profile allowlists keep names of lowercase letters, digits and _ only, and Claude Code sees `mcp__conai__<name>`
// under its 64-character limit.
const TOOL_NAME_MAX = 52
export const EXTERNAL_TOOL_PREFIX = 'x_'

let cachedConfig: ExternalMcpServerConfig[] | null = null

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function record(value: unknown, namePattern: RegExp): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([name, item]) => namePattern.test(name) && typeof item === 'string').map(([name, item]) => [name, (item as string).slice(0, 4000)]))
}

function normalizeServer(value: unknown): ExternalMcpServerConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const id = text(input.id, 16)
  if (!SERVER_ID_PATTERN.test(id)) return null
  const transport = EXTERNAL_MCP_TRANSPORTS.includes(input.transport as ExternalMcpTransport) ? input.transport as ExternalMcpTransport : 'http'
  const timeout = Number(input.timeoutSeconds)
  return {
    id,
    name: text(input.name, 60) || id,
    enabled: input.enabled !== false,
    transport,
    url: transport === 'http' ? text(input.url, 2000) || null : null,
    headers: transport === 'http' ? record(input.headers, HEADER_NAME_PATTERN) : {},
    command: transport === 'stdio' ? text(input.command, 500) || null : null,
    args: transport === 'stdio' && Array.isArray(input.args) ? input.args.filter((arg): arg is string => typeof arg === 'string').slice(0, 50).map((arg) => arg.slice(0, 1000)) : [],
    env: transport === 'stdio' ? record(input.env, ENV_NAME_PATTERN) : {},
    scope: EXTERNAL_MCP_SCOPES.includes(input.scope as ExternalMcpScope) ? input.scope as ExternalMcpScope : 'configure',
    timeoutSeconds: Number.isInteger(timeout) && timeout >= 5 && timeout <= MAX_TIMEOUT_SECONDS ? timeout : DEFAULT_EXTERNAL_TIMEOUT_SECONDS,
    disabledTools: Array.isArray(input.disabledTools) ? [...new Set(input.disabledTools.filter((name): name is string => typeof name === 'string').map((name) => name.slice(0, 200)))].slice(0, 500) : [],
  }
}

export function loadExternalMcpServers(): ExternalMcpServerConfig[] {
  if (!cachedConfig) {
    try {
      const stored = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH(), 'utf8')) as { servers?: unknown[] }
      const servers = (Array.isArray(stored.servers) ? stored.servers : []).map(normalizeServer).filter((server): server is ExternalMcpServerConfig => server !== null)
      cachedConfig = servers.filter((server, index) => servers.findIndex((other) => other.id === server.id) === index).slice(0, MAX_SERVERS)
    } catch {
      cachedConfig = []
    }
  }
  return cachedConfig
}

function saveServers(servers: ExternalMcpServerConfig[]) {
  const file = CONFIG_FILE_PATH()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ servers }, null, 2), 'utf8')
  cachedConfig = servers
}

function secretsFrom(entries: unknown, previous: Record<string, string>, namePattern: RegExp, label: string) {
  if (!Array.isArray(entries)) throw new ExternalMcpError(`${label} 형식이 잘못됐어.`)
  const result: Record<string, string> = {}
  for (const entry of entries) {
    const name = text((entry as { name?: unknown })?.name, 100)
    if (!namePattern.test(name)) throw new ExternalMcpError(`${label} 이름이 잘못됐어: ${name || '(빈 이름)'}`)
    const value = (entry as { value?: unknown }).value
    if (value === undefined || value === null) {
      if (!(name in previous)) throw new ExternalMcpError(`${label} ${name}의 값을 적어줘.`)
      result[name] = previous[name]
    } else if (typeof value === 'string') {
      result[name] = value.slice(0, 4000)
    } else {
      throw new ExternalMcpError(`${label} ${name}의 값이 잘못됐어.`)
    }
  }
  return result
}

/** Adds (no `previousId`) or replaces a server. Reconnects it with the new settings. */
export function saveExternalMcpServer(input: ExternalMcpServerInput, previousId?: string) {
  const servers = loadExternalMcpServers()
  const previous = previousId ? servers.find((server) => server.id === previousId) : undefined
  if (previousId && !previous) throw new ExternalMcpError('서버를 찾을 수 없어.', 404)
  const id = text(input?.id, 16)
  if (!SERVER_ID_PATTERN.test(id)) throw new ExternalMcpError('ID는 영문 소문자로 시작하는 소문자·숫자 16자 이내로 적어줘.')
  if (servers.some((server) => server.id === id && server !== previous)) throw new ExternalMcpError('같은 ID의 서버가 이미 있어.', 409)
  if (!previous && servers.length >= MAX_SERVERS) throw new ExternalMcpError(`외부 MCP 서버는 ${MAX_SERVERS}개까지야.`)
  const transport = input.transport
  if (!EXTERNAL_MCP_TRANSPORTS.includes(transport)) throw new ExternalMcpError('연결 방식이 잘못됐어.')
  if (!EXTERNAL_MCP_SCOPES.includes(input.scope)) throw new ExternalMcpError('도구 범위가 잘못됐어.')
  const headers = transport === 'http' ? secretsFrom(input.headers ?? [], previous?.headers ?? {}, HEADER_NAME_PATTERN, '헤더') : {}
  const env = transport === 'stdio' ? secretsFrom(input.env ?? [], previous?.env ?? {}, ENV_NAME_PATTERN, '환경 변수') : {}
  const server = normalizeServer({ ...input, id, headers, env })!
  if (transport === 'http') {
    let url: URL
    try { url = new URL(server.url ?? '') } catch { throw new ExternalMcpError('서버 주소를 http(s) 주소로 적어줘.') }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ExternalMcpError('서버 주소를 http(s) 주소로 적어줘.')
  } else if (!server.command) {
    throw new ExternalMcpError('실행할 명령을 적어줘.')
  }
  const next = previous ? servers.map((item) => (item === previous ? server : item)) : [...servers, server]
  saveServers(next)
  if (previous) void disconnect(previous.id)
  if (server.enabled) void refreshExternalMcpServer(server.id)
  return server
}

export function deleteExternalMcpServer(id: string) {
  const servers = loadExternalMcpServers()
  if (!servers.some((server) => server.id === id)) throw new ExternalMcpError('서버를 찾을 수 없어.', 404)
  saveServers(servers.filter((server) => server.id !== id))
  void disconnect(id)
}

/** Switches a server or one of its tools on or off without touching its secrets. */
export function setExternalMcpEnabled(id: string, patch: { enabled?: boolean; tool?: { remoteName: string; enabled: boolean } }) {
  const servers = loadExternalMcpServers()
  const server = servers.find((item) => item.id === id)
  if (!server) throw new ExternalMcpError('서버를 찾을 수 없어.', 404)
  const next = { ...server }
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled
  if (patch.tool) {
    const others = server.disabledTools.filter((name) => name !== patch.tool!.remoteName)
    next.disabledTools = patch.tool.enabled ? others : [...others, patch.tool.remoteName]
  }
  saveServers(servers.map((item) => (item === server ? next : item)))
  if (!next.enabled) void disconnect(id)
  else if (!server.enabled) void refreshExternalMcpServer(id)
  return next
}

// ---- connections -------------------------------------------------------------------------------------------------

type RemoteTool = { remoteName: string; name: string; description: string; inputSchema: Record<string, unknown> }
type Connection = {
  state: 'connecting' | 'ready' | 'error'
  error: string | null
  client: Client | null
  tools: RemoteTool[]
  refreshedAt: string | null
  /** The settings it was made with: a change makes a new connection. */
  signature: string
  pending: Promise<void> | null
  stderr: string
}

const connections = new Map<string, Connection>()

function connectionSignature(server: ExternalMcpServerConfig) {
  return createHash('sha1').update(JSON.stringify([server.transport, server.url, server.headers, server.command, server.args, server.env])).digest('hex')
}

/** `x_<server>_<tool>`, made safe for every engine's function names; a long one keeps a hash of the rest. */
export function externalToolName(serverId: string, remoteName: string) {
  const name = `${EXTERNAL_TOOL_PREFIX}${serverId}_${remoteName.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`
  if (name.length <= TOOL_NAME_MAX) return name
  return `${name.slice(0, TOOL_NAME_MAX - 9)}_${createHash('sha1').update(remoteName).digest('hex').slice(0, 8)}`
}

function errorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}

function withTimeout<T>(work: Promise<T>, ms: number, message: string) {
  let timer: NodeJS.Timeout | undefined
  return Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms) })]).finally(() => clearTimeout(timer))
}

function schemaOf(value: unknown): Record<string, unknown> {
  // Tools must take an object; anything else becomes an empty object schema.
  return value && typeof value === 'object' && !Array.isArray(value) && (value as { type?: unknown }).type === 'object' ? value as Record<string, unknown> : { type: 'object', properties: {} }
}

async function openClient(server: ExternalMcpServerConfig, connection: Connection) {
  const client = new Client({ name: 'conai', version: '1.0.0' })
  const transport = server.transport === 'http'
    ? new StreamableHTTPClientTransport(new URL(server.url!), { requestInit: { headers: server.headers } })
    : new StdioClientTransport({ command: server.command!, args: server.args, env: { ...getDefaultEnvironment(), ...server.env }, stderr: 'pipe' })
  if (transport instanceof StdioClientTransport) {
    // The last of what the process wrote to stderr explains a failed start.
    transport.stderr?.on('data', (chunk: Buffer) => { connection.stderr = (connection.stderr + chunk.toString('utf8')).slice(-2000) })
  }
  client.onclose = () => {
    if (connections.get(server.id) !== connection || connection.client !== client) return
    connection.client = null
    if (connection.state === 'ready') {
      connection.state = 'error'
      connection.error = '연결이 끊겼어. 다음 호출 때 다시 연결할게.'
    }
  }
  try {
    await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, '연결이 30초 안에 되지 않았어.')
  } catch (error) {
    await client.close().catch(() => {})
    const stderr = connection.stderr.trim().split('\n').slice(-3).join(' ').trim()
    throw new Error(stderr ? `${errorText(error)} (${stderr.slice(0, 300)})` : errorText(error))
  }
  return client
}

async function listRemoteTools(server: ExternalMcpServerConfig, client: Client) {
  const tools: RemoteTool[] = []
  let cursor: string | undefined
  do {
    const page = await withTimeout(client.listTools(cursor ? { cursor } : undefined), CONNECT_TIMEOUT_MS, '도구 목록을 30초 안에 받지 못했어.')
    for (const tool of page.tools) {
      if (tools.length >= MAX_TOOLS_PER_SERVER) break
      tools.push({ remoteName: tool.name, name: externalToolName(server.id, tool.name), description: (tool.description ?? '').slice(0, 2000), inputSchema: schemaOf(tool.inputSchema) })
    }
    cursor = page.nextCursor
  } while (cursor && tools.length < MAX_TOOLS_PER_SERVER)
  // Two remote names that sanitize alike: the later one is left out rather than shadowing the first.
  return tools.filter((tool, index) => tools.findIndex((other) => other.name === tool.name) === index)
}

/** (Re)connects a server and reads its tool list again. Resolves when done; the status says how it went. */
export function refreshExternalMcpServer(id: string): Promise<void> {
  const server = loadExternalMcpServers().find((item) => item.id === id)
  if (!server || !server.enabled) return disconnect(id)
  const signature = connectionSignature(server)
  const current = connections.get(id)
  if (current?.pending && current.signature === signature) return current.pending
  const connection: Connection = { state: 'connecting', error: null, client: null, tools: current?.signature === signature ? current.tools : [], refreshedAt: current?.refreshedAt ?? null, signature, pending: null, stderr: '' }
  const previousClient = current?.client
  connections.set(id, connection)
  connection.pending = (async () => {
    await previousClient?.close().catch(() => {})
    try {
      const client = await openClient(server, connection)
      if (connections.get(id) !== connection) {
        await client.close().catch(() => {})
        return
      }
      connection.client = client
      connection.tools = await listRemoteTools(server, client)
      connection.state = 'ready'
      connection.error = null
      connection.refreshedAt = new Date().toISOString()
    } catch (error) {
      if (connections.get(id) !== connection) return
      connection.state = 'error'
      connection.error = errorText(error)
      if (connection.client) await connection.client.close().catch(() => {})
      connection.client = null
    } finally {
      connection.pending = null
    }
  })()
  return connection.pending
}

async function disconnect(id: string) {
  const connection = connections.get(id)
  connections.delete(id)
  await connection?.client?.close().catch(() => {})
}

/** At startup: connect every enabled server in the background. */
export function startExternalMcpServers() {
  for (const server of loadExternalMcpServers()) {
    if (server.enabled) void refreshExternalMcpServer(server.id)
  }
}

export async function closeExternalMcpServers() {
  await Promise.all([...connections.keys()].map(disconnect))
}

export function externalMcpStatus(server: ExternalMcpServerConfig): ExternalMcpStatus {
  if (!server.enabled) return { state: 'off', error: null, tools: [], refreshedAt: null }
  const connection = connections.get(server.id)
  if (!connection) return { state: 'connecting', error: null, tools: [], refreshedAt: null }
  return {
    state: connection.state,
    error: connection.error,
    tools: connection.tools.map((tool) => ({ name: tool.name, remoteName: tool.remoteName, description: tool.description, enabled: !server.disabledTools.includes(tool.remoteName) })),
    refreshedAt: connection.refreshedAt,
  }
}

export function externalMcpServerViews(): ExternalMcpServerView[] {
  return loadExternalMcpServers().map(({ headers, env, ...server }) => ({ ...server, headerNames: Object.keys(headers), envNames: Object.keys(env), status: externalMcpStatus({ ...server, headers, env }) }))
}

/**
 * Every tool chats can be offered now: enabled servers whose list is known (a server that dropped its connection
 * keeps its last list; a call reconnects), minus the tools switched off.
 */
export function externalMcpTools(): ExternalMcpTool[] {
  const result: ExternalMcpTool[] = []
  for (const server of loadExternalMcpServers()) {
    if (!server.enabled) continue
    const connection = connections.get(server.id)
    if (!connection || connection.signature !== connectionSignature(server)) continue
    for (const tool of connection.tools) {
      if (server.disabledTools.includes(tool.remoteName)) continue
      result.push({ ...tool, serverId: server.id, serverName: server.name, scope: server.scope })
    }
  }
  return result
}

export function findExternalMcpTool(name: string) {
  return name.startsWith(EXTERNAL_TOOL_PREFIX) ? externalMcpTools().find((tool) => tool.name === name) ?? null : null
}

/** Changes with the offered tools (Codex sessions read their tool list once, so a change needs a new session). */
export function externalMcpToolsSignature() {
  const tools = externalMcpTools()
  return tools.length === 0 ? '' : createHash('sha1').update(JSON.stringify(tools.map((tool) => [tool.name, tool.scope, tool.description, tool.inputSchema]))).digest('hex').slice(0, 12)
}

const RESULT_TEXT_MAX = 50_000
const RESULT_IMAGE_MAX = 4 * 1024 * 1024

type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

/** Calls a remote tool with the server's timeout; the result keeps its text and images, cut to a size a chat can carry. */
export async function callExternalMcpTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ content: ToolContent[]; isError?: boolean }> {
  const tool = findExternalMcpTool(name)
  if (!tool) throw new ExternalMcpError('이 외부 도구는 지금 쓸 수 없어.', 404)
  const server = loadExternalMcpServers().find((item) => item.id === tool.serverId)!
  let connection = connections.get(server.id)
  if (!connection?.client) {
    await refreshExternalMcpServer(server.id)
    connection = connections.get(server.id)
  }
  if (!connection?.client) throw new ExternalMcpError(`${server.name}에 연결하지 못했어: ${connection?.error ?? '알 수 없는 오류'}`, 502)
  const result = await connection.client.callTool({ name: tool.remoteName, arguments: args }, { signal, timeout: server.timeoutSeconds * 1000 })
  const content: ToolContent[] = []
  let textLeft = RESULT_TEXT_MAX
  const addText = (value: string) => {
    if (textLeft <= 0) return
    const part = value.length > textLeft ? `${value.slice(0, textLeft)}\n…(cut)` : value
    textLeft -= part.length
    content.push({ type: 'text', text: part })
  }
  for (const item of (result.content ?? []) as Array<Record<string, unknown>>) {
    if (item.type === 'text' && typeof item.text === 'string') addText(item.text)
    else if (item.type === 'image' && typeof item.data === 'string' && typeof item.mimeType === 'string' && item.data.length <= RESULT_IMAGE_MAX) content.push({ type: 'image', data: item.data, mimeType: item.mimeType })
    else if (item.type === 'resource' && item.resource && typeof (item.resource as { text?: unknown }).text === 'string') addText((item.resource as { text: string }).text)
    else if (item.type === 'resource_link' && typeof item.uri === 'string') addText(`[${typeof item.name === 'string' ? item.name : 'link'}] ${item.uri}`)
  }
  if (content.length === 0 && result.structuredContent) addText(JSON.stringify(result.structuredContent))
  if (content.length === 0) content.push({ type: 'text', text: '(빈 결과)' })
  return { content, ...(result.isError ? { isError: true } : {}) }
}
