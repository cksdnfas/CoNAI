import { useState } from 'react'

const HOME_HIDDEN_GROUPS_KEY = 'conai:home:hidden-group-ids:v1'
/** The server takes at most this many `exclude_group_ids` (backend/src/utils/groupExclusion.ts). */
export const HOME_HIDDEN_GROUPS_LIMIT = 500

function readHiddenGroupIds(): number[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(HOME_HIDDEN_GROUPS_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((id): id is number => Number.isSafeInteger(id) && (id as number) > 0).slice(0, HOME_HIDDEN_GROUPS_LIMIT)
      : []
  } catch {
    return []
  }
}

/**
 * Custom groups whose images the Home gallery leaves out, saved in this browser like the column count.
 * Kept sorted and unique so the feed cache key does not depend on the order they were ticked in.
 */
export function useHomeHiddenGroupIds() {
  const [hiddenGroupIds, setHiddenGroupIdsState] = useState(readHiddenGroupIds)

  const setHiddenGroupIds = (groupIds: number[]) => {
    const next = [...new Set(groupIds)].sort((a, b) => a - b).slice(0, HOME_HIDDEN_GROUPS_LIMIT)
    try {
      window.localStorage.setItem(HOME_HIDDEN_GROUPS_KEY, JSON.stringify(next))
    } catch {
      // Storage off (private mode): the choice lasts for this visit.
    }
    setHiddenGroupIdsState(next)
  }

  return { hiddenGroupIds, setHiddenGroupIds }
}
