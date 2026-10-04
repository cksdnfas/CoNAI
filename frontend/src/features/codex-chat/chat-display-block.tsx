import { createContext, useContext, useLayoutEffect, useRef } from 'react'
import type { ChatDisplayBlock } from '@/lib/api-codex-chat'

/*
 * Display blocks: the profile author writes an HTML template with {{field}} slots (and CSS); the model only writes a
 * ```key fenced block of JSON values. Values are inserted as escaped text, the filled HTML is stripped of anything
 * executable, and the result lives in a shadow root so the author's CSS cannot reach the app.
 *
 * Template syntax (a small Mustache subset):
 *   {{field}} {{a.b}}               value (arrays join with ", ")
 *   {{#each list}}…{{/each}}        repeat; inside, {{.}} is the item and {{field}} reads the item first
 *   {{#if field}}…{{else}}…{{/if}}  when the value is non-empty / non-zero / true
 */

type TemplateNode =
  | { kind: 'text'; value: string }
  | { kind: 'value'; path: string }
  | { kind: 'each'; path: string; children: TemplateNode[] }
  | { kind: 'if'; path: string; children: TemplateNode[]; otherwise: TemplateNode[] }

const TAG_PATTERN = /\{\{\s*([#/]?)\s*([^}]*?)\s*\}\}/g

function parseTemplate(template: string): TemplateNode[] {
  const root: TemplateNode[] = []
  const stack: Array<{ node: Extract<TemplateNode, { kind: 'each' | 'if' }>; inElse: boolean }> = []
  const current = () => {
    const top = stack[stack.length - 1]
    if (!top) return root
    return top.node.kind === 'if' && top.inElse ? top.node.otherwise : top.node.children
  }
  let cursor = 0
  for (const match of template.matchAll(TAG_PATTERN)) {
    const index = match.index ?? 0
    if (index > cursor) current().push({ kind: 'text', value: template.slice(cursor, index) })
    cursor = index + match[0].length
    const [, sigil, body] = match
    if (sigil === '#') {
      const [keyword, path = ''] = body.split(/\s+/, 2)
      if (keyword === 'each' || keyword === 'if') {
        const node = keyword === 'each' ? { kind: 'each' as const, path, children: [] } : { kind: 'if' as const, path, children: [], otherwise: [] }
        current().push(node)
        stack.push({ node, inElse: false })
      }
    } else if (sigil === '/') {
      stack.pop()
    } else if (body === 'else') {
      const top = stack[stack.length - 1]
      if (top) top.inElse = true
    } else if (body) {
      current().push({ kind: 'value', path: body })
    }
  }
  if (cursor < template.length) current().push({ kind: 'text', value: template.slice(cursor) })
  return root
}

function lookup(scopes: unknown[], path: string): unknown {
  if (path === '.') return scopes[scopes.length - 1]
  const parts = path.split('.')
  for (let index = scopes.length - 1; index >= 0; index -= 1) {
    let value: unknown = scopes[index]
    let found = true
    for (const part of parts) {
      if (value && typeof value === 'object' && part in (value as Record<string, unknown>)) {
        value = (value as Record<string, unknown>)[part]
      } else {
        found = false
        break
      }
    }
    if (found) return value
  }
  return undefined
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(toText).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function isTruthy(value: unknown) {
  if (Array.isArray(value)) return value.length > 0
  return value !== undefined && value !== null && value !== false && value !== '' && value !== 0 && value !== '0'
}

function renderNodes(nodes: TemplateNode[], scopes: unknown[]): string {
  return nodes.map((node) => {
    switch (node.kind) {
      case 'text':
        return node.value
      case 'value':
        return escapeHtml(toText(lookup(scopes, node.path)))
      case 'each': {
        const list = lookup(scopes, node.path)
        return Array.isArray(list) ? list.map((item) => renderNodes(node.children, [...scopes, item])).join('') : ''
      }
      case 'if':
        return renderNodes(isTruthy(lookup(scopes, node.path)) ? node.children : node.otherwise, scopes)
    }
  }).join('')
}

const BLOCKED_TAGS = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'option', 'noscript', 'template', 'foreignobject', 'animate', 'set', 'animatetransform', 'animatemotion', 'portal'])
const URL_ATTRIBUTES = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'background', 'poster'])

/** Removes scripts, event handlers, frames, forms and script URLs; what is left is markup and inline style. */
function sanitizeInto(html: string) {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  for (const element of Array.from(parsed.body.querySelectorAll('*'))) {
    if (BLOCKED_TAGS.has(element.tagName.toLowerCase())) {
      element.remove()
      continue
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      // Browsers ignore whitespace and control characters inside a URL scheme ("java\tscript:").
      const value = Array.from(attribute.value).filter((char) => char > ' ').join('').toLowerCase()
      const scriptUrl = URL_ATTRIBUTES.has(name) && (value.startsWith('javascript:') || value.startsWith('vbscript:') || value.startsWith('data:text/html'))
      if (name.startsWith('on') || name === 'srcdoc' || scriptUrl) {
        element.removeAttribute(attribute.name)
      }
    }
    if (element.tagName.toLowerCase() === 'a') {
      element.setAttribute('target', '_blank')
      element.setAttribute('rel', 'noreferrer noopener')
    }
  }
  return Array.from(parsed.body.childNodes)
}

/** Values the model wrote: JSON, or `field: value` lines when it slipped. Null when nothing usable was written. */
export function parseBlockPayload(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    return { value: parsed }
  } catch {
    const entries = trimmed.split('\n').map((line) => /^\s*"?([\w.-]+)"?\s*[:=]\s*(.+?)\s*,?\s*$/.exec(line)).filter((match): match is RegExpExecArray => match !== null)
    return entries.length > 0 ? Object.fromEntries(entries.map(([, key, value]) => [key, value.replace(/^"(.*)"$/, '$1')])) : null
  }
}

/** One filled-in block, isolated in a shadow root. */
export function ChatDisplayBlockView({ block, data }: { block: Pick<ChatDisplayBlock, 'template' | 'css'>; data: Record<string, unknown> }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const html = renderNodes(parseTemplate(block.template), [data])

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    // Built as a text node, so a stray "</style>" in the CSS cannot open markup.
    style.textContent = `:host{display:block}*{box-sizing:border-box}${block.css}`
    root.replaceChildren(style, ...sanitizeInto(html).map((node) => document.importNode(node, true)))
  }, [block.css, html])

  return <div ref={hostRef} className="my-2" />
}

/** The display blocks of the profile whose reply is being rendered, by fence name. */
export const ChatDisplayBlocksContext = createContext<Map<string, ChatDisplayBlock> | null>(null)

export function useChatDisplayBlock(key: string | null) {
  const blocks = useContext(ChatDisplayBlocksContext)
  return key ? blocks?.get(key) ?? null : null
}
