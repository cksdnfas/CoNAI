import { setHash, artProblem, queueArtCancellation } from './game-art.mjs'
import { toolJson } from './answers.mjs'

const assetKey = a => a.key ?? `zone:${a.zoneId}`
const configurationFailure = message => /(?:unauthori[sz]ed|forbidden|authentication failed|(?:invalid|missing|expired|incorrect).*(?:credentials?|token|api.?key)|\bno\b.*(?:credentials?|token|api.?key)|(?:credentials?|token|api.?key).*(?:missing|invalid|expired|not configured|not set)|(?:workflow|server|model).*(?:not found|inactive|not configured)|(?:인증|토큰|API.?키).*(?:실패|없|만료|잘못|설정|유효)|워크플로우.*(?:없|비활성|잘못))/i.test(message)
const success = s => { s.artIssue = null; if (s.error?.startsWith('게임 그림')) s.error = null }

/** One step for the oldest due picture: submit it, follow the job, then keep the finished image hash. */
export function createAssets({ conai, read, write }) {
  async function assetStep(owner, now, allowSubmit) {
    const state = read(owner)
    const cancellation = state.artCancellations?.find(a => a.attempts < 3 && a.nextAt <= now)
    if (cancellation) {
      try {
        const response = await conai.tools.call('cancel_generation_job', { job_id: cancellation.jobId })
        if (response.isError) throw new Error(response.content?.find(c => c.type === 'text')?.text || '취소 실패')
        write(owner, s => { s.artCancellations = (s.artCancellations ?? []).filter(a => a.jobId !== cancellation.jobId) })
      } catch (error) {
        write(owner, s => {
          const a = s.artCancellations?.find(a => a.jobId === cancellation.jobId)
          if (a) { a.attempts++; a.nextAt = now + 60_000 }
          s.error = `게임 그림 이전 작업 취소를 확인하지 못했어: ${String(error.message).slice(0, 180)}`
        })
      }
      return
    }
    const asset = state.assets.find(a => a.nextAt <= now && (a.jobId || (a.direct && !artProblem(state)) || allowSubmit))
    if (!asset) return
    const key = assetKey(asset)
    const update = fn => write(owner, s => {
      if (asset.epoch && asset.epoch !== s.life?.epoch) return
      const a = s.assets.find(a => assetKey(a) === key && a.input?.idempotency_key === asset.input?.idempotency_key)
      if (a) fn(a, s)
    })
    const drop = (s, a, error, configuration = false) => {
      s.assets = s.assets.filter(x => x !== a)
      if (error) s.error = error
      if (configuration) s.artIssue = `${error} 길드 설정의 게임 그림에서 연결·인증정보·워크플로우를 확인하고 다시 적용해줘.`.slice(0, 400)
    }
    if (now - asset.createdAt > 3_600_000) { update((a, s) => drop(s, a, '게임 그림 작업이 만료됐어.')); return }
    update(a => { a.nextAt = now + 10_000; a.attempts++ })
    try {
      if (!asset.jobId) {
        const response = await conai.tools.call('submit_generation_job', asset.input)
        if (response.isError) throw new Error(response.content?.find(c => c.type === 'text')?.text || '게임 그림 접수 실패')
        const job = toolJson(response)
        if (!Number.isSafeInteger(job.id)) throw new Error('생성 작업 ID가 없어.')
        write(owner, s => {
          const a = s.assets.find(a => assetKey(a) === key && a.input?.idempotency_key === asset.input?.idempotency_key && (!asset.epoch || asset.epoch === s.life?.epoch))
          if (a) { a.jobId = job.id; success(s) }
          else queueArtCancellation(s, job.id) // Replaced while submit was awaiting the host.
        }); return
      }
      if (!asset.historyId) {
        const job = toolJson(await conai.tools.call('get_generation_job', { job_id: asset.jobId }))
        if (['failed', 'cancelled'].includes(job.status)) {
          const reason = String(job.failure_message || '생성 작업을 완료하지 못했어.').slice(0, 200)
          update((a, s) => drop(s, a, `게임 그림 ${job.status === 'failed' ? '실패' : '취소'}: ${reason}`, job.status === 'failed' && configurationFailure(reason))); return
        }
        update((a, s) => { success(s); if (job.status === 'completed' && job.history_ids?.length) a.historyId = job.history_ids[0] })
        return
      }
      const record = toolJson(await conai.tools.call('get_generation_history', { history_id: asset.historyId, limit: 1 })).records?.[0]
      if (/^(?:[0-9a-f]{32}|[0-9a-f]{48})$/.test(record?.composite_hash ?? '')) update((a, s) => {
        if (setHash(s, key, record.composite_hash) !== false && s.art?.[key]) { s.art[key].requested = false; s.art[key].direct = false }
        success(s); drop(s, a)
      })
    } catch (error) {
      update((a, s) => {
        a.nextAt = now + 60_000
        s.error = `게임 그림 요청 일시 오류: ${String(error.message).slice(0, 200)}`
        if (!a.jobId) {
          a.submitFailures = (a.submitFailures ?? 0) + 1
          if (configurationFailure(String(error.message))) drop(s, a, `게임 그림 접수 거절: ${String(error.message).slice(0, 200)}`, true)
          else if (a.submitFailures >= 3) drop(s, a, '게임 그림 접수가 세 번 실패해 자동 재접수를 멈췄어.', true)
        }
      })
    }
  }
  return assetStep
}
