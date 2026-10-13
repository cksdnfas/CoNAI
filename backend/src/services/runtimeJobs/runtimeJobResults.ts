import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { runtimePaths } from '../../config/runtimePaths'

const MAX_RESULT_FILE_BYTES = 8 * 1024 * 1024
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
type ResultReference = { runtime_job_result_file: 1; byte_length: number }

function resultPath(jobId: string): string {
  if (!JOB_ID.test(jobId)) throw new Error('Invalid runtime job id')
  // This directory is private; /temp and /save are served by the media routes.
  const root = path.join(runtimePaths.artifactsDir, 'runtime-job-results')
  if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) throw new Error('Invalid runtime job result directory')
  return path.join(root, `${jobId}.json`)
}

export function storeRuntimeJobResult(jobId: string, serialized: string): ResultReference {
  const size = Buffer.byteLength(serialized, 'utf8')
  if (size > MAX_RESULT_FILE_BYTES) throw new Error('작업 결과가 8MB를 넘었습니다. 입력을 나누어 다시 실행하세요.')
  const target = resultPath(jobId)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const staged = `${target}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(staged, serialized, { flag: 'wx' })
    fs.renameSync(staged, target)
  } finally { fs.rmSync(staged, { force: true }) }
  return { runtime_job_result_file: 1, byte_length: size }
}

/** Only call after checking the job's ownership. Lists and progress hints keep the small reference. */
export function readRuntimeJobResult(jobId: string, value: unknown): unknown {
  const reference = value as Partial<ResultReference> | null
  if (reference?.runtime_job_result_file !== 1) return value
  const size = reference.byte_length
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0 || size > MAX_RESULT_FILE_BYTES) throw new Error('Invalid runtime job result reference')
  const target = resultPath(jobId)
  const stat = fs.lstatSync(target)
  if (!stat.isFile() || stat.size !== reference.byte_length) throw new Error('Invalid runtime job result file')
  return JSON.parse(fs.readFileSync(target, 'utf8'))
}

export function removeRuntimeJobResult(jobId: string): void {
  fs.rmSync(resultPath(jobId), { force: true })
}
