import type Database from 'better-sqlite3';
import { PERMISSION_CATALOG, PERMISSION_KEYS } from '@conai/shared';
import { carryChatAgentAudience } from './chatPermissionsV3Migration';

const ANONYMOUS_GUEST_SIGNUP_SEED_KEY = 'anonymous_guest_signup_enabled_v1';

const DEFAULT_PERMISSION_GROUPS = [
  {
    groupKey: 'anonymous',
    name: 'Anonymous',
    description: 'Base access for unauthenticated visitors.',
    parentGroupKey: null,
    priority: 0,
    systemGroup: 1,
  },
  {
    groupKey: 'guest',
    name: 'Guest',
    description: 'Local guest accounts that inherit anonymous access.',
    parentGroupKey: 'anonymous',
    priority: 10,
    systemGroup: 1,
  },
  {
    groupKey: 'admin',
    name: 'Admin',
    description: 'System administrators with inherited guest access.',
    parentGroupKey: 'guest',
    priority: 100,
    systemGroup: 1,
  },
] as const;

const DEFAULT_PERMISSION_CATALOG = PERMISSION_CATALOG.map((permission) => ({
  permissionKey: permission.key,
  resource: permission.key.slice(0, permission.key.lastIndexOf('.')),
  action: permission.key.slice(permission.key.lastIndexOf('.') + 1),
  description: permission.description,
}));

/**
 * Old keys folded into each v2 catalog key once (`permissions_v2`). A group keeps an ability when it held any of the old
 * keys behind it. permissions_v3 then turns the v2 keys into pages and the three basic rights; until it has run, these
 * rows are created so older databases still convert through every step.
 */
export const PERMISSIONS_V2_SOURCES: Record<string, readonly string[]> = {
  // Explicit delegation only: content edit rights never turn into shared-settings rights.
  'settings.library.manage': [],
  'settings.appearance.manage': [],
  'settings.media.manage': [],
  'settings.generation.manage': [],
  'settings.analysis.manage': [],
  'settings.posts.manage': [],
  'settings.chat.manage': [],
  'images.view': ['images.view'],
  'images.edit': ['images.update', 'images.metadata.edit', 'groups.create', 'groups.update'],
  'images.delete': ['images.delete', 'groups.delete'],
  'images.upload': ['upload.create'],
  'prompts.view': ['prompts.view'],
  'characters.view': [],
  'characters.edit': [],
  'prompts.edit': ['prompts.create', 'prompts.update', 'prompts.delete'],
  'wildcards.view': ['wildcards.view'],
  'wildcards.edit': ['wildcards.edit', 'wildcards.delete', 'wildcards.lora.scan'],
  'generation.execute': ['generation.execute'],
  'workflows.view': ['workflows.view'],
  'workflows.edit': ['workflows.update'],
  'files.view': ['files.view'],
  'files.edit': ['files.upload', 'files.organize'],
  'files.delete': ['files.delete'],
  // New in the audio workspace: no older key to fold in; administrators get them like every catalog key.
  'audio.view': [],
  'audio.edit': [],
  // New with posts: nothing to fold in.
  'posts.view': [],
  'posts.comment': [],
  'posts.write': [],
  'posts.summon': [],
  'posts.evaluate': [],
  'posts.knowledge.review': [],
  'chat.use': ['chat.llm.use'],
  'chat.agent.use': ['chat.codex.use', 'chat.claude.use'],
  // New with web search: nothing to fold in.
  'chat.web.use': [],
  'chat.diagnostics.view': ['chat.diagnostics.view', 'chat.diagnostics.content'],
  // Pages used to open for every signed-in account; plugins_view_v1 keeps that until an administrator turns it off.
  'plugins.view': [],
  'auth.guest.create': ['auth.guest.create'],
};

/** The only v2 keys a signed-out visitor could use. */
const V2_VISITOR_KEYS = ['images.view', 'auth.guest.create'];

