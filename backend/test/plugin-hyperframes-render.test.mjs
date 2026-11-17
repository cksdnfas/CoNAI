import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID, createHash } from 'node:crypto'
import { starter, validateProject, assetPath, composeHtml } from '../../plugins/hyperframes/project.mjs'
import { spawn } from 'node:child_process'
import { renderProject } from '../../plugins/hyperframes/render.mjs'
import { rendererInstaller } from '../../plugins/hyperframes/installer.mjs'
import sharp from 'sharp'

// Fixtures and assertions use the ffmpeg/ffprobe on PATH, the same binaries the renderer finds.
const command = (tool, args) => new Promise((resolve, reject) => {
  const child = spawn(tool, args, { windowsHide: true })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
  child.on('error', reject); child.on('close', code => code === 0 ? resolve(output) : reject(new Error(output)))
})

test('project rejects external references, traversal aliases and oversized render settings', () => {
  assert.throws(() => assetPath('../outside', 'image/png'))
  assert.throws(() => validateProject({ ...starter(), width: 4000 }))
  assert.throws(() => validateProject({ ...starter(), duration: 10000 }))
  assert.throws(() => validateProject({ ...starter(), assets: [{ id: 'photo', reference: { source: 'url', url: 'http://localhost/private' } }] }))
})

test('scene options and controls are validated, and a saved project always carries its control values in the html', () => {
  const assets = [{ id: 'photo', label: ' 밤거리 ', reference: { source: 'files', fileId: '1'.repeat(32) }, mimeType: 'image/png' }]
  const base = starter('조정', assets)
  // Explicit defaults are the same composition as none: the editor recognises its own html by equality.
  const explicit = base.scenes.map(scene => ({ ...scene, motion: 'zoom-in', transition: 0, captionPosition: 'center' }))
  assert.equal(composeHtml(base, explicit), base.html)
  const scenes = [{ ...base.scenes[0], motion: 'pan-left', captionPosition: 'bottom' }, { asset: 'photo', seconds: 3, caption: '', transition: 1 }]
  const html = composeHtml({ ...base, style: { captionSize: 5, accent: '#ffd27a' } }, scenes)
  assert.match(html, /id="scene-0"[^>]*data-duration="5"/, 'the scene before a cross-fade stays on screen through it')
  assert.match(html, /xPercent:-3/); assert.match(html, /align-self:flex-end/); assert.match(html, /font-size:36px[^}]*color:#ffd27a/)
  const controls = [{ id: 'snow', label: '눈 내리는 양', type: 'range', min: 0, max: 100, step: 1, value: 35 }, { id: 'lamp', label: '가로등', type: 'toggle', value: true }]
  const saved = validateProject({ ...base, scenes, controls })
  assert.equal(saved.assets[0].label, '밤거리')
  assert.deepEqual(saved.scenes[1], { asset: 'photo', seconds: 3, caption: '', transition: 1 })
  assert.match(saved.html, /<style id="hf-controls">:root\{--snow:35;--lamp:1\}<\/style><\/head>/)
  const changed = validateProject({ ...saved, controls: [{ ...controls[0], value: 80 }] })
  assert.equal(changed.html.match(/hf-controls/g).length, 1); assert.match(changed.html, /--snow:80\}/)
  assert.equal(validateProject({ ...changed, controls: undefined }).html, base.html, 'removing the controls removes their block')
  assert.throws(() => validateProject({ ...base, controls: [{ ...controls[0], value: 101 }] }))
  assert.throws(() => validateProject({ ...base, controls: [{ id: 'x', label: 'x', type: 'color', value: 'red;}body{display:none' }] }))
  assert.throws(() => validateProject({ ...base, scenes: [{ ...base.scenes[0], motion: 'spin' }] }))
})

