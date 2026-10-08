import type Database from 'better-sqlite3';
import { IMAGE_VIEW_PERMISSION, PERMISSION_CATALOG, PERMISSION_KEYS, type PermissionKey } from '@conai/shared';

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
 * Old keys folded into each catalog key once (`permissions_v2`). A group keeps an ability when it held any of the old
 * keys behind it; page keys are not listed because pages are now derived from these features.
 */
export const PERMISSIONS_V2_SOURCES: Record<PermissionKey, readonly string[]> = {
  'images.view': ['images.view'],
  'images.edit': ['images.update', 'images.metadata.edit', 'groups.create', 'groups.update'],
  'images.delete': ['images.delete', 'groups.delete'],
  'images.upload': ['upload.create'],
  'prompts.view': ['prompts.view'],
  'prompts.edit': ['prompts.create', 'prompts.update', 'prompts.delete'],
  'wildcards.view': ['wildcards.view'],
  'wildcards.edit': ['wildcards.edit', 'wildcards.delete', 'wildcards.lora.scan'],
  'generation.execute': ['generation.execute'],
  'workflows.view': ['workflows.view'],
  'workflows.edit': ['workflows.update'],
  'files.view': ['files.view'],
  'files.edit': ['files.upload', 'files.organize'],
  'files.delete': ['files.delete'],
  'chat.use': ['chat.llm.use'],
  'chat.agent.use': ['chat.codex.use', 'chat.claude.use'],
  'chat.diagnostics.view': ['chat.diagnostics.view', 'chat.diagnostics.content'],
  'auth.guest.create': ['auth.guest.create'],
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

  // Older one-time conversions still run first on databases that predate them; they read the old keys.
  splitLegacyFilesManagePermission(db);
  migrateImageViewPermission(db);
  migrateFilesViewPermission(db);
  migrateWorkflowViewPermission(db);
  migrateIndependentFeaturePermissions(db);
  migrateChatDiagnosticsPermissions(db);
  migratePermissionsV2(db);
  removeUncataloguedPermissions(db);
  grantAllCatalogPermissionsToAdminGroup(db);
  applyAnonymousGuestSignupDefault(db);
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
    const visitorKeys = JSON.stringify(PERMISSION_CATALOG.filter((permission) => 'anonymous' in permission).map((permission) => permission.key));
    const memberOnly = `SELECT gp.permission_id FROM auth_group_permissions gp JOIN auth_permissions p ON p.id = gp.permission_id
      WHERE gp.group_id = (SELECT id FROM auth_permission_groups WHERE group_key = 'anonymous') AND gp.allowed = 1
        AND p.permission_key NOT IN (SELECT value FROM json_each(?))`;
    db.prepare(`INSERT OR IGNORE INTO auth_group_permissions (group_id, permission_id, allowed)
      SELECT (SELECT id FROM auth_permission_groups WHERE group_key = 'guest'), permission_id, 1 FROM (${memberOnly})`).run(visitorKeys);
    db.prepare(`DELETE FROM auth_group_permissions WHERE group_id = (SELECT id FROM auth_permission_groups WHERE group_key = 'anonymous')
      AND permission_id IN (${memberOnly})`).run(visitorKeys);
    // One line per group so an administrator can review what each group can do after the conversion.
    const catalog = new Set<string>(PERMISSION_KEYS);
    console.log('🔐 Permissions converted to the 18-key catalog (permissions_v2):');
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
    `).run(IMAGE_VIEW_PERMISSION, ...LEGACY_IMAGE_VIEW_PERMISSION_KEYS);
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
