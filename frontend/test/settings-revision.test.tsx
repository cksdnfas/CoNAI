import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import React, { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiRequestError } from '../src/lib/api-request'
import { useSettingsDraftSlot } from '../src/features/settings/use-settings-draft-slot'
import { useSettingsRevision } from '../src/features/settings/use-settings-revision'

test('a dirty settings draft retains its starting revision through cache refreshes', async () => {
  const dom = new JSDOM('<div id="root"></div>')
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
  let revision!: (savedRevision?: string) => string
  function Editor({ value, dirty }: { value: string; dirty: boolean }) {
    const currentRevision = useSettingsRevision(value, dirty)
    useEffect(() => { revision = currentRevision }, [currentRevision])
    return null
  }
  const root = createRoot(dom.window.document.getElementById('root')!)
  try {
    await act(() => root.render(<Editor value="initial" dirty={false} />))
    await act(() => root.render(<Editor value="initial" dirty />))
    await act(() => root.render(<Editor value="remote" dirty />))
    assert.equal(revision(), 'initial')
    assert.equal(revision('own-save'), 'own-save')
    await act(() => root.render(<Editor value="remote" dirty={false} />))
    assert.equal(revision(), 'remote')
  } finally {
    await act(() => root.unmount())
    Object.assign(globalThis, { window: previousWindow, document: previousDocument, IS_REACT_ACT_ENVIRONMENT: false })
    dom.window.close()
  }
})

test('a settings slot preserves a conflicting draft and adopts the new revision only after discard', async () => {
  const dom = new JSDOM('<div id="root"></div>')
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: Infinity } } })
  let saved = { value: 'initial' }
  let revision = 'v1'
  const writes: Array<{ value: string; revision: string }> = []
  const conflict = new ApiRequestError('changed', 409, 'revision_conflict', { value: 'remote' })
  let slot!: ReturnType<typeof useSettingsDraftSlot<{ value: string }>>
  function Editor() {
    const currentSlot = useSettingsDraftSlot({
      id: 'metadata', label: 'Metadata', tab: 'library', saved, revision,
      update: async (draft, expected) => {
        writes.push({ value: draft.value, revision: expected })
        if (expected !== 'v2') throw conflict
        return { draft, sync: () => { saved = draft; revision = 'v3' } }
      },
    })
    useEffect(() => { slot = currentSlot }, [currentSlot])
    return null
  }
  const root = createRoot(dom.window.document.getElementById('root')!)
  const render = () => root.render(<QueryClientProvider client={client}><Editor /></QueryClientProvider>)
  try {
    await act(render)
    await act(() => slot.setDraft({ value: 'my edit' }))
    saved = { value: 'remote' }
    revision = 'v2'
    await act(render)
    await act(async () => { await assert.rejects(slot.section.save(), (error) => error === conflict) })
    assert.deepEqual(writes, [{ value: 'my edit', revision: 'v1' }])
    assert.deepEqual(slot.draft, { value: 'my edit' })
    assert.equal(slot.section.isDirty, true)
    await act(() => slot.section.discard())
    assert.deepEqual(slot.draft, { value: 'remote' })
    assert.equal(slot.section.isDirty, false)
    await act(() => slot.setDraft({ value: 'new edit' }))
    await act(async () => { await slot.section.save() })
    await act(render)
    assert.deepEqual(writes[1], { value: 'new edit', revision: 'v2' })
    assert.equal(slot.section.isDirty, false)
  } finally {
    await act(() => root.unmount())
    client.clear()
    Object.assign(globalThis, { window: previousWindow, document: previousDocument, IS_REACT_ACT_ENVIRONMENT: false })
    dom.window.close()
  }
})
