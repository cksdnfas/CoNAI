import { resolveRequestBodyLimitsMb } from '../../middleware/requestBodyLimits'
import { PluginError } from './pluginStore'

/** Worker calls have no Express parser: apply the same configured whole-body transport protection. */
export function pluginLlmInputBytes(value: unknown): number {
  let bytes: number
  try { bytes = Buffer.byteLength(JSON.stringify(value) ?? 'null') }
  catch { throw new PluginError('LLM 입력은 JSON이어야 해.', 400) }
  if (bytes > resolveRequestBodyLimitsMb().default * 1024 * 1024) {
    throw new PluginError('요청 본문이 호스트 전송 한도를 넘었어.', 413)
  }
  return bytes
}
