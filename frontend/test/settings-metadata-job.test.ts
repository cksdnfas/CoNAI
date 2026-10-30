import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import React, { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { applySettingsChatAction, settingsChatData, type SettingsChatActionContext } from '../src/features/settings/settings-chat-actions'
import { useRuntimeJobAction, type UseRuntimeJobActionResult } from '../src/lib/use-runtime-job'
import type { RuntimeJobRecord } from '../src/types/runtime-job'

test('settings assistant observes and cancels the metadata runtime job', async () => {
  let started = 0
  let cancelled = 0
  const ctx = {
    tab: 'maintenance',
    maintenance: {
      scanAllJob: undefined,
      isScanningAll: false,
      verifyAllFilesJob: undefined,
      isVerifyingAllFiles: false,
      reextractJob: { status: 'running', phase: 'processing', progress: { percentage: 37 } },
      isReextracting: true,
      reextractAll: async () => { started++; return { jobId: 'job' } },
      cancelReextractAll: async () => { cancelled++ },
    },
  } as unknown as SettingsChatActionContext
  const data = settingsChatData(ctx) as { jobs: { reextractMetadata: unknown } }
  assert.deepEqual(data.jobs.reextractMetadata, { status: 'running', phase: 'processing' })
  assert.equal(await applySettingsChatAction('settings.maintenance', { operation: 'cancel_reextract' }, ctx), true)
  assert.equal(await applySettingsChatAction('settings.maintenance', { operation: 'reextract_metadata' }, ctx), true)
  assert.equal(cancelled, 1)
  assert.equal(started, 1)
})

test('settings assistant reports start and cancel failures', async () => {
  let cancelCalls = 0
  const ctx = {
    tab: 'maintenance',
    maintenance: {
      reextractAll: async () => undefined,
      cancelReextractAll: async () => { cancelCalls++ },
      reextractJob: undefined,
    },
  } as unknown as SettingsChatActionContext
  await assert.rejects(applySettingsChatAction('settings.maintenance', { operation: 'reextract_metadata' }, ctx), /메타데이터 재추출을 시작하지 못했어/)
  await assert.rejects(applySettingsChatAction('settings.maintenance', { operation: 'cancel_reextract' }, ctx), /진행 중인 재추출이 없어/)
  assert.equal(cancelCalls, 0)
  ctx.maintenance.reextractJob = { status: 'completed' } as RuntimeJobRecord
  await assert.rejects(applySettingsChatAction('settings.maintenance', { operation: 'cancel_reextract' }, ctx), /진행 중인 재추출이 없어/)
  ctx.maintenance.reextractJob = { status: 'running' } as RuntimeJobRecord
  ctx.maintenance.cancelReextractAll = async () => { throw new Error('cancel rejected') }
  await assert.rejects(applySettingsChatAction('settings.maintenance', { operation: 'cancel_reextract' }, ctx), /cancel rejected/)
})

test('settings assistant waits for scan and verification start failures', async () => {
  const ctx = {
    maintenance: {
      isScanningAll: false,
      isVerifyingAllFiles: false,
      scanAll: async () => undefined,
      verifyAllFiles: async () => undefined,
    },
  } as unknown as SettingsChatActionContext
  await assert.rejects(applySettingsChatAction('settings.maintenance', { operation: 'scan_all' }, ctx))
  await assert.rejects(applySettingsChatAction('settings.maintenance', { operation: 'verify_files' }, ctx))
})

test('settings assistant reports a rejected AI runtime installation', async () => {
  const ctx = {
    auto: {
      aiRuntimeStatus: { install: { status: 'idle' }, installSupported: true, recommendation: { blocked: null } },
      onInstallAiRuntime: () => undefined,
    },
    autoActions: { install: async () => { throw new Error('runtime rejected') } },
    maintenance: {},
  } as unknown as SettingsChatActionContext
  await assert.rejects(applySettingsChatAction('settings.ai_runtime', { operation: 'install' }, ctx), /runtime rejected/)
})

test('runtime job action returns its started job or undefined on a failed start', async () => {
  const dom = new JSDOM('<div id="root"></div>')
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } } })
  const job = {
    jobId: 'job', kind: 'metadata-reextract-all', status: 'completed', phase: null,
    progress: { total: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0, percentage: 0, currentLabel: null },
    message: null, result: null, errors: [], warnings: [], failureCode: null, failureMessage: null,
    cancelRequested: false, queuedAt: '', startedAt: null, completedAt: null, updatedAt: '',
  } satisfies RuntimeJobRecord
  let shouldFail = true
  let errors = 0
  let action!: UseRuntimeJobActionResult<unknown>
  function Consumer() {
    const current = useRuntimeJobAction(async () => {
      if (shouldFail) throw new Error('start rejected')
      return job
    }, { onStartError: () => { errors++ } })
    useEffect(() => { action = current }, [current])
    return null
  }
  const root = createRoot(dom.window.document.getElementById('root')!)
  try {
    await act(() => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Consumer))))
    let result: RuntimeJobRecord | undefined
    await act(async () => { result = await action.run() })
    assert.equal(result, undefined)
    assert.equal(errors, 1)
    shouldFail = false
    await act(async () => { result = await action.run() })
    assert.equal(result, job)
  } finally {
    await act(() => root.unmount())
    client.clear()
    Object.assign(globalThis, { window: previousWindow, document: previousDocument, IS_REACT_ACT_ENVIRONMENT: false })
    dom.window.close()
  }
})
