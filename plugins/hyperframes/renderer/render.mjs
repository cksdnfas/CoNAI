import fs from 'node:fs/promises'
import path from 'node:path'
import { createRenderJob, executeRenderJob } from '@hyperframes/producer'
import { parseHTML } from 'linkedom'

// Child process of the plugin's server module, copied next to the installed node_modules. argv[2] is the job folder:
// render.json, input/ (the composition: index.html, assets/, vendor/) and output/.
// The parent never writes to stdin; it closes when the plugin stops, and this render must end with it.
process.stdin.on('close', () => process.exit(1)).resume()
const work = process.argv[2], project = path.join(work, 'input'), page = path.join(project, 'index.html')
const config = JSON.parse(await fs.readFile(path.join(work, 'render.json'), 'utf8'))
const html = parseHTML(await fs.readFile(page, 'utf8'))
const composition = html.document.querySelector('[data-composition-id]')
if (!composition) throw new Error('Composition root missing')
composition.setAttribute('data-width', String(config.width))
composition.setAttribute('data-height', String(config.height))
composition.setAttribute('data-duration', String(config.duration))
composition.style.width = `${config.width}px`
composition.style.height = `${config.height}px`
await fs.writeFile(page, html.document.toString())
const job = createRenderJob({ fps: config.fps, quality: config.preview ? 'draft' : 'standard', format: 'mp4', workers: 1, useGpu: false, hdrMode: 'force-sdr' })
let last = -1
await executeRenderJob(job, project, path.join(work, 'output', 'output.mp4'), progress => {
  const percent = Math.max(0, Math.min(100, Math.round(progress.progress)))
  if (percent !== last) { last = percent; process.stdout.write(JSON.stringify({ percent, phase: progress.currentStage ?? 'rendering' }) + '\n') }
})
if (job.status !== 'complete') throw new Error(job.error || `Render ended with status ${job.status}`)
// The open stdin would keep the process alive.
process.stdout.write(JSON.stringify({ percent: 100, phase: 'completed' }) + '\n', () => process.exit(0))