/** The menu pages v2 keys opened (`PAGE_PERMISSION_RULES` until permissions_v3), kept only to convert them. */
const V2_PAGE_RULES: Record<string, { all?: readonly string[]; any?: readonly string[] }> = {
  'page.home.view': { all: ['images.view'] },
  'page.groups.view': { all: ['images.view'] },
  'page.wallpaper.view': { all: ['images.view'] },
  'page.wallpaper.runtime.view': { all: ['images.view'] },
  'page.upload.view': { all: ['images.upload'] },
  'page.audio.view': { all: ['audio.view'] },
  'page.prompts.view': { all: ['prompts.view'] },
  'page.wildcards.view': { all: ['wildcards.view'] },
  'page.characters.view': { all: ['characters.view'] },
  'page.generation.view': { any: ['generation.execute', 'workflows.view'] },
  'page.sprite.view': { all: ['images.view', 'images.edit'] },
  'page.files.view': { all: ['files.view'] },
  'page.posts.view': { all: ['posts.view'] },
  'page.chat.view': { any: ['chat.use', 'chat.agent.use'] },
  'page.extensions.view': { all: ['plugins.view'] },
};

/** Any v2 view key reads, any edit or upload key edits, a delete key deletes. */
const V2_RIGHT_SOURCES: Record<string, readonly string[]> = {
  'content.read': ['images.view', 'prompts.view', 'wildcards.view', 'characters.view', 'workflows.view', 'files.view', 'audio.view', 'posts.view'],
  'content.edit': ['images.edit', 'images.upload', 'prompts.edit', 'wildcards.edit', 'characters.edit', 'workflows.edit', 'files.edit', 'audio.edit', 'posts.knowledge.review'],
  'content.delete': ['images.delete', 'files.delete'],
};

/** Seed built-in permission groups and the initial permission catalog. */
export function seedAccessControlDefaults(db: Database.Database): void {
  const selectGroupId = db.prepare('SELECT id FROM auth_permission_groups WHERE group_key = ?');
  const upsertGroup = db.prepare(`
    INSERT INTO auth_permission_groups (
      group_key, name, description, parent_group_id, priority, system_group, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(group_key) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      parent_group_id = excluded.parent_group_id,
      priority = excluded.priority,
      system_group = excluded.system_group,
      updated_at = CURRENT_TIMESTAMP
  `);

  for (const group of DEFAULT_PERMISSION_GROUPS) {
    const parentRow = group.parentGroupKey
      ? selectGroupId.get(group.parentGroupKey) as { id: number } | undefined
      : undefined;

    upsertGroup.run(
      group.groupKey,
      group.name,
      group.description,
      parentRow?.id ?? null,
      group.priority,
      group.systemGroup,
    );
  }

  const upsertPermission = db.prepare(`
    INSERT INTO auth_permissions (
      permission_key, resource, action, description, created_at, updated_at
    ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(permission_key) DO UPDATE SET
      resource = excluded.resource,
      action = excluded.action,
      description = excluded.description,
      updated_at = CURRENT_TIMESTAMP
  `);

  for (const permission of DEFAULT_PERMISSION_CATALOG) {
    upsertPermission.run(
      permission.permissionKey,
      permission.resource,
      permission.action,
      permission.description,
    );
  }
  if (!db.prepare('SELECT 1 FROM auth_seed_state WHERE seed_key = ?').get('permissions_v3')) {
    for (const key of Object.keys(PERMISSIONS_V2_SOURCES)) {
      upsertPermission.run(key, key.slice(0, key.lastIndexOf('.')), key.slice(key.lastIndexOf('.') + 1), 'v2 key; permissions_v3 converts it.');
    }
  }

  // Older one-time conversions still run first on databases that predate them; they read the old keys.
  splitLegacyFilesManagePermission(db);
  migrateImageViewPermission(db);
  migrateFilesViewPermission(db);
  migrateWorkflowViewPermission(db);
  migrateIndependentFeaturePermissions(db);
  migrateChatDiagnosticsPermissions(db);
  migratePermissionsV2(db);
  db.transaction(() => {
    const key = 'character_library_permissions_v1';
    if (db.prepare('SELECT 1 FROM auth_seed_state WHERE seed_key = ?').get(key)) return;
    for (const action of ['view', 'edit']) {
      db.prepare(`INSERT OR IGNORE INTO auth_group_permissions(group_id, permission_id, allowed)
        SELECT gp.group_id, target.id, gp.allowed FROM auth_group_permissions gp
        JOIN auth_permissions source ON source.id = gp.permission_id
        JOIN auth_permissions target ON target.permission_key = ?
        WHERE source.permission_key = ?`).run(`characters.${action}`, `prompts.${action}`);
    }
    db.prepare('INSERT INTO auth_seed_state(seed_key) VALUES (?)').run(key);
  })();
  grantPluginsViewToGuestGroupOnce(db);
  migratePermissionsV3(db);
  removeUncataloguedPermissions(db);
  grantAllCatalogPermissionsToAdminGroup(db);
  applyAnonymousGuestSignupDefault(db);
}

