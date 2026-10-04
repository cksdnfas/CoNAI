import { useMemo, type ReactNode } from 'react'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import json from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import sql from 'highlight.js/lib/languages/sql'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import bash from 'highlight.js/lib/languages/bash'
import { cn } from '@/lib/utils'

for (const [name, grammar] of Object.entries({ javascript, typescript, python, json, yaml, sql, css, xml, bash })) hljs.registerLanguage(name, grammar)
const languages: Record<string, string> = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', json: 'json', jsonl: 'json', yaml: 'yaml', yml: 'yaml', sql: 'sql', css: 'css', html: 'xml', htm: 'xml', svg: 'xml', xml: 'xml', sh: 'bash' }

/** Parse only the highlighter's escaped span output, rendering text as React nodes (never source HTML). */
function highlightedLines(text: string, extension: string): ReactNode[][] {
  const language = languages[extension]
  if (!language) return text.split('\n').map((line) => [line])
  const html = hljs.highlight(text, { language, ignoreIllegals: true }).value
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const lines: ReactNode[][] = [[]]
  let key = 0
  const visit = (node: Node, classes: string) => {
    if (node.nodeType === Node.TEXT_NODE) {
      for (const [index, part] of (node.textContent ?? '').split('\n').entries()) {
        if (index > 0) lines.push([])
        if (part) lines[lines.length - 1].push(classes ? <span key={key++} className={classes}>{part}</span> : part)
      }
    } else {
      const next = node instanceof Element ? `${classes} ${node.className}`.trim() : classes
      node.childNodes.forEach((child) => visit(child, next))
    }
  }
  visit(parsed.body, '')
  return lines
}

export default function FileCodePreview({ text, extension, wrap, firstLine }: { text: string; extension: string; wrap: boolean; firstLine: number }) {
  const lines = useMemo(() => highlightedLines(text, extension), [text, extension])
  return <div className="max-h-[60vh] overflow-auto font-mono text-xs leading-relaxed [&_.hljs-comment]:text-muted-foreground [&_.hljs-keyword]:text-primary [&_.hljs-string]:text-success [&_.hljs-number]:text-warning [&_.hljs-literal]:text-warning [&_.hljs-title]:text-info [&_.hljs-attr]:text-info [&_.hljs-tag]:text-primary">
    <table className={cn('w-full border-collapse', wrap && 'table-fixed')}><tbody>{lines.map((line, index) => <tr key={index}>
      <td className="w-14 select-none border-r border-line pr-3 text-right align-top text-muted-foreground" aria-hidden="true">{firstLine + index}</td>
      <td className={cn('pl-3 align-top', wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre')}><code>{line.length ? line : '\u00a0'}</code></td>
    </tr>)}</tbody></table>
  </div>
}
