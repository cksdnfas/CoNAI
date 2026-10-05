import { createContext, useContext, useLayoutEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { Activity } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ChatBlockChange, ChatBlocksState, ChatDisplayBlock } from '@/lib/api-codex-chat'
import { useI18n } from '@/i18n'

/*
 * Display blocks: the profile author writes an HTML template with {{field}} slots (and CSS); the model only writes a
 * ```key fenced block of JSON values. Values are inserted as escaped text, the filled HTML is stripped of anything
 * executable, and the result lives in a shadow root so the author's CSS cannot reach the app.
 *
 * Template syntax (a small Mustache subset with expressions):
 *   {{field}} {{a.b}} {{.}}          value (arrays join with ", ")
 *   {{hp / maxhp * 100}}            arithmetic (+ - * / %), comparisons (== != < <= > >=), && || !, parentheses
 *   {{round(x, 1)}}                 round floor ceil abs min max clamp(x, lo, hi) pct(x, max) len(list) join(list, sep)
 *   {{#each list}}…{{/each}}        repeat; inside, {{.}} is the item and {{field}} reads the item first
 *   {{#if expr}}…{{else}}…{{/if}}  when the value is non-empty / non-zero / true (or the comparison holds)
 *   data-pick="label"               a clickable element: the label goes with the next message as the user's choice
 *   data-set="field=value"          a clickable element: sets that field of the block by hand
 */

type TemplateNode =
  | { kind: 'text'; value: string }
  | { kind: 'value'; expr: Expr }
  | { kind: 'each'; expr: Expr; children: TemplateNode[] }
  | { kind: 'if'; expr: Expr; children: TemplateNode[]; otherwise: TemplateNode[] }

type Expr =
  | { kind: 'lit'; value: unknown }
  | { kind: 'path'; path: string }
  | { kind: 'unary'; op: '!' | '-'; arg: Expr }
  | { kind: 'binary'; op: string; left: Expr; right: Expr }
  | { kind: 'call'; name: string; args: Expr[] }