/**
 * v2 keys become the menu pages they opened plus the three basic rights, once per auth database. Pages are worked out
 * on what a group resolves to (its parents, and for a custom group also the guest group every account carries), and
 * a group stores only what its parent does not already give. Shared-settings grants become administrator-only.
 */
export function migratePermissionsV3(db: Database.Database): void {
  db.transaction(() => {
    const version = 'permissions_v3';
    if (db.prepare('SELECT 1 FROM auth_seed_state WHERE seed_key = ?').get(version)) return;
    const groups = db.prepare('SELECT id, group_key, parent_group_id FROM auth_permission_groups ORDER BY priority, id').all() as Array<{ id: number; group_key: string; parent_group_id: number | null }>;
    const byId = new Map(groups.map((group) => [group.id, group]));
    const direct = new Map<number, string[]>();
    for (const row of db.prepare(`SELECT gp.group_id, p.permission_key FROM auth_group_permissions gp
      JOIN auth_permissions p ON p.id = gp.permission_id WHERE gp.allowed = 1 ORDER BY p.permission_key`).all() as Array<{ group_id: number; permission_key: string }>) {
      direct.set(row.group_id, [...(direct.get(row.group_id) ?? []), row.permission_key]);
    }
    const resolved = (id: number | null, seen = new Set<number>()): string[] => {
      const group = id === null ? undefined : byId.get(id);
      if (!group || seen.has(group.id)) return [];
      seen.add(group.id);
      return [...(direct.get(group.id) ?? []), ...resolved(group.parent_group_id, seen)];
    };
    const toV3 = (v2Keys: string[]) => {
      const held = new Set(v2Keys);
      return new Set([
        ...Object.entries(V2_PAGE_RULES).filter(([, rule]) => (rule.all ?? []).every((key) => held.has(key)) && (!rule.any || rule.any.some((key) => held.has(key)))).map(([page]) => page),
        ...Object.entries(V2_RIGHT_SOURCES).filter(([, sources]) => sources.some((key) => held.has(key))).map(([right]) => right),
        ...(held.has('auth.guest.create') ? ['auth.guest.create'] : []),
      ]);
    };
    const guestKeys = resolved(groups.find((group) => group.group_key === 'guest')?.id ?? null);
    const visitorKeys = new Set<string>(PERMISSION_CATALOG.filter((permission) => 'anonymous' in permission).map((permission) => permission.key));
    // Agent chat needed chat.agent.use: the agent profiles that named no audience keep the groups that held it, unless the
    // guest group (every account) did. user.db applies it at startup (migrateChatPermissionsV3).
    const agentGroups = groups.filter((group) => !['anonymous', 'guest', 'admin'].includes(group.group_key) && resolved(group.id).includes('chat.agent.use'));
    carryChatAgentAudience(db, { everyone: guestKeys.includes('chat.agent.use'), groups: ['admin', ...agentGroups.map((group) => group.group_key)] });
    const catalog = JSON.stringify(PERMISSION_KEYS);
    const clear = db.prepare(`DELETE FROM auth_group_permissions WHERE group_id = ? AND permission_id IN (SELECT id FROM auth_permissions WHERE permission_key IN (SELECT value FROM json_each(?)))`);
    const grant = db.prepare('INSERT OR IGNORE INTO auth_group_permissions (group_id, permission_id, allowed) SELECT ?, id, 1 FROM auth_permissions WHERE permission_key = ?');
    console.log('🔐 Permissions converted to pages and read/edit/delete (permissions_v3):');
    for (const group of groups) {
      if (group.group_key === 'admin') continue;
      const carried = group.group_key === 'anonymous' || group.group_key === 'guest' ? [] : guestKeys;
      const inherited = toV3([...resolved(group.parent_group_id), ...carried]);
      const after = [...toV3([...resolved(group.id), ...carried])]
        .filter((key) => !inherited.has(key) && (group.group_key !== 'anonymous' || visitorKeys.has(key))).sort();
      // Stored page keys from before v2 never counted; pages come only from the keys above.
      clear.run(group.id, catalog);
      for (const key of after) grant.run(group.id, key);
      const before = direct.get(group.id) ?? [];
      const settings = before.filter((key) => /^settings\..+\.manage$/.test(key));
      console.log(`  - ${group.group_key}: [${before.join(', ')}] → [${after.join(', ')}]${settings.length ? ` (administrator-only now: ${settings.join(', ')})` : ''}`);
    }
    db.prepare('INSERT INTO auth_seed_state (seed_key) VALUES (?)').run(version);
  }).immediate();
}

