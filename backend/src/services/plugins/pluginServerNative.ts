import crypto from 'node:crypto'
import { createServer } from 'node:http'
import type { Express, NextFunction, Request, Response } from 'express'
import { pluginNativeApiPath } from '@conai/shared'
import type { McpRequester } from '../../mcp/context'
import { AuthAccount } from '../../models/AuthAccount'
import { hasConfiguredAuth } from '../auth/sessionAccess'
import { AuthAccessControlService, getResolvedAuthAccessEpoch } from '../authAccessControlService'
import { isDirectLoopbackRequest } from '../../utils/bootstrapAccess'
import { PluginError } from './pluginStore'

/**
 * `conai.app.fetch` for server modules: the same native feature routes a plugin page reaches with `api.app.fetch`
 * (`PLUGIN_NATIVE_API_ROOTS`), run as the account the call belongs to. The host sends the request through its own
 * Express app on a private loopback port with a one-time grant bound to that account, method and exact path; the
 * grant becomes a request-only session (never stored, no cookie), so every route keeps its own permission, ownership,
 * revision and body checks. Login, credentials and server administration stay outside, as for pages.
 */
const CALL_HEADER = 'x-conai-plugin-call'
const GRANT_TTL_MS = 10 * 60_000
/** The response is buffered for the worker: a host memory bound, not an API rule. Media goes through conai.media. */
const RESPONSE_MAX_BYTES = 64 * 1024 * 1024
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'])
const HEADERS = new Set(['accept', 'content-type', 'if-match', 'if-none-match', 'range'])
const NULL_BODY = new Set([101, 103, 204, 205, 304])

type Grant = { accountId: number | null; method: string; path: string; expiresAt: number }
const grants = new Map<string, Grant>()
let nativeApp: Express | null = null
let loopback: Promise<string> | null = null

/** The API process registers its app once; server modules call it through a private loopback listener. */
export function setPluginNativeApp(app: Express) {
  nativeApp = app
}

function loopbackOrigin(): Promise<string> {
  const app = nativeApp
  if (!app) return Promise.reject(new PluginError('앱 API가 아직 준비되지 않았어.', 503))
  loopback ??= new Promise<string>((resolve, reject) => {
    const server = createServer(app)
    server.once('error', (error) => { loopback = null; reject(error) })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') { loopback = null; reject(new Error('플러그인 앱 API 연결을 열지 못했어.')); return }
      server.unref()
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })
  return loopback
}

/** A session object for one request only: express-session sees it already set and neither stores it nor sets a cookie. */
function requestSession(accountId: number | null) {
  const done = (callback?: (error?: unknown) => void) => { callback?.() }
  const session: Record<string, unknown> = { cookie: { originalMaxAge: null, maxAge: null }, save: done, reload: done, regenerate: done, destroy: done }
  session.touch = () => session
  session.resetMaxAge = () => session
  // No configured auth: the app's own bootstrap rule fills this in for the loopback request.
  if (accountId === null) return session
  const account = AuthAccount.findById(accountId)
  if (!account || account.status !== 'active') return null
  const access = AuthAccessControlService.resolveForAccountId(accountId)
  return Object.assign(session, {
    authenticated: true, username: account.username, accountId, accountType: account.account_type,
    groupKeys: access.groupKeys, permissionKeys: access.permissionKeys, accessCacheAccountId: accountId, accessCacheEpoch: getResolvedAuthAccessEpoch(),
  })
}

/**
 * Installed before the session middleware. A request without the header is untouched; one with it must present an
 * unused grant for its exact method and path over a direct loopback connection, or it is refused outright.
 */
export function pluginNativeCallSession(req: Request, res: Response, next: NextFunction) {
  const header = req.headers[CALL_HEADER]
  if (header === undefined) { next(); return }
  const token = Array.isArray(header) ? header[0] : header
  const grant = grants.get(token)
  if (grant) grants.delete(token)
  const session = grant && grant.expiresAt > Date.now() && grant.method === req.method && grant.path === req.originalUrl && isDirectLoopbackRequest(req)
    && !(grant.accountId === null && hasConfiguredAuth()) ? requestSession(grant.accountId) : null
  if (!session) { res.status(401).json({ error: 'Invalid plugin call' }); return }
  req.session = session as unknown as Request['session']
  ;(req as { sessionID: string }).sessionID = `plugin-call:${crypto.randomUUID()}`
  next()
}

function requestBody(value: unknown): string | Uint8Array<ArrayBuffer> | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  // A copy: the view may sit on a shared buffer, which fetch does not take.
  if (ArrayBuffer.isView(value)) return new Uint8Array(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
  throw new PluginError('body에는 문자열·ArrayBuffer·바이트 배열을 써줘.', 400)
}

/** One native call from a server module, returning the status, headers and the whole body for the worker. */
export async function callPluginServerNative(requester: McpRequester | undefined, raw: unknown, signal?: AbortSignal) {
  // Without an account nothing would bound the call; the module's own work runs as the administrator who enabled it.
  if (!requester) throw new PluginError('계정이 연결된 호출에서만 앱 API를 쓸 수 있어.', 403)
  const input = (raw && typeof raw === 'object' ? raw : {}) as { path?: unknown; method?: unknown; headers?: unknown; body?: unknown }
  const origin = await loopbackOrigin()
  let path: string
  try { path = pluginNativeApiPath(String(input.path ?? ''), [origin]) } catch (error) { throw new PluginError(error instanceof Error ? error.message : String(error), 400) }
  const method = typeof input.method === 'string' ? input.method.toUpperCase() : 'GET'
  if (!METHODS.has(method)) throw new PluginError('지원하지 않는 HTTP 메서드야.', 400)
  const headers: Record<string, string> = {}
  if (input.headers !== undefined) {
    if (!input.headers || typeof input.headers !== 'object' || Array.isArray(input.headers)) throw new PluginError('headers는 이름과 문자열 값의 객체로 보내줘.', 400)
    for (const [name, value] of Object.entries(input.headers)) {
      if (!HEADERS.has(name.toLowerCase()) || typeof value !== 'string' || value.length > 1000) throw new PluginError('이 요청 헤더는 사용할 수 없어.', 400)
      headers[name] = value
    }
  }
  const body = requestBody(input.body)
  if ((method === 'GET' || method === 'HEAD') && body !== undefined) throw new PluginError('조회 요청에는 본문을 넣을 수 없어.', 400)
  const token = crypto.randomBytes(32).toString('base64url')
  grants.set(token, { accountId: requester.accountId, method, path, expiresAt: Date.now() + GRANT_TTL_MS })
  try {
    const response = await fetch(`${origin}${path}`, { method, headers: { ...headers, [CALL_HEADER]: token }, body, redirect: 'error', signal })
    const chunks: Uint8Array[] = []
    let size = 0
    if (response.body && !NULL_BODY.has(response.status)) {
      const reader = response.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > RESPONSE_MAX_BYTES) {
          await reader.cancel().catch(() => undefined)
          throw new PluginError('앱 API 응답이 64 MiB를 넘었어. 범위를 나눠 조회하고, 미디어는 conai.media로 읽어줘.', 413)
        }
        chunks.push(value)
      }
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return {
      status: response.status, statusText: response.statusText,
      headers: [...response.headers].filter(([name]) => name.toLowerCase() !== 'set-cookie'),
      body: NULL_BODY.has(response.status) ? null : bytes.buffer,
    }
  } finally {
    grants.delete(token)
  }
}
