import { useState } from 'react'

/**
 * Keep editable rows locally while emitting a cleaned (trimmed / filtered) node value.
 * Rebuilding rows from the cleaned value on every render would drop half-typed input,
 * so rows are only re-parsed when the value changes from outside this editor.
 */
export function useSerializedDrafts<TDraft>(
  value: unknown,
  parse: (value: unknown) => TDraft[],
  build: (drafts: TDraft[]) => unknown,
  onChange: (value: unknown) => void,
) {
  const [state, setState] = useState(() => ({ drafts: parse(value), source: value, emitted: serialize(build(parse(value))) }))

  let current = state
  if (value !== state.source && serialize(value) !== state.emitted) {
    const drafts = parse(value)
    current = { drafts, source: value, emitted: serialize(build(drafts)) }
    setState(current)
  }

  const updateDrafts = (nextDrafts: TDraft[]) => {
    const nextValue = build(nextDrafts)
    setState({ drafts: nextDrafts, source: nextValue, emitted: serialize(nextValue) })
    onChange(nextValue)
  }

  return [current.drafts, updateDrafts] as const
}

function serialize(value: unknown) {
  if (typeof value === 'string') {
    return value.trim()
  }
  return JSON.stringify(value ?? null)
}