const TAG_PATTERN = /\{\{\s*([#/]?)\s*([^}]*?)\s*\}\}/g

// ---- Expressions ---------------------------------------------------------------------------------------------

type Token = { type: 'num' | 'str' | 'ident' | 'op' | 'end'; value: string }

/** A bare path (`a.b`, `.`, `max-hp`): what every template wrote before expressions existed. */
const PLAIN_PATH = /^[^\s()+*/%<>=!&|"',]+$/
const TOKEN_PATTERN = /\s*(?:(\d+(?:\.\d+)?)|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([\p{L}_$][\p{L}\p{N}_$.]*|\.)|(==|!=|<=|>=|&&|\|\||[-+*/%<>!(),]))/uy

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  TOKEN_PATTERN.lastIndex = 0
  let cursor = 0
  while (cursor < source.length) {
    TOKEN_PATTERN.lastIndex = cursor
    const match = TOKEN_PATTERN.exec(source)
    if (!match || match.index !== cursor) {
      if (!source.slice(cursor).trim()) break
      throw new Error(`bad expression: ${source}`)
    }
    cursor = TOKEN_PATTERN.lastIndex
    const [, num, dq, sq, ident, op] = match
    if (num !== undefined) tokens.push({ type: 'num', value: num })
    else if (dq !== undefined) tokens.push({ type: 'str', value: dq.replace(/\\(.)/g, '$1') })
    else if (sq !== undefined) tokens.push({ type: 'str', value: sq.replace(/\\(.)/g, '$1') })
    else if (ident !== undefined) tokens.push({ type: 'ident', value: ident })
    else if (op !== undefined) tokens.push({ type: 'op', value: op })
  }
  tokens.push({ type: 'end', value: '' })
  return tokens
}

const BINARY_LEVELS: string[][] = [['||'], ['&&'], ['==', '!='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']]

function parseExpression(source: string): Expr {
  const trimmed = source.trim()
  if (!trimmed) return { kind: 'lit', value: '' }
  if (PLAIN_PATH.test(trimmed)) return { kind: 'path', path: trimmed }
  const tokens = tokenize(trimmed)
  let index = 0
  const peek = () => tokens[index]
  const take = () => tokens[index++]
  const expectOp = (value: string) => {
    const token = take()
    if (token.type !== 'op' || token.value !== value) throw new Error(`expected ${value}`)
  }
  const binary = (level: number): Expr => {
    if (level >= BINARY_LEVELS.length) return unary()
    let left = binary(level + 1)
    while (peek().type === 'op' && BINARY_LEVELS[level].includes(peek().value)) {
      const op = take().value
      left = { kind: 'binary', op, left, right: binary(level + 1) }
    }
    return left
  }
  const unary = (): Expr => {
    if (peek().type === 'op' && (peek().value === '!' || peek().value === '-')) {
      const op = take().value as '!' | '-'
      return { kind: 'unary', op, arg: unary() }
    }
    return primary()
  }
  const primary = (): Expr => {
    const token = take()
    if (token.type === 'num') return { kind: 'lit', value: Number(token.value) }
    if (token.type === 'str') return { kind: 'lit', value: token.value }
    if (token.type === 'ident') {
      if (token.value === 'true' || token.value === 'false') return { kind: 'lit', value: token.value === 'true' }
      if (token.value === 'null') return { kind: 'lit', value: null }
      if (peek().type === 'op' && peek().value === '(') {
        take()
        const args: Expr[] = []
        if (!(peek().type === 'op' && peek().value === ')')) {
          args.push(binary(0))
          while (peek().type === 'op' && peek().value === ',') {
            take()
            args.push(binary(0))
          }
        }
        expectOp(')')
        return { kind: 'call', name: token.value, args }
      }
      return { kind: 'path', path: token.value }
    }
    if (token.type === 'op' && token.value === '(') {
      const inner = binary(0)
      expectOp(')')
      return inner
    }
    throw new Error('unexpected token')
  }
  const result = binary(0)
  if (peek().type !== 'end') throw new Error('trailing input')
  return result
}

/** A template tag's body as an expression; a tag that does not parse renders as empty rather than breaking the card. */
function safeExpression(source: string): Expr {
  try {
    return parseExpression(source)
  } catch {
    return { kind: 'lit', value: '' }
  }
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function compare(op: string, left: unknown, right: unknown): boolean {
  const a = asNumber(left)
  const b = asNumber(right)
  if (a !== null && b !== null) {
    switch (op) {
      case '<': return a < b
      case '<=': return a <= b
      case '>': return a > b
      case '>=': return a >= b
      case '==': return a === b
      default: return a !== b
    }
  }
  const x = toText(left)
  const y = toText(right)
  switch (op) {
    case '<': return x < y
    case '<=': return x <= y
    case '>': return x > y
    case '>=': return x >= y
    case '==': return x === y
    default: return x !== y
  }
}

const CALLS: Record<string, (args: unknown[]) => unknown> = {
  round: ([x, digits]) => { const n = asNumber(x); const d = Math.max(0, Math.min(6, asNumber(digits) ?? 0)); return n === null ? '' : Number(n.toFixed(d)) },
  floor: ([x]) => { const n = asNumber(x); return n === null ? '' : Math.floor(n) },
  ceil: ([x]) => { const n = asNumber(x); return n === null ? '' : Math.ceil(n) },
  abs: ([x]) => { const n = asNumber(x); return n === null ? '' : Math.abs(n) },
  min: (args) => { const numbers = args.map(asNumber).filter((n): n is number => n !== null); return numbers.length ? Math.min(...numbers) : '' },
  max: (args) => { const numbers = args.map(asNumber).filter((n): n is number => n !== null); return numbers.length ? Math.max(...numbers) : '' },
  clamp: ([x, lo, hi]) => { const n = asNumber(x); if (n === null) return ''; return Math.min(asNumber(hi) ?? n, Math.max(asNumber(lo) ?? n, n)) },
  /** `pct(x, max)`: x as a percentage of max, kept between 0 and 100 (bar widths). */
  pct: ([x, max]) => { const n = asNumber(x); const m = asNumber(max); return n === null || m === null || m === 0 ? 0 : Math.min(100, Math.max(0, (n / m) * 100)) },
  len: ([x]) => (Array.isArray(x) || typeof x === 'string' ? x.length : x && typeof x === 'object' ? Object.keys(x).length : 0),
  join: ([list, separator]) => (Array.isArray(list) ? list.map(toText).join(typeof separator === 'string' ? separator : ', ') : toText(list)),
}

function evaluate(expr: Expr, scopes: unknown[]): unknown {
  switch (expr.kind) {
    case 'lit': return expr.value
    case 'path': return lookup(scopes, expr.path)
    case 'unary': {
      const value = evaluate(expr.arg, scopes)
      if (expr.op === '!') return !isTruthy(value)
      const number = asNumber(value)
      return number === null ? '' : -number
    }
    case 'call': {
      const call = CALLS[expr.name]
      return call ? call(expr.args.map((arg) => evaluate(arg, scopes))) : ''
    }
    case 'binary': {
      if (expr.op === '&&') { const left = evaluate(expr.left, scopes); return isTruthy(left) ? evaluate(expr.right, scopes) : left }
      if (expr.op === '||') { const left = evaluate(expr.left, scopes); return isTruthy(left) ? left : evaluate(expr.right, scopes) }
      const left = evaluate(expr.left, scopes)
      const right = evaluate(expr.right, scopes)
      if (['==', '!=', '<', '<=', '>', '>='].includes(expr.op)) return compare(expr.op, left, right)
      const a = asNumber(left)
      const b = asNumber(right)
      if (expr.op === '+' && (a === null || b === null)) return `${toText(left)}${toText(right)}`
      if (a === null || b === null) return ''
      switch (expr.op) {
        case '+': return a + b
        case '-': return a - b
        case '*': return a * b
        case '/': return b === 0 ? '' : a / b
        default: return b === 0 ? '' : a % b
      }
    }
  }
}

// ---- Templates -----------------------------------------------------------------------------------------------

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
      const [keyword, ...rest] = body.split(/\s+/)
      const expr = safeExpression(rest.join(' '))
      if (keyword === 'each' || keyword === 'if') {
        const node = keyword === 'each' ? { kind: 'each' as const, expr, children: [] } : { kind: 'if' as const, expr, children: [], otherwise: [] }
        current().push(node)
        stack.push({ node, inElse: false })
      }
    } else if (sigil === '/') {
      stack.pop()
    } else if (body === 'else') {
      const top = stack[stack.length - 1]
      if (top) top.inElse = true
    } else if (body) {
      current().push({ kind: 'value', expr: safeExpression(body) })
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
  if (typeof value === 'number') return String(Number.isInteger(value) ? value : Number(value.toFixed(2)))
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
        return escapeHtml(toText(evaluate(node.expr, scopes)))
      case 'each': {
        const list = evaluate(node.expr, scopes)
        return Array.isArray(list) ? list.map((item) => renderNodes(node.children, [...scopes, item])).join('') : ''
      }
      case 'if':
        return renderNodes(isTruthy(evaluate(node.expr, scopes)) ? node.children : node.otherwise, scopes)
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

/** What a click inside a block asks for: `data-pick` chooses an item for the next message, `data-set` sets a field. */
export type BlockAction = { kind: 'pick'; label: string } | { kind: 'set'; field: string; value: unknown }

function pickLabel(element: HTMLElement) {
  return (element.dataset.pick || element.textContent || '').replace(/\s+/g, ' ').trim()
}

/** `data-set="field=value"`: the value is JSON when it parses (numbers, true, lists), else the text itself. */
function parseSet(spec: string): BlockAction | null {
  const separator = spec.indexOf('=')
  if (separator <= 0) return null
  const field = spec.slice(0, separator).trim()
  const raw = spec.slice(separator + 1).trim()
  if (!field) return null
  try {
    return { kind: 'set', field, value: JSON.parse(raw) }
  } catch {
    return { kind: 'set', field, value: raw }
  }
}

/** One filled-in block, isolated in a shadow root. `picked` marks `data-pick` elements with the `picked` class. */
const DEFAULT_BLOCK_CSS = '.dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;font-size:.9em}.dl dt{opacity:.65}.dl dd{margin:0;overflow-wrap:anywhere}'

/**
 * A block without a template shows every field as a plain label / value list. The template language cannot walk an
 * object's keys, so the list is built from the data at hand and rendered through the same sanitizer.
 */
export function defaultBlockTemplate(data: Record<string, unknown>) {
  return `<dl class="dl">${Object.keys(data).map((field) => `<dt>${escapeHtml(field)}</dt><dd>{{${field}}}</dd>`).join('')}</dl>`
}

export function ChatDisplayBlockView({ block, data, onAction, picked }: {
  block: Pick<ChatDisplayBlock, 'template' | 'css'>
  data: Record<string, unknown>
  onAction?: (action: BlockAction) => void
  picked?: ReadonlySet<string>
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const plain = !block.template.trim()
  const html = renderNodes(parseTemplate(plain ? defaultBlockTemplate(data) : block.template), [data])
  const css = plain ? DEFAULT_BLOCK_CSS + block.css : block.css

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    // Built as a text node, so a stray "</style>" in the CSS cannot open markup.
    style.textContent = `:host{display:block}*{box-sizing:border-box}[data-pick],[data-set]{cursor:pointer}${css}`
    const nodes = sanitizeInto(html).map((node) => document.importNode(node, true))
    root.replaceChildren(style, ...nodes)
    for (const element of Array.from(root.querySelectorAll<HTMLElement>('[data-pick]'))) {
      element.classList.toggle('picked', picked?.has(pickLabel(element)) ?? false)
    }
  }, [css, html, picked])

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!onAction) return
    for (const target of event.nativeEvent.composedPath()) {
      if (!(target instanceof HTMLElement)) continue
      if (target.dataset.pick !== undefined) {
        const label = pickLabel(target)
        if (label) onAction({ kind: 'pick', label })
        return
      }
      if (target.dataset.set !== undefined) {
        const action = parseSet(target.dataset.set)
        if (action) onAction(action)
        return
      }
      if (target === hostRef.current) return
    }
  }

  return <div ref={hostRef} className="my-2" onClick={handleClick} />
}

/** The template filled with `data`, as plain text (markup dropped, whitespace folded): for one-line summaries. */
export function renderBlockText(template: string, data: Record<string, unknown>) {
  const html = renderNodes(parseTemplate(template), [data])
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  return (parsed.body.textContent ?? '').replace(/\s+/g, ' ').trim()
}

const SUMMARY_FIELDS = 4

/** The strip line of a block: its summary template, else the first few scalar fields as `name value`. */
export function blockSummaryLine(block: Pick<ChatDisplayBlock, 'summary' | 'key'>, data: Record<string, unknown>) {
  if (block.summary.trim()) return renderBlockText(block.summary, data)
  return Object.entries(data)
    .filter(([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    .slice(0, SUMMARY_FIELDS)
    .map(([field, value]) => `${field} ${toText(value)}`)
    .join(' · ')
}

type Translate = (text: { ko: string; en: string }) => string

/** A change as the chips say it: `hp +5`, `mood 들뜸`, `+ 캔커피`, `− 연필`, `quest 삭제`. */
export function describeBlockChange(change: ChatBlockChange, t: Translate): string[] {
  const { field, from, to } = change
  if (to === undefined) return [`${field} ${t({ ko: '삭제', en: 'removed' })}`]
  if (typeof from === 'number' && typeof to === 'number') {
    const delta = to - from
    return [`${field} ${delta >= 0 ? '+' : '−'}${Math.abs(Math.round(delta * 100) / 100)}`]
  }
  if (Array.isArray(to)) {
    const before = Array.isArray(from) ? from.map(toText) : []
    const after = to.map(toText)
    const added = after.filter((item) => !before.includes(item)).map((item) => `+ ${item}`)
    const removed = before.filter((item) => !after.includes(item)).map((item) => `− ${item}`)
    return added.length + removed.length > 0 ? [...added, ...removed] : [`${field} ${t({ ko: '바뀜', en: 'changed' })}`]
  }
  if (to && typeof to === 'object') return [`${field} ${t({ ko: '바뀜', en: 'changed' })}`]
  return [`${field} ${toText(to)}`]
}

/** The display blocks of the profile whose reply is being rendered, by fence name. */
export const ChatDisplayBlocksContext = createContext<Map<string, ChatDisplayBlock> | null>(null)

export function useChatDisplayBlock(key: string | null) {
  const blocks = useContext(ChatDisplayBlocksContext)
  return key ? blocks?.get(key) ?? null : null
}

/** What each message changed (from the thread's folded state) and how to open the panel at a block. */
export const ChatBlockChangesContext = createContext<{ changes: ChatBlocksState['changes']; open: (key: string, messageId: number | null) => void } | null>(null)

/** The stored message being rendered, so a fence can look up its changes. Null for a streaming reply. */
export const ChatMessageIdContext = createContext<number | null>(null)

/**
 * A ```key fence in a reply, shown as the chips of what it changed (the card itself lives in the status panel). A
 * stored message uses the server's diff; a streaming one lists the values it wrote. A fence that changed nothing
 * shows nothing.
 */
export function BlockChangeChips({ blockKey, data }: { blockKey: string; data: Record<string, unknown> }) {
  const { t } = useI18n()
  const context = useContext(ChatBlockChangesContext)
  const messageId = useContext(ChatMessageIdContext)
  const known = messageId !== null && context ? context.changes[messageId] : undefined
  const texts = known
    ? (known[blockKey] ?? []).flatMap((change) => describeBlockChange(change, t))
    : Object.entries(data).map(([field, value]) => value === null ? `${field} ${t({ ko: '삭제', en: 'removed' })}` : `${field} ${toText(value)}`)
  if (texts.length === 0) return null
  return (
    <div className="my-1.5 flex flex-wrap gap-1.5">
      {texts.map((text, index) => (
        <Button
          key={`${index}-${text}`}
          variant="ghost"
          size="xs"
          onClick={() => context?.open(blockKey, messageId)}
          className="h-6 max-w-full rounded-full bg-foreground/6 px-2.5 font-normal text-foreground/80 hover:bg-foreground/10"
        >
          {index === 0 ? <Activity className="size-3 shrink-0 opacity-70" /> : null}
          <span className="truncate">{text}</span>
        </Button>
      ))}
    </div>
  )
}