test('real render installs the renderer, consumes bound image/video files, refuses a changed source and stops on cancel', { skip: process.env.HYPERFRAMES_RENDER_TEST !== '1', timeout: 900000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'conai-hyperframes-test-'))
  const fingerprint = 'a'.repeat(64)
  const assets = [
    { id: 'photo', reference: { source: 'files', fileId: '1'.repeat(32) }, mimeType: 'image/png', path: 'assets/photo.png', fingerprint },
    { id: 'clip', reference: { source: 'library', compositeHash: '2'.repeat(48) }, mimeType: 'video/mp4', path: 'assets/clip.mp4', fingerprint },
  ]
  try {
    const fixture = name => path.join(root, name)
    await sharp({ create: { width: 320, height: 180, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toFile(fixture('photo.png'))
    await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=30', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', fixture('clip.mp4')])
    const installer = rendererInstaller(root)
    installer.start()
    while (installer.snapshot().status === 'running') await new Promise(resolve => setTimeout(resolve, 1000))
    assert.equal(installer.snapshot().status, 'completed', installer.snapshot().error)
    let stale = false
    const resolve = async ref => {
      const asset = assets.find(a => JSON.stringify(a.reference) === JSON.stringify(ref))
      assert.ok(asset, 'only selected references are read')
      const file = path.join(root, path.basename(asset.path))
      return { path: file, mimeType: asset.mimeType, size: (await fs.stat(file)).size, fingerprint: stale ? 'b'.repeat(64) : fingerprint }
    }
    const conai = { dataDir: root, media: { resolve, save: async ({ path: target }) => {
      assert.ok(target.startsWith('renders/'))
      await fs.copyFile(path.join(root, target), path.join(root, 'result.mp4'))
      const bytes = await fs.readFile(path.join(root, 'result.mp4'))
      return { compositeHash: createHash('sha256').update(bytes).digest('hex').slice(0, 48) }
    } } }
    const project = { ...starter('내부 소재 검증', assets), width: 320, height: 180, duration: 2 }
    project.html = project.html.replaceAll('data-duration="4"', 'data-duration="1"').replaceAll('data-start="4"', 'data-start="1"')
    const context = { signal: new AbortController().signal, jobId: randomUUID(), report: async () => {} }
    const result = await renderProject(conai, { project, fileId: '3'.repeat(32), revision: 'c'.repeat(64) }, context)
    assert.equal(result.sources.length, 2)
    const metadata = JSON.parse(await command('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_frames:format=duration', '-of', 'json', fixture('result.mp4')]))
    assert.equal(metadata.streams[0].width, 320); assert.equal(metadata.streams[0].height, 180)
    assert.ok(Number(metadata.format.duration) >= 1.9 && Number(metadata.format.duration) < 2.2)
    assert.ok(Number(metadata.streams[0].nb_frames) >= 48)
    for (const [time, expected] of [['0.5', 0], ['1.5', 2]]) {
      await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', time, '-i', fixture('result.mp4'), '-frames:v', '1', '-threads', '1', '-y', fixture('frame.png')])
      const pixel = await sharp(path.join(root, 'frame.png')).extract({ left: 5, top: 5, width: 1, height: 1 }).removeAlpha().raw().toBuffer()
      assert.ok(pixel[expected] > 150 && pixel[(expected + 1) % 3] < 80, `selected media must appear at ${time}s: ${[...pixel]}`)
    }
    stale = true
    await assert.rejects(renderProject(conai, { project }, { ...context, jobId: randomUUID() }), /원본이 변경/)
    stale = false
    // Cancel once the renderer process reports progress, so its process tree has to be stopped.
    const cancelled = new AbortController()
    await assert.rejects(renderProject(conai, { project }, { signal: cancelled.signal, jobId: randomUUID(), report: async progress => { if (progress.percent > 1) cancelled.abort(new Error('cancel test')) } }), /cancel test/)
    assert.deepEqual(await fs.readdir(path.join(root, 'renders')), [], 'job folders are removed on success, failure and cancellation')
  } finally {
    assert.ok(path.basename(root).startsWith('conai-hyperframes-test-'))
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