/** Plugin pages were open to every signed-in account; the guest group (inherited by all accounts) keeps that once, later edits stay. */
function grantPluginsViewToGuestGroupOnce(db: Database.Database): void {
  db.transaction(() => {
    const version = 'plugins_view_v1';
    if (db.prepare('SELECT 1 FROM auth_seed_state WHERE seed_key = ?').get(version)) return;
    db.prepare(`INSERT OR IGNORE INTO auth_group_permissions (group_id, permission_id, allowed)
      SELECT g.id, p.id, 1 FROM auth_permission_groups g JOIN auth_permissions p ON p.permission_key = 'plugins.view'
      WHERE g.group_key = 'guest'`).run();
    db.prepare('INSERT INTO auth_seed_state (seed_key) VALUES (?)').run(version);
  }).immediate();
}

/** Fold the old fine-grained keys into the catalog keys once per auth database. */
export function migratePermissionsV2(db: Database.Database): void {
  db.transaction(() => {
    const version = 'permissions_v2';
    if (db.prepare('SELECT 1 FROM auth_seed_state WHERE seed_key = ?').get(version)) return;
    const grantsByGroup = () => new Map((db.prepare(`
      SELECT g.group_key, GROUP_CONCAT(p.permission_key) AS keys FROM auth_permission_groups g
      LEFT JOIN auth_group_permissions gp ON gp.group_id = g.id AND gp.allowed = 1
      LEFT JOIN auth_permissions p ON p.id = gp.permission_id
      WHERE g.group_key != 'admin' GROUP BY g.id ORDER BY g.priority, g.id
    `).all() as Array<{ group_key: string; keys: string | null }>).map((row) => [row.group_key, (row.keys ?? '').split(',').filter(Boolean).sort()]));
    const before = grantsByGroup();
    const grant = db.prepare(`
      INSERT OR IGNORE INTO auth_group_permissions (group_id, permission_id, allowed)
      SELECT DISTINCT gp.group_id, target.id, 1 FROM auth_group_permissions gp
      JOIN auth_permissions source ON source.id = gp.permission_id
      JOIN auth_permissions target ON target.permission_key = ?
      WHERE gp.allowed = 1 AND source.permission_key IN (SELECT value FROM json_each(?))
    `);
    for (const [key, sources] of Object.entries(PERMISSIONS_V2_SOURCES)) grant.run(key, JSON.stringify(sources));
    // Signed-out visitors can only use anonymous keys; anything else on the anonymous group only reached signed-in
    // accounts through inheritance, so it moves to the guest group that every account inherits.
    const visitorKeys = JSON.stringify(V2_VISITOR_KEYS);
    const memberOnly = `SELECT gp.permission_id FROM auth_group_permissions gp JOIN auth_permissions p ON p.id = gp.permission_id
      WHERE gp.group_id = (SELECT id FROM auth_permission_groups WHERE group_key = 'anonymous') AND gp.allowed = 1
        AND p.permission_key NOT IN (SELECT value FROM json_each(?))`;
    db.prepare(`INSERT OR IGNORE INTO auth_group_permissions (group_id, permission_id, allowed)
      SELECT (SELECT id FROM auth_permission_groups WHERE group_key = 'guest'), permission_id, 1 FROM (${memberOnly})`).run(visitorKeys);
    db.prepare(`DELETE FROM auth_group_permissions WHERE group_id = (SELECT id FROM auth_permission_groups WHERE group_key = 'anonymous')
      AND permission_id IN (${memberOnly})`).run(visitorKeys);
    // One line per group so an administrator can review what each group can do after the conversion.
    const catalog = new Set(Object.keys(PERMISSIONS_V2_SOURCES));
    console.log(`🔐 Permissions converted to the ${catalog.size}-key catalog (permissions_v2):`);
    for (const [group, after] of grantsByGroup()) {
      console.log(`  - ${group}: [${(before.get(group) ?? []).join(', ')}] → [${after.filter((key) => catalog.has(key)).join(', ')}]`);
    }
    db.prepare('INSERT INTO auth_seed_state (seed_key) VALUES (?)').run(version);
  }).immediate();
}

