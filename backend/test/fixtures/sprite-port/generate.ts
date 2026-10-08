// Regenerates the port-produced D4 fixtures (see README.md). Run from backend/: npx tsx test/fixtures/sprite-port/generate.ts [--inputs]
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { buildSpriteFrames, renderSheet } from '../../../src/services/sprite/spriteBuild'
import { encodeStill } from '../../../src/services/sprite/spriteEncode'
import { ffmpegBinary, probeVideo, runTool } from '../../../src/services/sprite/spriteFfmpeg'
import { resolveExtractOptions, type SpriteExtractOptionsInput } from '../../../src/services/sprite/spriteOptions'

const here = __dirname
const golden = path.resolve(here, '../av-golden')

/**
 * Orange #FF8000 background, a blue disc with a 4 px soft edge (mixed edge pixels, i.e. spill) circling for 2 s,
 * 128x128 at 12 fps, H.264 yuv420p like the av-golden clips.
 */
async function makeOrangeClip(output: string) {
  const a = 'clip((30-hypot(X-(64+24*sin(2*PI*T/2)),Y-(64+12*cos(2*PI*T/2))))/4,0,1)'
  const channel = (fg: number, bg: number) => `${a}*${fg}+(1-${a})*${bg}`
  await runTool(ffmpegBinary(), [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'nullsrc=s=128x128:r=12:d=2',
    '-vf', `geq=r='${channel(40, 255)}':g='${channel(90, 128)}':b='${channel(210, 0)}',format=yuv420p`,
    '-c:v', 'libx264', '-crf', '12', '-preset', 'medium', '-pix_fmt', 'yuv420p', output,
  ], { timeoutMs: 120_000 })
}

export const PORT_CASES: Array<{ id: string; input: string; options: SpriteExtractOptionsInput; note: string }> = [
  {
    id: 'despill_green_hue',
    input: 'av-golden:sprite/inputs/green.mp4',
    options: { keyColors: ['#00FF00'], intervalSeconds: 0.25 },
    note: 'pure-hue key colour: colour-difference despill generalised from magenta (key channel minus the other two)',
  },
  {
    id: 'despill_orange_difference',
    input: 'sprite-port:inputs/orange.mp4',
    options: { keyColors: ['#FF8000'], intervalSeconds: 0.25 },
    note: 'non-hue key colour: colour difference per channel pair, unmixing of the key colour out of edge pixels, then the edge cleanup',
  },
]

export function resolveCaseInput(input: string) {
  const [root, rel] = input.split(':')
  return path.join(root === 'av-golden' ? golden : here, rel)
}

export function rgbaSha256(data: Uint8Array) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

async function main() {
  const orange = path.join(here, 'inputs', 'orange.mp4')
  if (process.argv.includes('--inputs') || !fs.existsSync(orange)) {
    fs.mkdirSync(path.dirname(orange), { recursive: true })
    await makeOrangeClip(orange)
  }
  const cases = []
  for (const testCase of PORT_CASES) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sprite-port-'))
    try {
      const source = resolveCaseInput(testCase.input)
      const options = resolveExtractOptions(testCase.options)
      const meta = await buildSpriteFrames({
        buildId: testCase.id, workDir: work, sourcePath: source, sourceHash: null, sourceName: null, requestedByAccountId: null,
        video: await probeVideo(source), options,
      })
      const { sheet, layout } = renderSheet(work, meta, { columns: options.columns, spacing: options.spacing, crop: null })
      const file = `sheets/${testCase.id}.png`
      fs.mkdirSync(path.join(here, 'sheets'), { recursive: true })
      fs.writeFileSync(path.join(here, file), await encodeStill(sheet, 'png', 100))
      cases.push({
        ...testCase,
        resolved_options: options,
        frame_indices: meta.keptFrameIndices,
        result: { frame_width: meta.frameWidth, frame_height: meta.frameHeight, frame_count: meta.frameCount, columns: layout.columns, rows: layout.rows, sheet_width: sheet.width, sheet_height: sheet.height },
        output: { file, rgba_sha256: rgbaSha256(sheet.data) },
      })
    } finally {
      fs.rmSync(work, { recursive: true, force: true })
    }
  }
  fs.writeFileSync(path.join(here, 'manifest.json'), `${JSON.stringify({ produced_by: 'CoNAI sprite port (not the original app)', cases }, null, 2)}\n`)
  console.log(JSON.stringify(cases.map((c) => ({ id: c.id, ...c.result })), null, 2))
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
