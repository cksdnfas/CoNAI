import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import type { ImageRecord } from '../src/types/image'
import type { WallpaperBackground } from '../src/features/wallpaper/wallpaper-types'

test('media previews release resources and ignore cancelled work', async (t) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
  const loaders: ControlledImage[] = []
  class ControlledImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    naturalWidth = 4096
    naturalHeight = 4096
    src = ''
    constructor() { loaders.push(this) }
    removeAttribute() { this.src = '' }
  }
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, Image: ControlledImage, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act, createElement, StrictMode, useEffect } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.getElementById('root')!)
  t.after(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })

  await t.test('queue edits retain unchanged URLs and row identities, including Strict Mode and duplicate files', async (t) => {
    const { useLocalFilePreviews } = await import('../src/features/upload/use-local-file-previews')
    const live = new Set<string>()
    let created = 0
    let revoked = 0
    t.mock.method(URL, 'createObjectURL', () => { const url = `blob:test-${++created}`; live.add(url); return url })
    t.mock.method(URL, 'revokeObjectURL', (url: string) => { assert.ok(live.delete(url), 'each owned URL is released exactly once'); revoked++ })
    let previews!: ReturnType<typeof useLocalFilePreviews>
    function Reader({ files }: { files: File[] }) {
      const value = useLocalFilePreviews(files, 60)
      useEffect(() => { previews = value }, [value])
      return null
    }
    const render = async (files: File[]) => { await act(async () => root.render(createElement(StrictMode, null, createElement(Reader, { files })))) }
    const files = Array.from({ length: 60 }, (_, index) => new File(['image'], `${index}.png`, { type: 'image/png' }))
    await render(files)
    assert.equal(live.size, 60)
    const retained = previews[1]
    const before = { created, revoked }
    await render([...files.slice(1), new File(['image'], 'new.png', { type: 'image/png' })])
    assert.equal(created - before.created, 1, 'one new file creates one URL')
    assert.equal(revoked - before.revoked, 1, 'one removed file releases one URL')
    assert.deepEqual(previews[0], retained)
    await render([files[1], files[1]])
    assert.equal(previews[0].url, previews[1].url)
    assert.notEqual(previews[0].key, previews[1].key, 'duplicate rows have distinct React keys')
    assert.equal(live.size, 1)
    await act(async () => root.render(null))
    assert.equal(live.size, 0, 'unmount releases every remaining URL')
    t.diagnostic('60 visible files, replace 1: 1 URL created and 1 released; 59 reused')
  })

  await t.test('closing hover previews releases pending original and poster image loads', async (t) => {
    const { useMediaHoverPreview } = await import('../src/components/common/media-hover-preview')
    const matchMedia = Object.getOwnPropertyDescriptor(dom.window, 'matchMedia')
    Object.defineProperty(dom.window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) })
    t.after(() => {
      if (matchMedia) Object.defineProperty(dom.window, 'matchMedia', matchMedia)
      else Reflect.deleteProperty(dom.window, 'matchMedia')
    })
    let open!: () => void
    let hide!: () => void
    let reveal!: () => void
    t.mock.method(dom.window, 'setTimeout', (run: () => void) => { reveal = run; return 1 })
    t.mock.method(dom.window, 'clearTimeout', () => {})
    const target = document.createElement('div')
    document.body.appendChild(target)
    t.after(() => target.remove())
    t.mock.method(target, 'getBoundingClientRect', () => new dom.window.DOMRect(20, 20, 40, 40))
    function Reader({ video }: { video: boolean }) {
      const preview = useMediaHoverPreview(video
        ? { src: '/poster', videoSrc: '/video' }
        : { src: '/thumbnail', fullSrc: '/original' })
      useEffect(() => {
        open = () => preview.triggerProps.onPointerEnter({
          pointerType: 'mouse', currentTarget: target,
        } as Parameters<typeof preview.triggerProps.onPointerEnter>[0])
        hide = preview.hide
      }, [preview])
      return preview.preview
    }
    for (const video of [false, true]) {
      await act(async () => root.render(createElement(Reader, { video })))
      await act(async () => { open(); reveal() })
      const pendingImage = loaders.at(-1)!
      assert.equal(pendingImage.src, video ? '/poster' : '/original')
      await act(async () => hide())
      assert.equal(pendingImage.onload, null, 'closed previews cannot update from late image loads')
      assert.equal(pendingImage.src, '', 'closed previews release the pending image source')
    }
    await act(async () => root.render(null))
  })

  await t.test('audio state follows the current playback, including late failures and queued events', async (t) => {
    const requests: Array<{ resolve: () => void; reject: (error: Error) => void }> = []
    const audios: ControlledAudio[] = []
    class ControlledAudio extends EventTarget {
      src = ''
      paused = true
      ended = false
      currentTime = 0
      duration = 0
      error: { code: number } | null = null
      constructor() { super(); audios.push(this) }
      play() {
        this.paused = false
        this.ended = false
        this.error = null
        this.dispatchEvent(new Event('play'))
        return new Promise<void>((resolve, reject) => requests.push({ resolve, reject }))
      }
      pause() { this.paused = true; this.dispatchEvent(new Event('pause')) }
      removeAttribute() { this.src = '' }
      load() { this.currentTime = this.duration = 0 }
    }
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Audio')
    Object.defineProperty(globalThis, 'Audio', { value: ControlledAudio, configurable: true })
    const { audioPlayer } = await import('../src/features/audio/audio-player')
    t.after(() => {
      audioPlayer.stop()
      if (descriptor) Object.defineProperty(globalThis, 'Audio', descriptor)
      else Reflect.deleteProperty(globalThis, 'Audio')
    })
    const play = (key: string) => audioPlayer.play(key, { src: `https://media.test/${key}` })
    play('first')
    const audio = audios[0]
    play('second')
    requests[0].reject(new DOMException('Interrupted by another source', 'AbortError'))
    await Promise.resolve()
    assert.equal(audioPlayer.state.key, 'second')
    assert.equal(audioPlayer.state.playing, true, 'failure of the first play cannot stop the second')
    requests[1].resolve()
    audioPlayer.pause()
    audioPlayer.resume()
    play('third')
    requests[2].reject(new DOMException('Interrupted resume', 'AbortError'))
    await Promise.resolve()
    assert.equal(audioPlayer.state.playing, true)
    requests[3].resolve()
    audio.dispatchEvent(new Event('pause'))
    assert.equal(audioPlayer.state.playing, true, 'a queued old pause event uses the current element state')
    audio.dispatchEvent(new Event('error'))
    assert.equal(audioPlayer.state.playing, true, 'a queued old error with no current media error is ignored')
    const unchanged = audioPlayer.state
    audio.dispatchEvent(new Event('timeupdate'))
    assert.strictEqual(audioPlayer.state, unchanged, 'unchanged positions do not notify React subscribers')

    audioPlayer.play('region', { src: 'https://media.test/region', start: 2, end: 3 })
    requests[4].resolve()
    audio.currentTime = 3.2
    audio.dispatchEvent(new Event('timeupdate'))
    assert.equal(audioPlayer.state.currentTime, 3)
    assert.equal(audioPlayer.state.playing, false)
    play('broken')
    requests[5].resolve()
    audio.error = { code: 3 }
    audio.dispatchEvent(new Event('error'))
    assert.equal(audioPlayer.state.playing, false, 'decode errors clear playback state even after play resolved')
    audioPlayer.stop()
    audio.duration = 10
    audio.currentTime = 5
    audio.dispatchEvent(new Event('loadedmetadata'))
    audio.dispatchEvent(new Event('timeupdate'))
    assert.deepEqual(audioPlayer.state, { key: null, playing: false, duration: 0, currentTime: 0 })
  })

  await t.test('pixel previews stay bounded, retain export size and settle cancelled or failed workers', async (t) => {
    const workers: ControlledWorker[] = []
    let failPost = false
    class ControlledWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      onmessageerror: (() => void) | null = null
      request!: { imageData: ImageData }
      terminated = 0
      constructor() { workers.push(this) }
      postMessage(request: { imageData: ImageData }, transfer: Transferable[]) {
        if (failPost) throw new Error('Could not transfer pixels')
        this.request = structuredClone(request, { transfer })
      }
      finish() { this.onmessage?.({ data: this.request } as MessageEvent) }
      terminate() { this.terminated++ }
    }
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
    Object.defineProperty(globalThis, 'Worker', { value: ControlledWorker, configurable: true })
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor)
      else Reflect.deleteProperty(globalThis, 'Worker')
    })
    const canvases: HTMLCanvasElement[] = []
    t.mock.method(dom.window.HTMLCanvasElement.prototype, 'getContext', function (this: HTMLCanvasElement) {
      canvases.push(this)
      return {
        drawImage() {}, putImageData() {},
        getImageData: () => ({ width: this.width, height: this.height, data: new Uint8ClampedArray(this.width * this.height * 4) }),
      }
    })
    const encodedSizes: number[][] = []
    t.mock.method(dom.window.HTMLCanvasElement.prototype, 'toBlob', function (this: HTMLCanvasElement, done: BlobCallback) {
      encodedSizes.push([this.width, this.height])
      done(new Blob(['png'], { type: 'image/png' }))
    })
    const { getPixelPreviewProfile, IMAGE_PIXEL_PREVIEW_PRESETS } = await import('../src/features/images/components/detail/image-detail-pixel-preview-utils')
    const { renderPixelPreviewSample, renderPixelPreviewPngBlob } = await import('../src/features/images/components/detail/image-detail-pixel-preview')
    const { createPixelPreviewWorkerTask } = await import('../src/features/images/components/detail/image-detail-pixel-preview-worker-client')
    const profile = getPixelPreviewProfile('soft', IMAGE_PIXEL_PREVIEW_PRESETS.soft)!
    const loadImage = async () => { loaders.at(-1)!.onload!(); await Promise.resolve() }
    const pending = renderPixelPreviewSample('/large-image', profile)
    await loadImage()
    workers.at(-1)!.finish()
    const sample = await pending
    assert.deepEqual([sample.canvas.width, sample.canvas.height], [512, 512])
    assert.deepEqual([sample.sourceWidth, sample.sourceHeight], [4096, 4096])
    sample.canvas.width = sample.canvas.height = 0
    const exported = renderPixelPreviewPngBlob('/large-image', profile)
    await loadImage()
    workers.at(-1)!.finish()
    assert.equal((await exported).type, 'image/png')
    assert.deepEqual(encodedSizes, [[4096, 4096]], 'export keeps the source dimensions')
    assert.ok(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0), 'export releases sample and output bitmaps')

    const beforeLoading = new AbortController()
    const cancelledLoad = renderPixelPreviewSample('/cancel-before-load', profile, beforeLoading.signal)
    beforeLoading.abort()
    await assert.rejects(cancelledLoad, { name: 'AbortError' })
    assert.equal(loaders.at(-1)!.src, '')
    const running = new AbortController()
    const cancelledWork = renderPixelPreviewSample('/cancel-during-work', profile, running.signal)
    await loadImage()
    const worker = workers.at(-1)!
    running.abort()
    await assert.rejects(cancelledWork, { name: 'AbortError' })
    assert.equal(worker.terminated, 1)
    assert.equal(worker.onmessage, null)
    assert.equal(canvases.at(-1)!.width, 0)

    const pixels = () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }) as ImageData
    const task = createPixelPreviewWorkerTask(pixels(), profile)
    task.cancel()
    task.cancel()
    await assert.rejects(task.promise, { name: 'AbortError' })
    assert.equal(workers.at(-1)!.terminated, 1)
    failPost = true
    const failed = createPixelPreviewWorkerTask(pixels(), profile)
    await assert.rejects(failed.promise, /Could not transfer pixels/)
    assert.equal(workers.at(-1)!.terminated, 1)
    t.diagnostic('4096x4096 source: preview sample 512x512; exported PNG 4096x4096; temporary canvases released')
  })

  await t.test('slideshow removes outgoing videos, honors pause and rejects stale image loads', async (t) => {
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
    const { WallpaperBackgroundLayer } = await import('../src/features/wallpaper/wallpaper-background-layer')
    const { setWallpaperHostPaused } = await import('../src/features/wallpaper/wallpaper-playback')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    t.after(() => client.clear())
    const plays = new Map<HTMLMediaElement, number>()
    const pauses = new Map<HTMLMediaElement, number>()
    t.mock.method(dom.window.HTMLMediaElement.prototype, 'play', async function (this: HTMLMediaElement) { plays.set(this, (plays.get(this) ?? 0) + 1) })
    t.mock.method(dom.window.HTMLMediaElement.prototype, 'pause', function (this: HTMLMediaElement) { pauses.set(this, (pauses.get(this) ?? 0) + 1) })
    const timers = new Map<number, () => void>()
    let timerId = 0
    t.mock.method(dom.window, 'setTimeout', (run: () => void) => { timers.set(++timerId, run); return timerId })
    t.mock.method(dom.window, 'clearTimeout', (id: number) => { timers.delete(id) })
    const finishTransition = async () => {
      await act(async () => { const pending = [...timers.values()]; timers.clear(); pending.forEach((run) => run()) })
    }
    const queryKey = (group = 1) => ['wallpaper-runtime-data', 'group-pool', 'background', group, true, 40]
    const media = (id: string, video = false) => ({ id, composite_hash: id, image_url: `/media/${id}`, mime_type: video ? 'video/mp4' : 'image/png' }) as unknown as ImageRecord
    const background = (groupId: number): WallpaperBackground => ({ kind: 'group-slideshow', groupId, includeChildren: true, intervalSec: 10, transition: 'fade', fit: 'cover' })
    const render = async (groupId = 1) => {
      await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(WallpaperBackgroundLayer, { background: background(groupId) }))))
    }
    const update = async (image: ImageRecord) => {
      await act(async () => { client.setQueryData(queryKey(), [image]); await new Promise((resolve) => setTimeout(resolve, 10)) })
    }
    client.setQueryData(queryKey(), [media('video-a', true)])
    await render()
    const first = document.querySelector('video')!
    assert.equal(plays.get(first), 1)
    await act(async () => setWallpaperHostPaused(true))
    await update(media('video-b', true))
    const second = document.querySelectorAll('video')[1]
    assert.ok(second)
    assert.equal(second.hasAttribute('autoplay'), false)
    assert.equal(plays.get(second) ?? 0, 0, 'a new video cannot autoplay while the host is paused')
    const pausedBeforeUnmount = pauses.get(first) ?? 0
    await finishTransition()
    assert.equal(document.querySelectorAll('video').length, 1, 'the outgoing video is released after the transition')
    assert.ok((pauses.get(first) ?? 0) > pausedBeforeUnmount)
    await act(async () => setWallpaperHostPaused(false))
    assert.equal(plays.get(second), 1)

    await update(media('slow'))
    const slow = loaders.at(-1)!
    const staleLoad = slow.onload!
    await update(media('current'))
    const current = loaders.at(-1)!
    assert.equal(slow.src, '', 'obsolete preload is detached')
    await act(async () => current.onload!())
    await act(async () => staleLoad())
    await finishTransition()
    assert.equal(document.querySelector('img')?.getAttribute('src'), '/media/current')
    assert.equal(document.querySelectorAll('video').length, 0)
    assert.ok((pauses.get(second) ?? 0) > 0)
    client.setQueryData(queryKey(2), [])
    await render(2)
    assert.equal(document.querySelectorAll('img, video').length, 0, 'switching to an empty group clears the old background')
    await act(async () => root.render(null))
  })
})