/** The catalog is the whole list: rows for removed keys, and denials (which never override a grant), are dropped. */
function removeUncataloguedPermissions(db: Database.Database): void {
  db.transaction(() => {
    const keys = JSON.stringify(PERMISSION_KEYS);
    db.prepare('DELETE FROM auth_group_permissions WHERE allowed = 0 OR permission_id IN (SELECT id FROM auth_permissions WHERE permission_key NOT IN (SELECT value FROM json_each(?)))').run(keys);
    db.prepare('DELETE FROM auth_permissions WHERE permission_key NOT IN (SELECT value FROM json_each(?))').run(keys);
  }).immediate();
}

/** Seed existing chat groups once; later permission edits stay in effect. */
export function migrateChatDiagnosticsPermissions(db: Database.Database): void {
  db.transaction(() => {
    const version = 'chat_diagnostics_v1';
    if (db.prepare('SELECT 1 FROM auth_seed_state WHERE seed_key = ?').get(version)) return;
    db.prepare(`INSERT OR IGNORE INTO auth_group_permissions (group_id, permission_id, allowed)
      SELECT DISTINCT gp.group_id, diagnostic.id, 1 FROM auth_group_permissions gp
      JOIN auth_permissions chat ON chat.id = gp.permission_id
      JOIN auth_permissions diagnostic ON diagnostic.permission_key IN ('chat.diagnostics.view', 'chat.diagnostics.content')
      WHERE gp.allowed = 1 AND chat.permission_key IN ('chat.llm.use', 'chat.codex.use')`).run();
    db.prepare('INSERT INTO auth_seed_state (seed_key) VALUES (?)').run(version);
  }).immediate();
}

/** Only explicit legacy image-bearing grants are converted, once per auth database. */
export const LEGACY_IMAGE_VIEW_PERMISSION_KEYS = [
  'page.home.view', 'page.image-detail.view', 'page.groups.view', 'page.generation.view',
  'page.wallpaper.view', 'page.wallpaper.runtime.view',
  'page.metadata-editor.view', 'chat.codex.use', 'chat.llm.use',
] as const;

export function migrateImageViewPermission(db: Database.Database): void {
  db.transaction(() => {
    const version = 'images_view_v1';
    if (db.prepare('SELECT 1 FROM auth_seed_state WHERE seed_key = ?').get(version)) return;
    // INSERT OR IGNORE preserves any explicit images.view row, including an existing denial.
    db.prepare(`
      INSERT OR IGNORE INTO auth_group_permissions (group_id, permission_id, allowed)
      SELECT DISTINCT gp.group_id, image_permission.id, 1
      FROM auth_group_permissions gp
      JOIN auth_permissions legacy ON legacy.id = gp.permission_id
      JOIN auth_permissions image_permission ON image_permission.permission_key = ?
      WHERE gp.allowed = 1 AND legacy.permission_key IN (${LEGACY_IMAGE_VIEW_PERMISSION_KEYS.map(() => '?').join(', ')})
    `).run('images.view', ...LEGACY_IMAGE_VIEW_PERMISSION_KEYS);
    db.prepare('INSERT INTO auth_seed_state (seed_key) VALUES (?)').run(version);
  }).immediate();
}

