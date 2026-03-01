import { createElement, useEffect } from 'react'
import { render, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRepeatExecution } from '@/features/image-generation/bridges/use-repeat-execution'

type RepeatApi = ReturnType<typeof useRepeatExecution>

interface HookHarnessProps {
  onExecute: () => Promise<void>
  onReady: (api: RepeatApi) => void
}

function HookHarness({ onExecute, onReady }: HookHarnessProps) {
  const api = useRepeatExecution({ onExecute })

  useEffect(() => {
    onReady(api)
  }, [api, onReady])

  return null
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('useRepeatExecution', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('completes finite repeat count and resets state', async () => {
    const onExecute = vi.fn(async () => {})
    let repeatApi: RepeatApi | null = null

    render(createElement(HookHarness, { onExecute, onReady: (api) => { repeatApi = api } }))

    act(() => {
      repeatApi?.setRepeatConfig({ enabled: true, count: 3, delaySeconds: 1 })
    })

    act(() => {
      repeatApi?.startRepeat()
    })
    await flushMicrotasks()

    expect(onExecute).toHaveBeenCalledTimes(1)
    expect(repeatApi?.repeatState).toEqual({ isRunning: true, currentIteration: 1, totalIterations: 3 })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await flushMicrotasks()

    expect(onExecute).toHaveBeenCalledTimes(2)
    expect(repeatApi?.repeatState).toEqual({ isRunning: true, currentIteration: 2, totalIterations: 3 })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await flushMicrotasks()

    expect(onExecute).toHaveBeenCalledTimes(3)
    expect(repeatApi?.repeatState).toEqual({ isRunning: true, currentIteration: 3, totalIterations: 3 })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(repeatApi?.repeatState).toEqual({ isRunning: false, currentIteration: 0, totalIterations: 0 })
  })

  it('keeps running in infinite mode until stopRepeat is called', async () => {
    const onExecute = vi.fn(async () => {})
    let repeatApi: RepeatApi | null = null

    render(createElement(HookHarness, { onExecute, onReady: (api) => { repeatApi = api } }))

    act(() => {
      repeatApi?.setRepeatConfig({ enabled: true, count: -1, delaySeconds: 1 })
    })

    act(() => {
      repeatApi?.startRepeat()
    })
    await flushMicrotasks()

    expect(repeatApi?.repeatState.totalIterations).toBe(-1)
    expect(onExecute).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    await flushMicrotasks()

    expect(onExecute).toHaveBeenCalledTimes(4)
    expect(repeatApi?.repeatState.isRunning).toBe(true)

    act(() => {
      repeatApi?.stopRepeat()
    })

    const calledBeforeAdvance = onExecute.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(onExecute).toHaveBeenCalledTimes(calledBeforeAdvance)
    expect(repeatApi?.repeatState).toEqual({ isRunning: false, currentIteration: 0, totalIterations: 0 })
  })

  it('stops and cleans up when onExecute fails', async () => {
    const onExecute = vi.fn(async () => {
      throw new Error('execute failure')
    })
    let repeatApi: RepeatApi | null = null

    render(createElement(HookHarness, { onExecute, onReady: (api) => { repeatApi = api } }))

    act(() => {
      repeatApi?.setRepeatConfig({ enabled: true, count: -1, delaySeconds: 1 })
    })

    act(() => {
      repeatApi?.startRepeat()
    })
    await flushMicrotasks()

    expect(onExecute).toHaveBeenCalledTimes(1)
    expect(repeatApi?.repeatState).toEqual({ isRunning: false, currentIteration: 0, totalIterations: 0 })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(onExecute).toHaveBeenCalledTimes(1)
  })

  it('clears scheduled timer on unmount', async () => {
    const onExecute = vi.fn(async () => {})
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    let repeatApi: RepeatApi | null = null

    const { unmount } = render(createElement(HookHarness, { onExecute, onReady: (api) => { repeatApi = api } }))

    act(() => {
      repeatApi?.setRepeatConfig({ enabled: true, count: 3, delaySeconds: 10 })
    })

    act(() => {
      repeatApi?.startRepeat()
    })
    await flushMicrotasks()

    expect(onExecute).toHaveBeenCalledTimes(1)

    unmount()
    expect(clearTimeoutSpy).toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000)
    })

    expect(onExecute).toHaveBeenCalledTimes(1)
  })

  it('stops infinite loops at safety guard threshold', async () => {
    const onExecute = vi.fn(async () => {})
    let repeatApi: RepeatApi | null = null

    render(createElement(HookHarness, { onExecute, onReady: (api) => { repeatApi = api } }))

    act(() => {
      repeatApi?.setRepeatConfig({ enabled: true, count: -1, delaySeconds: 0 })
    })

    act(() => {
      repeatApi?.startRepeat()
    })
    await flushMicrotasks()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120000)
    })
    await flushMicrotasks()

    expect(onExecute).toHaveBeenCalledTimes(100)
    expect(repeatApi?.repeatState).toEqual({ isRunning: false, currentIteration: 0, totalIterations: 0 })
  })
})
