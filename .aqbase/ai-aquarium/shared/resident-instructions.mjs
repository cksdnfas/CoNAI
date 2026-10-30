/** Partial updates for selected residents; omission preserves saved instructions, an empty string clears them. */
export function parseResidentInstructions(value, profileIds) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 6) throw new Error('지시문은 주민별로 최대 6명까지 설정할 수 있어.')
  const seen = new Set()
  return value.map(entry => {
    if (!entry || !Number.isSafeInteger(entry.profileId) || !profileIds.includes(entry.profileId) || seen.has(entry.profileId)) throw new Error('지시문을 적용할 주민을 중복 없이 골라줘.')
    if (typeof entry.instructions !== 'string') throw new Error('주민 지시문은 문자열로 써줘.')
    seen.add(entry.profileId)
    return { profileId: entry.profileId, instructions: entry.instructions.trim() }
  })
}

export function residentDirective(resident) {
  return resident.instructions ? `이 주민에게만 적용할 어항 전용 추가 설정 (원본 프로필의 성격과 지시문을 유지):\n${resident.instructions}\n추가 설정 끝. 아래의 대화·기억 범위와 응답 형식을 따라줘.` : ''
}
