// Server module: runs in its own worker with the app's full reach (see plugins/README.md, "Server modules").
// Rules live in the plugin's own database; the chat.instructions hook appends the ones that apply to the speaking
// profile, and the page edits them through onRequest.

export function activate(conai) {
  conai.db.exec(`CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY,
    profile_id INTEGER,
    text TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`)
  const list = conai.db.prepare('SELECT id, profile_id AS profileId, text, enabled FROM rules ORDER BY id')
  const active = conai.db.prepare('SELECT text FROM rules WHERE enabled = 1 AND (profile_id IS NULL OR profile_id = ?) ORDER BY id')
  const insert = conai.db.prepare('INSERT INTO rules (profile_id, text, enabled) VALUES (?, ?, ?)')
  const update = conai.db.prepare('UPDATE rules SET profile_id = ?, text = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
  const remove = conai.db.prepare('DELETE FROM rules WHERE id = ?')

  conai.hooks.on('chat.instructions', ({ instructions, profile }) => {
    const rules = active.all(profile.id).map((row) => row.text.trim()).filter(Boolean)
    if (!rules.length) return instructions
    return `${instructions}\n\n## 추가 규칙\n${rules.map((rule) => `- ${rule}`).join('\n')}`
  })

  conai.tools.register({
    name: 'list_rules',
    description: 'List the extra chat rules this plugin appends to chat instructions (all profiles, or one profile).',
    scope: 'read',
    inputSchema: { type: 'object', properties: { profile_id: { type: 'integer', minimum: 1 } } },
    handler: ({ profile_id }) => list.all().filter((rule) => profile_id === undefined || rule.profileId === null || rule.profileId === profile_id),
  })

  conai.onRequest(async ({ body }) => {
    const op = body?.op
    if (op === 'list') return { rules: list.all() }
    if (op === 'profiles') {
      // An app tool, run as the person using the page.
      const result = await conai.tools.call('list_chat_profiles', {})
      const text = result?.content?.find((part) => part.type === 'text')?.text ?? '[]'
      return { profiles: JSON.parse(text).map((profile) => ({ id: profile.id, name: profile.name })) }
    }
    if (op === 'save') {
      const text = String(body.text ?? '').trim().slice(0, 2000)
      if (!text) throw new Error('규칙 내용을 써줘.')
      const profileId = Number.isInteger(body.profileId) ? body.profileId : null
      const enabled = body.enabled === false ? 0 : 1
      if (Number.isInteger(body.id)) update.run(profileId, text, enabled, body.id)
      else insert.run(profileId, text, enabled)
      return { rules: list.all() }
    }
    if (op === 'delete') {
      remove.run(body.id)
      return { rules: list.all() }
    }
    throw new Error(`알 수 없는 요청: ${op}`)
  })
}
