import type Database from 'better-sqlite3';

/** Where permissions_v3 (auth.db) leaves what the chat profiles in user.db need from the old keys. */
export const CHAT_AGENT_AUDIENCE_CARRY = 'permissions_v3.chat_agent_audience';
const MIGRATION = 'permissions_v3_chat';
const SCOPE_ORDER = ['read', 'generate', 'organize', 'delete', 'configure'];

type Carry = { everyone: boolean; groups: string[] };

/**
 * The auth side of the chat part, run inside permissions_v3 before the v2 keys go: agent chat (Codex, Claude) needed
 * chat.agent.use and is now open to every signed-in account, so the groups that held it are kept for the agent
 * profiles that named no audience. `everyone`: the guest group (every account) held it, so nothing narrows.
 */
export function carryChatAgentAudience(db: Database.Database, carry: Carry): void {
  db.exec('CREATE TABLE IF NOT EXISTS auth_migration_carry (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  db.prepare('INSERT OR REPLACE INTO auth_migration_carry (key, value) VALUES (?, ?)').run(CHAT_AGENT_AUDIENCE_CARRY, JSON.stringify(carry));
}

function readCarry(authDb: Database.Database): Carry | null {
  if (!authDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'auth_migration_carry'").get()) return null;
  const row = authDb.prepare('SELECT value FROM auth_migration_carry WHERE key = ?').get(CHAT_AGENT_AUDIENCE_CARRY) as { value: string } | undefined;
  if (!row) return null;
  const parsed = JSON.parse(row.value) as Partial<Carry>;
  return { everyone: parsed.everyone === true, groups: Array.isArray(parsed.groups) ? parsed.groups.filter((key): key is string => typeof key === 'string') : ['admin'] };
}

const list = (text: string | null): unknown[] => {
  try { const value: unknown = JSON.parse(text ?? '[]'); return Array.isArray(value) ? value : []; } catch { return []; }
};
/** Scopes with organize also get delete, which organize used to include. Null: nothing to change. */
function withDelete(text: string | null): string[] | null {
  const scopes = list(text).filter((scope): scope is string => typeof scope === 'string');
  if (!scopes.includes('organize') || scopes.includes('delete')) return null;
  return [...scopes, 'delete'].sort((a, b) => SCOPE_ORDER.indexOf(a) - SCOPE_ORDER.indexOf(b));
}

/**
 * The user.db side of permissions_v3, once, after auth.db converted: (a) agent profiles (Codex, Claude) with no
 * audience get the groups that held chat.agent.use, unless every account did; (b) profile and tool-preset scopes with
 * organize gain delete; (c) profiles' delegated permissions are logged and no longer used. One log line per change.
 * Waits (does nothing) until auth.db has run permissions_v3.
 */
export function migrateChatPermissionsV3(userDb: Database.Database, authDb: Database.Database): void {
  if (userDb.prepare('SELECT 1 FROM chat_settings_migrations WHERE name = ?').get(MIGRATION)) return;
  if (!authDb.prepare("SELECT 1 FROM auth_seed_state WHERE seed_key = 'permissions_v3'").get()) return;
  const carried = readCarry(authDb);
  // An auth.db converted without the carry: the agent profiles stay with administrators until someone widens them.
  const carry = carried ?? { everyone: false, groups: ['admin'] };
  const lines: string[] = [];
  if (!carried) lines.push('  - (auth.db has no record of who held chat.agent.use: agent profiles without an audience go to admin only)');
  const hasDelegated = (userDb.prepare("SELECT name FROM pragma_table_info('llm_chat_profiles')").all() as Array<{ name: string }>).some((column) => column.name === 'delegated_permissions');
  const now = new Date().toISOString();
  userDb.transaction(() => {
    const profiles = userDb.prepare(`SELECT id, name, engine, allowed_group_keys, mcp_scopes${hasDelegated ? ', delegated_permissions' : ''} FROM llm_chat_profiles ORDER BY id`).all() as Array<{
      id: number; name: string; engine: string; allowed_group_keys: string | null; mcp_scopes: string | null; delegated_permissions?: string | null
    }>;
    const setAudience = userDb.prepare("UPDATE llm_chat_profiles SET allowed_group_keys = ?, revision = revision + 1, updated_date = ? WHERE id = ?");
    const setScopes = userDb.prepare("UPDATE llm_chat_profiles SET mcp_scopes = ?, revision = revision + 1, updated_date = ? WHERE id = ?");
    for (const profile of profiles) {
      const label = `profile #${profile.id} "${profile.name}"`;
      if ((profile.engine === 'codex' || profile.engine === 'claude') && !carry.everyone && list(profile.allowed_group_keys).length === 0) {
        setAudience.run(JSON.stringify(carry.groups), now, profile.id);
        lines.push(`  - ${label}: audience [] → [${carry.groups.join(', ')}] (agent chat needed chat.agent.use)`);
      }
      const scopes = withDelete(profile.mcp_scopes);
      if (scopes) {
        setScopes.run(JSON.stringify(scopes), now, profile.id);
        lines.push(`  - ${label}: scopes + delete → [${scopes.join(', ')}]`);
      }
      const delegated = list(profile.delegated_permissions ?? null);
      if (delegated.length) lines.push(`  - ${label}: delegated permissions [${delegated.join(', ')}] no longer apply (the account's rights and the profile's tool settings decide)`);
    }
    if (userDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chat_tool_presets'").get()) {
      const setPreset = userDb.prepare("UPDATE chat_tool_presets SET scopes = ?, revision = revision + 1, updated_date = ? WHERE id = ?");
      for (const preset of userDb.prepare('SELECT id, name, scopes FROM chat_tool_presets ORDER BY id').all() as Array<{ id: number; name: string; scopes: string | null }>) {
        const scopes = withDelete(preset.scopes);
        if (!scopes) continue;
        setPreset.run(JSON.stringify(scopes), now, preset.id);
        lines.push(`  - tool preset #${preset.id} "${preset.name}": scopes + delete → [${scopes.join(', ')}]`);
      }
    }
    userDb.prepare('INSERT INTO chat_settings_migrations(name) VALUES (?)').run(MIGRATION);
  }).immediate();
  if (lines.length) console.log(['🔐 Chat profiles adjusted for permissions_v3:', ...lines].join('\n'));
}
