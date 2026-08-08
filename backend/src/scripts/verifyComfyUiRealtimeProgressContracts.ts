import { equal, match } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildComfyProgressWebSocketUrl,
  parseComfyProgressEvent,
} from '../services/comfyui/comfyProgressMonitor'

const workflow = {
  '3': { class_type: 'KSampler', _meta: { title: 'Main sampler' } },
  '8': { class_type: 'VAEDecode' },
}

equal(
  buildComfyProgressWebSocketUrl('http://127.0.0.1:8188/api/', 'conai-job-42'),
  'ws://127.0.0.1:8188/api/ws?clientId=conai-job-42',
  'the progress socket must preserve endpoint base paths and reuse the queue client id',
)

const sampled = parseComfyProgressEvent(JSON.stringify({
  type: 'progress',
  data: { prompt_id: 'prompt-1', node: '3', value: 12, max: 20 },
}), workflow, Date.parse('2026-08-07T08:00:00.000Z'))
equal(sampled?.promptId, 'prompt-1')
equal(sampled?.progress.phase, 'sampling')
equal(sampled?.progress.node_label, 'Main sampler')
equal(sampled?.progress.value, 12)
equal(sampled?.progress.max, 20)
equal(sampled?.progress.percent, 60)

const executing = parseComfyProgressEvent(JSON.stringify({
  type: 'executing',
  data: { prompt_id: 'prompt-1', node: '8' },
}), workflow)
equal(executing?.progress.phase, 'executing')
equal(executing?.progress.node_label, 'VAEDecode')
equal(executing?.progress.percent, null, 'nodes without progress hooks must not manufacture a percent')

const finalizing = parseComfyProgressEvent(JSON.stringify({
  type: 'executing',
  data: { prompt_id: 'prompt-1', node: null },
}), workflow)
equal(finalizing?.progress.phase, 'finalizing')
equal(finalizing?.progress.percent, null, 'execution end must become finalizing, not false 100% completion')

equal(parseComfyProgressEvent('not-json', workflow), null, 'invalid and binary-like payloads must be ignored')
equal(parseComfyProgressEvent(JSON.stringify({ type: 'progress', data: { value: 1, max: 0 } }), workflow), null, 'invalid progress maxima must be ignored')

const monitorSource = readFileSync(resolve(process.cwd(), 'src/services/comfyui/comfyProgressMonitor.ts'), 'utf8')
match(
  monitorSource,
  /if \(event\.promptId !== this\.expectedPromptId\) \{[\s\S]*?return/,
  'a connected monitor must reject events that do not carry the accepted prompt id',
)
match(
  monitorSource,
  /const PROGRESS_EMIT_INTERVAL_MS = 250/,
  'high-frequency sampler steps must be coalesced before entering the CoNAI SSE stream',
)

console.log('ComfyUI realtime progress contracts verified.')
