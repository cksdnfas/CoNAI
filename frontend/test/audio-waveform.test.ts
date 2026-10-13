import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadAudioWaveform } from '../src/features/audio/audio-waveform'

test('audio waveforms share decoding, preserve other consumers on cancellation and isolate accounts', async (t) => {
  let decoded = 0
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext')
  class TestAudioContext {
    async decodeAudioData() {
      decoded += 1
      return { duration: 1, length: 4, numberOfChannels: 1, getChannelData: () => new Float32Array([0.1, 0.7, 0.2, 0.3]) }
    }
  }
  Object.defineProperty(globalThis, 'AudioContext', { value: TestAudioContext, configurable: true })
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'AudioContext', descriptor)
    else Reflect.deleteProperty(globalThis, 'AudioContext')
  })
  const requests: Array<{ signal: AbortSignal; finish: () => void }> = []
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const signal = init.signal as AbortSignal
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'))
      signal.addEventListener('abort', abort, { once: true })
      requests.push({ signal, finish: () => { signal.removeEventListener('abort', abort); resolve() } })
    })
    return new Response(new Uint8Array([1]))
  })

  const cancelList = new AbortController()
  const source = { scope: 'account:1', src: 'https://waveform.test/shared' }
  const list = loadAudioWaveform('candidate', 'hash', { ...source, signal: cancelList.signal })
  const editor = loadAudioWaveform('candidate', 'hash', source)
  assert.equal(requests.length, 1, 'the list and editor share one network request')
  cancelList.abort()
  await assert.rejects(list, { name: 'AbortError' })
  assert.equal(requests[0].signal.aborted, false, 'the editor still needs the shared request')
  requests[0].finish()
  const waveform = await editor
  assert.equal(decoded, 1)
  assert.equal(waveform.peaks.length, 800)
  assert.equal(waveform.editorPeaks.length, 1600)
  assert.strictEqual(await loadAudioWaveform('candidate', 'hash', source), waveform, 'cache retains the small result')

  const otherAccount = loadAudioWaveform('candidate', 'hash', { ...source, scope: 'account:2' })
  assert.equal(requests.length, 2, 'another account must fetch through its own permissions')
  requests[1].finish()
  await otherAccount
  assert.equal(decoded, 2)

  const first = loadAudioWaveform('first', 'one', { scope: 'account:1', src: 'https://waveform.test/one' })
  const cancelSecond = new AbortController()
  const second = loadAudioWaveform('second', 'two', { scope: 'account:1', src: 'https://waveform.test/two', signal: cancelSecond.signal })
  const cancelQueued = new AbortController()
  const queued = loadAudioWaveform('third', 'three', { scope: 'account:1', src: 'https://waveform.test/three', signal: cancelQueued.signal })
  assert.equal(requests.length, 4, 'only two distinct decodes enter at once')
  cancelQueued.abort()
  await assert.rejects(queued, { name: 'AbortError' })
  cancelSecond.abort()
  await assert.rejects(second, { name: 'AbortError' })
  assert.equal(requests[3].signal.aborted, true, 'abandoning the last consumer cancels its fetch')
  requests[2].finish()
  await first
  assert.equal(requests.length, 4, 'an abandoned queued decode never downloads the file')
})
