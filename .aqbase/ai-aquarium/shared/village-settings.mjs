/** The village settings both sides use: the page drafts within these limits and the server checks them again. */
export const ACTION_RANGE = { min: 1, max: 60 } // seconds between a resident's moves
export const EARSHOT = 4 // tiles: residents this close hear a conversation; the page draws the same circle
export const WALK_RANGE = { min: 0.5, max: 4 } // tiles per second
export const DEFAULT_SETTINGS = Object.freeze({ scene: '햇살 좋은 작은 마을. 산책하다 만난 이웃과 소소한 일상을 이야기해.', actionMin: 3, actionMax: 6, walkSpeed: 1.1, wander: true, dayMinutes: 24, sleep: true, replyLength: 0, replyTimeoutMinutes: 0 })
// 0 = native profile default: omit maxTokens, don't manufacture a plugin cap.
export const REPLY_LENGTHS = [0, 256, 512, 1024, 1536, 2048, 3072, 4096]
export const replyLengthOf = settings => REPLY_LENGTHS.includes(settings?.replyLength) && settings.replyLength > 0 ? settings.replyLength : undefined
export const REPLY_TIMEOUT_RANGE = { min: 5, max: 30 }
export const replyTimeoutMinutesOf = settings => settings?.replyTimeoutMinutes === 0 ? 0 : Number.isFinite(settings?.replyTimeoutMinutes)
  ? Math.max(REPLY_TIMEOUT_RANGE.min, Math.min(REPLY_TIMEOUT_RANGE.max, Math.round(settings.replyTimeoutMinutes)))
  : DEFAULT_SETTINGS.replyTimeoutMinutes
export const replyTimeoutMs = settings => replyTimeoutMinutesOf(settings) ? replyTimeoutMinutesOf(settings) * 60_000 : undefined
export const replyExpired = (startedAt, timeoutMs, now) => Number.isFinite(timeoutMs) && now - startedAt > timeoutMs + 30_000
// Pass the job's captured timeout, not the current village setting.
export const replyTimeoutMessage = (timeoutMs, subject = 'AI 답') =>
  `${subject}이 ${timeoutMs / 60_000}분 안에 오지 않았어. 마을 관리에서 대기 시간을 ${timeoutMs < REPLY_TIMEOUT_RANGE.max * 60_000 ? '늘릴 수 있어' : `확인해줘 (최대 ${REPLY_TIMEOUT_RANGE.max}분)`}.`
export const budgetText = d => d ? `입력 ${d.inputSize ?? d.inputTokens} · 답: ${d.outputReserve ?? '프로필 기본값'} · 문맥 ${d.contextTokens ?? '알 수 없음'} 토큰 · 축소 ${d.shrinks} · 대기 ${d.timeoutMs ? `${d.timeoutMs / 1000}초` : '프로필 기본값'}${d.outputNotice ? ` · ${d.outputNotice}` : ''}` : ''
