import type Database from 'better-sqlite3';
import { FEATURE_READ_PERMISSION_CATALOG, IMAGE_PERMISSION_CATALOG, IMAGE_VIEW_PERMISSION } from '@conai/shared';

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

const DEFAULT_PERMISSION_CATALOG = [
  ...IMAGE_PERMISSION_CATALOG,
  ...FEATURE_READ_PERMISSION_CATALOG,
  { permissionKey: 'page.chat.view', resource: 'page.chat', action: 'view', description: 'Open the full chat page independently of chat engine use.' },
  { permissionKey: 'files.view', resource: 'files', action: 'view', description: 'Browse and read authorized private files independently of the Files page.' },
  { permissionKey: 'page.files.view', resource: 'page.files', action: 'view', description: 'Open the private Files page.' },
  { permissionKey: 'files.upload', resource: 'files', action: 'upload', description: 'Upload text, image, video, audio and document files into your private file store.' },
  { permissionKey: 'files.organize', resource: 'files', action: 'organize', description: 'Create folders, rename and move your private files.' },
  { permissionKey: 'files.delete', resource: 'files', action: 'delete', description: 'Delete your private files and folders.' },
  { permissionKey: 'files.upload.any', resource: 'files', action: 'upload.any', description: 'Upload executables and other restricted file types.' },
  { permissionKey: 'files.browse.all', resource: 'files', action: 'browse.all', description: 'Browse and manage every account\'s file store.' },
  {
    permissionKey: 'auth.guest.create',
    resource: 'auth',
    action: 'guest.create',
    description: 'Create a guest account from the login page.',
  },
  {
    permissionKey: 'auth.accounts.view',
    resource: 'auth',
    action: 'accounts.view',
    description: 'Inspect the list of local accounts.',
  },
  {
    permissionKey: 'auth.accounts.promote',
    resource: 'auth',
    action: 'accounts.promote',
    description: 'Change account group memberships and promotions.',
  },
  {
    permissionKey: 'page.home.view',
    resource: 'page.home',
    action: 'view',
    description: 'Open the home page.',
  },
  {
    permissionKey: 'page.groups.view',
    resource: 'page.groups',
    action: 'view',
    description: 'Open group browsing pages.',
  },
  {
    permissionKey: 'page.prompts.view',
    resource: 'page.prompts',
    action: 'view',
    description: 'Open prompt pages.',
  },
  {
    permissionKey: 'page.generation.view',
    resource: 'page.generation',
    action: 'view',
    description: 'Open generation pages.',
  },
  {
    permissionKey: 'page.wildcards.view',
    resource: 'page.wildcards',
    action: 'view',
    description: 'Open the wildcard workspace page.',
  },
  {
    permissionKey: 'page.image-detail.view',
    resource: 'page.image-detail',
    action: 'view',
    description: 'Open image detail pages.',
  },
  {
    permissionKey: 'page.metadata-editor.view',
    resource: 'page.metadata-editor',
    action: 'view',
    description: 'Open the metadata editor page.',
  },
  {
    permissionKey: 'page.upload.view',
    resource: 'page.upload',
    action: 'view',
    description: 'Open the upload page.',
  },
  {
    permissionKey: 'page.settings.view',
    resource: 'page.settings',
    action: 'view',
    description: 'Open the settings page.',
  },
  {
    permissionKey: 'page.wallpaper.view',
    resource: 'page.wallpaper',
    action: 'view',
    description: 'Open the wallpaper editor page.',
  },
  {
    permissionKey: 'page.wallpaper.runtime.view',
    resource: 'page.wallpaper.runtime',
    action: 'view',
    description: 'Open the wallpaper runtime page.',
  },
  {
    permissionKey: 'groups.create',
    resource: 'groups',
    action: 'create',
    description: 'Create groups.',
  },
  {
    permissionKey: 'groups.update',
    resource: 'groups',
    action: 'update',
    description: 'Update groups.',
  },
  {
    permissionKey: 'groups.delete',
    resource: 'groups',
    action: 'delete',
    description: 'Delete groups.',
  },
  {
    permissionKey: 'prompts.create',
    resource: 'prompts',
    action: 'create',
    description: 'Create prompts.',
  },
  {
    permissionKey: 'prompts.update',
    resource: 'prompts',
    action: 'update',
    description: 'Update prompts.',
  },
  {
    permissionKey: 'prompts.delete',
    resource: 'prompts',
    action: 'delete',
    description: 'Delete prompts.',
  },
  {
    permissionKey: 'images.copy',
    resource: 'images',
    action: 'copy',
    description: 'Copy or export images.',
  },
  {
    permissionKey: 'images.update',
    resource: 'images',
    action: 'update',
    description: 'Update image records.',
  },
  {
    permissionKey: 'images.delete',
    resource: 'images',
    action: 'delete',
    description: 'Delete image records.',
  },
  {
    permissionKey: 'images.metadata.edit',
    resource: 'images.metadata',
    action: 'edit',
    description: 'Edit image metadata.',
  },
  {
    permissionKey: 'upload.create',
    resource: 'upload',
    action: 'create',
    description: 'Upload files into the system.',
  },
  {
    permissionKey: 'generation.execute',
    resource: 'generation',
    action: 'execute',
    description: 'Run image generation actions.',
  },
  {
    permissionKey: 'wildcards.edit',
    resource: 'wildcards',
    action: 'edit',
    description: 'Create or update wildcard and preprocess entries.',
  },
  {
    permissionKey: 'wildcards.delete',
    resource: 'wildcards',
    action: 'delete',
    description: 'Delete wildcard and preprocess entries.',
  },
  {
    permissionKey: 'wildcards.lora.scan',
    resource: 'wildcards.lora',
    action: 'scan',
    description: 'Run LoRA auto-collection scans.',
  },
  {
    permissionKey: 'workflows.view',
    resource: 'workflows',
    action: 'view',
    description: 'Read workflow, graph, module and dropdown data independently of navigation.',
  },
  {
    permissionKey: 'workflows.update',
    resource: 'workflows',
    action: 'update',
    description: 'Create or edit workflows.',
  },
  {
    permissionKey: 'workflows.execute',
    resource: 'workflows',
    action: 'execute',
    description: 'Run workflow execution actions.',
  },
  {
    permissionKey: 'settings.security.manage',
    resource: 'settings.security',
    action: 'manage',
    description: 'Manage security, accounts, and permissions.',
  },
  {
    permissionKey: 'chat.codex.use',
    resource: 'chat.codex',
    action: 'use',
    description: 'Chat with the server Codex agent (shares the server Codex account usage).',
  },
  {
    permissionKey: 'chat.llm.use',
    resource: 'chat.llm',
    action: 'use',
    description: 'Chat with configured LLM chat profiles.',
  },
  {
    permissionKey: 'chat.tools.read',
    resource: 'chat.tools',
    action: 'read',
    description: 'Let chat agents search and read images, prompts and workflows for this account.',
  },
  {
    permissionKey: 'chat.tools.generate',
    resource: 'chat.tools',
    action: 'generate',
    description: 'Let chat agents run generation jobs and workflows for this account.',
  },
  {
    permissionKey: 'chat.tools.organize',
    resource: 'chat.tools',
    action: 'organize',
    description: 'Let chat agents create groups and move images and prompts for this account.',
  },
  {
    permissionKey: 'chat.tools.configure',
    resource: 'chat.tools',
    action: 'configure',
    description: 'Let chat agents read chat setup and propose chat profiles and display blocks (a person saves them).',
  },
] as const;

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

  splitLegacyFilesManagePermission(db);
  migrateImageViewPermission(db);
  migrateFilesViewPermission(db);
  migrateWorkflowViewPermission(db);
  migrateIndependentFeaturePermissions(db);
  grantAllCatalogPermissionsToAdminGroup(db);
  applyAnonymousGuestSignupDefault(db);
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