function migrateFilesViewPermission(db: Database.Database): void {
  db.transaction(() => {
    const version = 'files_view_v1';
    if (db.prepare('SELECT 1 FROM auth_seed_state WHERE seed_key = ?').get(version)) return;
    db.prepare(`
      INSERT OR IGNORE INTO auth_group_permissions (group_id, permission_id, allowed)
      SELECT gp.group_id, feature.id, 1 FROM auth_group_permissions gp
      JOIN auth_permissions page ON page.id = gp.permission_id AND page.permission_key = 'page.files.view'
      JOIN auth_permissions feature ON feature.permission_key = 'files.view'
      WHERE gp.allowed = 1
    `).run();
    db.prepare('INSERT INTO auth_seed_state (seed_key) VALUES (?)').run(version);
  }).immediate();
}

/** Preserve workflow data access while the generation page becomes an independent navigation switch. */
function migrateWorkflowViewPermission(db: Database.Database): void {
  db.transaction(() => {
    const version = 'workflows_view_v1';
    if (db.prepare('SELECT 1 FROM auth_seed_state WHERE seed_key = ?').get(version)) return;
    db.prepare(`
      INSERT OR IGNORE INTO auth_group_permissions (group_id, permission_id, allowed)
      SELECT gp.group_id, feature.id, 1 FROM auth_group_permissions gp
      JOIN auth_permissions page ON page.id = gp.permission_id AND page.permission_key = 'page.generation.view'
      JOIN auth_permissions feature ON feature.permission_key = 'workflows.view'
      WHERE gp.allowed = 1
    `).run();
    db.prepare('INSERT INTO auth_seed_state (seed_key) VALUES (?)').run(version);
  }).immediate();
}

/** Direct legacy grants are translated once; inheritance and later administrator choices stay untouched. */
export function migrateIndependentFeaturePermissions(db: Database.Database): void {
  db.transaction(() => {
    const version = 'independent_features_v1';
    if (db.prepare('SELECT 1 FROM auth_seed_state WHERE seed_key = ?').get(version)) return;
    const grant = db.prepare(`
      INSERT OR IGNORE INTO auth_group_permissions (group_id, permission_id, allowed)
      SELECT gp.group_id, feature.id, 1 FROM auth_group_permissions gp
      JOIN auth_permissions legacy ON legacy.id = gp.permission_id AND legacy.permission_key = ?
      JOIN auth_permissions feature ON feature.permission_key = ?
      WHERE gp.allowed = 1
    `);
    for (const [legacy, feature] of [
      ['page.prompts.view', 'prompts.view'],
      ['page.wildcards.view', 'wildcards.view'],
      ['page.generation.view', 'generation.execute'],
      ['chat.codex.use', 'page.chat.view'],
      ['chat.llm.use', 'page.chat.view'],
    ]) grant.run(legacy, feature);
    db.prepare('INSERT INTO auth_seed_state (seed_key) VALUES (?)').run(version);
  }).immediate();
}

const FILES_MANAGE_SPLIT_SEED_KEY = 'files_manage_split_v1';

/**
 * `files.manage` used to cover upload, organize and delete at once. Every group that held it keeps
 * all three abilities through the split keys, then the legacy key is removed from the catalog.
 */
