import { getUserSettingsDb } from '../../database/userSettingsDb'

/**
 * Server-reported prompt tokens ÷ our estimate, per chat profile and the model it was measured on, kept across
 * restarts: without it every restart starts over at 1× (the estimate errs high), which trims the window too early and
 * can fold a summary before the first reply. A ratio measured on another model is not used.
 */
export const ChatEstimateRatioStore = {
  load(profileId: number, modelKey: string): number | null {
    try {
      const row = getUserSettingsDb().prepare('SELECT model_key, ratio FROM chat_estimate_ratios WHERE profile_id = ?').get(profileId) as { model_key: string; ratio: number } | undefined
      return row && row.model_key === modelKey && Number.isFinite(row.ratio) ? row.ratio : null
    } catch {
      return null
    }
  },

  save(profileId: number, modelKey: string, ratio: number) {
    try {
      getUserSettingsDb().prepare(`INSERT INTO chat_estimate_ratios (profile_id, model_key, ratio, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(profile_id) DO UPDATE SET model_key = excluded.model_key, ratio = excluded.ratio, updated_at = CURRENT_TIMESTAMP`).run(profileId, modelKey, ratio)
    } catch {
      // Best effort: the in-memory ratio still applies.
    }
  },
}
