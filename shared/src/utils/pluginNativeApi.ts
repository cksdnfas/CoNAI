/** Discovery metadata, not an allowlist. Keep legacy entries for older plugins using exact includes checks. */
export const PLUGIN_NATIVE_API_ROOTS = [
  '/api',
  '/api/images', '/api/groups', '/api/files', '/api/workspaces', '/api/posts', '/api/audio', '/api/sprite',
  '/api/prompt-collection', '/api/prompt-groups', '/api/negative-prompt-groups', '/api/prompt-presets', '/api/wildcards',
  '/api/workflows', '/api/graph-workflows', '/api/module-definitions', '/api/custom-dropdown-lists',
  '/api/workflow-input-assets', '/api/generation-history', '/api/generation-queue', '/api/image-editor',
  '/api/jobs', '/api/page-settings', '/api/runtime-appearance', '/api/runtime-media-settings',
  '/api/settings/general', '/api/settings/appearance',
  '/api/codex-chat/profiles', '/api/codex-chat/threads', '/api/codex-chat/lorebooks',
  '/api/codex-chat/admin/profiles', '/api/codex-chat/admin/lorebooks', '/api/codex-chat/admin/blocks', '/api/codex-chat/admin/chat-assets',
  '/api/chat-routines', '/api/character-library',
] as const

/** Check the original path before URL normalization, so encoded traversal cannot cross a feature boundary. */
export function pluginNativeApiPath(input: string, origins: readonly string[]): string {
  if (typeof input !== 'string' || input.length > 4000 || /[\\\u0000-\u0020#]/.test(input)) throw new Error('앱 API 경로가 올바르지 않아.')
  const rawPath = input.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
  if (!rawPath.startsWith('/api/')) throw new Error('앱의 /api 경로만 사용할 수 있어.')
  for (const part of rawPath.split('/')) {
    const decoded = decodeURIComponent(part)
    if (decoded === '.' || decoded === '..' || /[/\\%\u0000-\u001f]/.test(decoded)) throw new Error('허용하지 않는 앱 API 경로야.')
  }
  const url = new URL(input, origins[0])
  if (!origins.includes(url.origin) || url.username || url.password) throw new Error('다른 서버로 요청할 수 없어.')
  return `${url.pathname}${url.search}`
}

/** Custom feature headers are allowed; the host, not the plugin request, supplies caller identity. */
export function pluginNativeApiHeaders(input: Record<string, string> = {}): Headers {
  const headers = new Headers(input)
  for (const name of headers.keys()) {
    if (/^(?:authorization|proxy-authorization|cookie|host|origin|referer|forwarded|connection|content-length|x-conai-plugin-call)$|^(?:x-forwarded-|sec-)/i.test(name)) throw new Error('인증·연결 헤더는 앱이 관리해.')
  }
  return headers
}

/** No plugin-specific deadline; callers may set one and can always cancel. */
export const PLUGIN_REQUEST_TIMEOUT_MS = 0
export const PLUGIN_SDK_FEATURES = ['app.fetch', 'app.cancel', 'app.wait', 'media.open', 'preview', 'storage', 'events', 'navigation', 'request.abort', 'errors.structured', 'llm.asset', 'llm.profile', 'llm.judge', 'llm.decide', 'llm.measure', 'llm.room', 'llm.forgetRooms', 'llm.discard', 'page.form', 'launch.image', 'pickMedia'] as const