function splitLegacyFilesManagePermission(db: Database.Database): void {
  const alreadyApplied = db.prepare('SELECT seed_key FROM auth_seed_state WHERE seed_key = ?').get(FILES_MANAGE_SPLIT_SEED_KEY);
  if (alreadyApplied) {
    return;
  }
  const legacy = db.prepare('SELECT id FROM auth_permissions WHERE permission_key = ?').get('files.manage') as { id: number } | undefined;
  const replacements = db.prepare(`SELECT id FROM auth_permissions WHERE permission_key IN ('files.upload', 'files.organize', 'files.delete')`).all() as Array<{ id: number }>;
  const apply = db.transaction(() => {
    if (legacy) {
      const groups = db.prepare('SELECT group_id FROM auth_group_permissions WHERE permission_id = ? AND allowed = 1').all(legacy.id) as Array<{ group_id: number }>;
      const grant = db.prepare(`
        INSERT INTO auth_group_permissions (group_id, permission_id, allowed, created_at, updated_at)
        VALUES (?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(group_id, permission_id) DO UPDATE SET allowed = 1, updated_at = CURRENT_TIMESTAMP
      `);
      for (const group of groups) {
        for (const permission of replacements) grant.run(group.group_id, permission.id);
      }
      db.prepare('DELETE FROM auth_group_permissions WHERE permission_id = ?').run(legacy.id);
      db.prepare('DELETE FROM auth_permissions WHERE id = ?').run(legacy.id);
    }
    db.prepare('INSERT OR IGNORE INTO auth_seed_state (seed_key, applied_at) VALUES (?, CURRENT_TIMESTAMP)').run(FILES_MANAGE_SPLIT_SEED_KEY);
  });
  apply();
}

/**
 * Enable guest signup for every user once per auth database.
 * Anonymous is the root built-in group, so guest and admin users inherit this permission.
 * The durable marker preserves an administrator's later choice to disable signup.
 */
function applyAnonymousGuestSignupDefault(db: Database.Database): void {
  const alreadyApplied = db.prepare(
    'SELECT seed_key FROM auth_seed_state WHERE seed_key = ?'
  ).get(ANONYMOUS_GUEST_SIGNUP_SEED_KEY) as { seed_key: string } | undefined;

  if (alreadyApplied) {
    return;
  }

  const anonymousGroupId = getPermissionGroupIdByKey(db, 'anonymous');
  const guestSignupPermission = db.prepare(
    'SELECT id FROM auth_permissions WHERE permission_key = ?'
  ).get('auth.guest.create') as { id: number } | undefined;

  if (anonymousGroupId === null || !guestSignupPermission) {
    return;
  }

  const applyDefault = db.transaction(() => {
    db.prepare(`
      INSERT INTO auth_group_permissions (
        group_id, permission_id, allowed, created_at, updated_at
      ) VALUES (?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(group_id, permission_id) DO UPDATE SET
        allowed = 1,
        updated_at = CURRENT_TIMESTAMP
    `).run(anonymousGroupId, guestSignupPermission.id);

    db.prepare(`
      INSERT OR IGNORE INTO auth_seed_state (seed_key, applied_at)
      VALUES (?, CURRENT_TIMESTAMP)
    `).run(ANONYMOUS_GUEST_SIGNUP_SEED_KEY);
  });

  applyDefault();
}

/** Grant the seeded permission catalog to the built-in admin group. */
function grantAllCatalogPermissionsToAdminGroup(db: Database.Database): void {
  const adminGroupId = getPermissionGroupIdByKey(db, 'admin');
  if (adminGroupId === null) {
    return;
  }

  const permissions = db.prepare('SELECT id FROM auth_permissions').all() as Array<{ id: number }>;
  const upsertGroupPermission = db.prepare(`
    INSERT INTO auth_group_permissions (
      group_id, permission_id, allowed, created_at, updated_at
    ) VALUES (?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(group_id, permission_id) DO UPDATE SET
      allowed = 1,
      updated_at = CURRENT_TIMESTAMP
  `);

  const grantTransaction = db.transaction((permissionRows: Array<{ id: number }>) => {
    for (const permission of permissionRows) {
      upsertGroupPermission.run(adminGroupId, permission.id);
    }
  });

  grantTransaction(permissions);
}

/** Resolve one permission-group id by its stable key. */
function getPermissionGroupIdByKey(db: Database.Database, groupKey: string): number | null {
  const row = db.prepare('SELECT id FROM auth_permission_groups WHERE group_key = ?').get(groupKey) as { id: number } | undefined;
  return row?.id ?? null;
}
