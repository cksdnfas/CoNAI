import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasNarration, isNarrationLine, narrationForModel } from '@conai/shared'
import { toggleNarrationMark } from '../src/features/codex-chat/chat-narration'

/** The text with the selection drawn in: [ ] around a selection, | at a caret. */
function show({ text, start, end }: { text: string; start: number; end: number }) {
  return start === end ? `${text.slice(0, start)}|${text.slice(start)}` : `${text.slice(0, start)}[${text.slice(start, end)}]${text.slice(end)}`
}

test('the narration key marks the caret line, opens a narration line, or clears the mark', () => {
  const at = (text: string, start: number, end = start) => show(toggleNarrationMark(text, start, end))
  // An empty draft and a blank (or blank-looking) line become the mark, the caret after it.
  assert.equal(at('', 0), '$ |')
  assert.equal(at('hello\n', 6), 'hello\n$ |')
  assert.equal(at('a\n\nb', 2), 'a\n$ |\nb')
  assert.equal(at('a\n   \nb', 3), 'a\n$ |\nb')
  // On a line with text a narration line opens at the caret: below at its end, splitting it in its middle.
  assert.equal(at('"Hi," she said.', 15), '"Hi," she said.\n$ |')
  assert.equal(at('ab cd', 2), 'ab\n$ | cd')
  // At the start of a line with text there is nothing before the caret to keep, so the line itself is marked.
  assert.equal(at('ab\ncd', 3), 'ab\n$ |cd')
  assert.equal(at('cd', 0), '$ |cd')
  // A narration line loses its mark (and the space after it); pressing twice on a blank line gives it back.
  assert.equal(at('$ The door opens.', 10), 'The door| opens.')
  assert.equal(at('$The door opens.', 1), '|The door opens.')
  assert.equal(at('a\n$ b', 4), 'a\n|b')
  const once = toggleNarrationMark('', 0)
  assert.equal(show(toggleNarrationMark(once.text, once.start)), '|')
  // Clearing "$ $5" keeps its space: dropping it would leave "$5", which reads as narration again.
  assert.equal(at('$ $5', 4), ' $5|')
})

test('a selection marks each line with text, and clears them when all are narration', () => {
  const at = (text: string, start: number, end: number) => show(toggleNarrationMark(text, start, end))
  assert.equal(at('a\nb\n\nc', 0, 6), '[$ a\n$ b\n\n$ c]')
  // Partly selected lines count whole; a selection ending where a line starts leaves that line out.
  assert.equal(at('one\ntwo\nthree', 1, 5), '$ o[ne\n$ t]wo\nthree')
  assert.equal(at('a\nb', 0, 2), '[$ a\n]b')
  // Lines already narration stay as they are while the others gain the mark.
  assert.equal(at('$ a\nb', 0, 5), '[$ a\n$ b]')
  // Only narration lines selected: every mark goes, the selection stays on the same text.
  assert.equal(at('$ a\n$b\nc', 0, 6), '[a\nb]\nc')
  // A selection starting inside a mark starts where the mark was.
  assert.equal(at('x\n$ a\n$ b', 3, 9), 'x\n[a\nb]')
  // Blank lines only: the first one becomes the mark.
  assert.equal(at('a\n\n\nb', 2, 4), 'a\n$ |\n\nb')
})

test('marked lines follow the shared narration rule, the $$ escape included', () => {
  // "$$5" is a literal "$5"; marked, it stays "$5" as narration text.
  const escaped = toggleNarrationMark('$$5 a coffee', 0)
  assert.equal(show(escaped), '$ |$5 a coffee')
  assert.ok(isNarrationLine(escaped.text))
  assert.equal(narrationForModel(escaped.text), '[Narration] $5 a coffee')
  // An escaped line is text, not narration: the caret at its end opens a new narration line.
  assert.equal(show(toggleNarrationMark('$$5', 3)), '$$5\n$ |')
  // What the key leaves is what a typed "$" gives: typing after it sends narration.
  const opened = toggleNarrationMark('"Hi."', 5)
  const typed = `${opened.text.slice(0, opened.start)}The rain stops.${opened.text.slice(opened.end)}`
  assert.ok(hasNarration(typed))
  assert.equal(narrationForModel(typed), '"Hi."\n[Narration] The rain stops.')
})
