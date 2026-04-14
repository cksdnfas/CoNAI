import type Database from 'better-sqlite3';

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
    permissionKey: 'workflows.view',
    resource: 'workflows',
    action: 'view',
    description: 'Inspect workflow pages and workflow data.',
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

  grantAllCatalogPermissionsToAdminGroup(db);
  normalizeAnonymousRuntimePermissions(db);
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

/** Normalize legacy anonymous page grants to runtime-only access. */
function normalizeAnonymousRuntimePermissions(db: Database.Database): void {
  const anonymousGroupId = getPermissionGroupIdByKey(db, 'anonymous');
  if (anonymousGroupId === null) {
    return;
  }

  const permissionRows = db.prepare(`
    SELECT id, permission_key
    FROM auth_permissions
    WHERE permission_key IN ('page.home.view', 'page.wallpaper.runtime.view')
  `).all() as Array<{ id: number; permission_key: string }>;
  const homePermissionId = permissionRows.find((row) => row.permission_key === 'page.home.view')?.id ?? null;
  const runtimePermissionId = permissionRows.find((row) => row.permission_key === 'page.wallpaper.runtime.view')?.id ?? null;

  if (homePermissionId === null || runtimePermissionId === null) {
    return;
  }

  const assignedPermissionRows = db.prepare(`
    SELECT permission_id
    FROM auth_group_permissions
    WHERE group_id = ? AND permission_id IN (?, ?) AND allowed = 1
  `).all(anonymousGroupId, homePermissionId, runtimePermissionId) as Array<{ permission_id: number }>;
  const hasHomePermission = assignedPermissionRows.some((row) => row.permission_id === homePermissionId);
  const hasRuntimePermission = assignedPermissionRows.some((row) => row.permission_id === runtimePermissionId);

  const normalizeTransaction = db.transaction(() => {
    db.prepare(`
      DELETE FROM auth_group_permissions
      WHERE group_id = ? AND permission_id = ?
    `).run(anonymousGroupId, homePermissionId);

    if (hasHomePermission && !hasRuntimePermission) {
      db.prepare(`
        INSERT INTO auth_group_permissions (
          group_id, permission_id, allowed, created_at, updated_at
        ) VALUES (?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(group_id, permission_id) DO UPDATE SET
          allowed = 1,
          updated_at = CURRENT_TIMESTAMP
      `).run(anonymousGroupId, runtimePermissionId);
    }
  });

  normalizeTransaction();
}

/** Resolve one permission-group id by its stable key. */
function getPermissionGroupIdByKey(db: Database.Database, groupKey: string): number | null {
  const row = db.prepare('SELECT id FROM auth_permission_groups WHERE group_key = ?').get(groupKey) as { id: number } | undefined;
  return row?.id ?? null;
}
