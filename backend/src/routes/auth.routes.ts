import { Router, type Request, type RequestHandler, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import { AuthCredentials } from '../models/AuthCredentials';
import { AuthAccount, type AssignableSystemGroupKey } from '../models/AuthAccount';
import { AuthPermissionGroup } from '../models/AuthPermissionGroup';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAdmin, requireAuth } from '../middleware/authMiddleware';
import { getAuthDbPath, syncLegacyAuthCredentialToAccessControl } from '../database/authDb';
import { buildAuthStatusPayload, hasConfiguredAuth, invalidateConfiguredAuthCache, setAuthenticatedSession } from './auth-route-helpers';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

type SessionResponseAccount = {
  id: number | null;
  username: string;
  account_type: 'admin' | 'guest';
};

/** Send the auth route's legacy 400 payload shape without changing response contracts. */
function sendAuthBadRequest(res: Response, error: string) {
  res.status(400).json({ error });
  return false;
}

/** Parse one auth route integer while preserving the current Number.parseInt semantics. */
function parseAuthInteger(value: unknown) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) ? parsed : null;
}

/** Parse one required integer param/body value or send the route's legacy invalid-id payload. */
function parseRequiredAuthInteger(res: Response, value: unknown, error: string) {
  const parsed = parseAuthInteger(value);
  if (parsed === null) {
    sendAuthBadRequest(res, error);
    return null;
  }

  return parsed;
}

/** Reuse the permission-group route error/status mapping without changing response contracts. */
function sendPermissionGroupRouteError(res: Response, error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const statusCode = (
    message === 'Invalid group id'
    || message === 'Group name is required'
    || message === 'One or more permission keys are invalid'
    || message === 'System groups cannot be modified through this endpoint'
  ) ? 400 : (message === 'Permission group not found' || message === 'Account not found') ? 404 : 500;

  res.status(statusCode).json({ error: message });
}

/** Normalize SQLite UTC timestamps into ISO strings so clients parse them consistently. */
function formatSqliteUtcTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
}

/** Build the shared authenticated-session response payload. */
function buildSessionAccountResponse(req: Request, message: string, account: SessionResponseAccount) {
  return {
    success: true,
    message,
    username: account.username,
    accountId: account.id,
    accountType: account.account_type,
    isAdmin: account.account_type === 'admin',
    groupKeys: req.session.groupKeys ?? [],
    permissionKeys: req.session.permissionKeys ?? [],
  };
}

/** Format one editable built-in permission into the current UI label shape. */
function formatBuiltInPermissionLabel(permissionKey: string, resource: string): string {
  if (permissionKey === 'wildcards.edit') {
    return 'Wildcard Edit';
  }

  if (permissionKey === 'wildcards.delete') {
    return 'Wildcard Delete';
  }

  return resource
    .replace(/^page\./, '')
    .replace(/\.runtime$/, ' runtime')
    .split('.')
    .join(' ')
    .replace(/(^|\s)\w/g, (character) => character.toUpperCase());
}

/** Handle auth status reads. */
const handleStatus: RequestHandler = async (req, res) => {
  res.json(buildAuthStatusPayload(req));
};

/** Handle current-account reads for authenticated sessions. */
const handleMe: RequestHandler = async (req, res) => {
  res.json({
    success: true,
    data: buildAuthStatusPayload(req),
  });
};

/** Handle auth database info reads for recovery guidance. */
const handleDatabaseInfo: RequestHandler = async (_req, res) => {
  const authDbPath = getAuthDbPath();
  const exists = fs.existsSync(authDbPath);

  res.json({
    authDbPath,
    exists,
    recoveryInstructions: {
      ko: '계정을 복구하려면: 1) 서버 중지, 2) auth.db 파일 삭제, 3) 서버 재시작',
      en: 'To recover account: 1) Stop server, 2) Delete auth.db file, 3) Restart server',
    },
  });
};

/** Handle username/password login for local accounts and legacy credentials. */
const handleLogin: RequestHandler = async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!username || !password) {
    sendAuthBadRequest(res, 'Username and password are required');
    return;
  }

  if (!hasConfiguredAuth()) {
    res.status(404).json({ error: 'Authentication not configured' });
    return;
  }

  let account = await AuthAccount.verify(username, password);

  if (!account && AuthCredentials.exists()) {
    const legacyValid = await AuthCredentials.verify(username, password);
    if (legacyValid) {
      syncLegacyAuthCredentialToAccessControl();
      account = await AuthAccount.verify(username, password);
    }
  }

  if (!account) {
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  setAuthenticatedSession(req, account);
  AuthAccount.touchLastLogin(account.id);

  res.json(buildSessionAccountResponse(req, 'Login successful', {
    id: account.id,
    username: account.username,
    account_type: account.account_type,
  }));
};

/** Handle logout by destroying the current session. */
const handleLogout: RequestHandler = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
      res.status(500).json({ error: 'Failed to logout' });
      return;
    }

    res.json({
      success: true,
      message: 'Logout successful',
    });
  });
};

/** Handle the first-admin setup flow backed by legacy credentials. */
const handleSetup: RequestHandler = async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!username || !password) {
    sendAuthBadRequest(res, 'Username and password are required');
    return;
  }

  if (AuthCredentials.exists()) {
    res.status(409).json({ error: 'Authentication already configured. Use update endpoint instead.' });
    return;
  }

  try {
    await AuthCredentials.create(username, password);
    invalidateConfiguredAuthCache();
    syncLegacyAuthCredentialToAccessControl();

    const account = AuthAccount.findByUsername(username);
    if (!account) {
      res.status(500).json({ error: 'Failed to create the initial admin account' });
      return;
    }

    setAuthenticatedSession(req, account);

    res.json(buildSessionAccountResponse(req, 'Authentication configured successfully', {
      id: account.id,
      username: account.username,
      account_type: account.account_type,
    }));
  } catch (error) {
    console.error('Error creating auth credentials:', error);
    res.status(500).json({ error: 'Failed to configure authentication' });
  }
};

/** Handle legacy admin credential updates while keeping account sync intact. */
const handleUpdateCredentials: RequestHandler = async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newUsername = String(req.body?.newUsername || '').trim();
  const newPassword = String(req.body?.newPassword || '');

  if (!currentPassword || !newUsername || !newPassword) {
    sendAuthBadRequest(res, 'Current password, new username, and new password are required');
    return;
  }

  if (!AuthCredentials.exists()) {
    res.status(404).json({ error: 'Authentication not configured' });
    return;
  }

  const current = AuthCredentials.get();
  if (!current) {
    res.status(500).json({ error: 'Failed to retrieve current credentials' });
    return;
  }

  const isValid = await AuthCredentials.verify(current.username, currentPassword);
  if (!isValid) {
    res.status(401).json({ error: 'Invalid current password' });
    return;
  }

  try {
    const updated = await AuthCredentials.update(newUsername, newPassword);
    const syncedAccount = AuthAccount.findByUsername(updated.username);

    req.session.username = updated.username;
    if (syncedAccount) {
      setAuthenticatedSession(req, syncedAccount);
    }

    res.json(buildSessionAccountResponse(req, 'Credentials updated successfully', {
      id: syncedAccount?.id ?? null,
      username: updated.username,
      account_type: syncedAccount?.account_type ?? 'admin',
    }));
  } catch (error) {
    console.error('Error updating credentials:', error);
    res.status(500).json({ error: 'Failed to update credentials' });
  }
};

/** Handle guest account creation from the login page. */
const handleGuestAccountCreate: RequestHandler = async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!username || !password) {
    sendAuthBadRequest(res, 'Username and password are required');
    return;
  }

  if (!hasConfiguredAuth()) {
    res.status(409).json({ error: 'Create the admin account first' });
    return;
  }

  try {
    const account = await AuthAccount.createGuest(username, password, null);
    res.status(201).json({
      success: true,
      message: 'Guest account created successfully',
      account: {
        id: account.id,
        username: account.username,
        accountType: account.account_type,
        status: account.status,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create guest account';
    const statusCode = message === 'Username already exists' ? 409 : 500;
    res.status(statusCode).json({ error: message });
  }
};

/** Handle account list reads for the admin review UI. */
const handleAccountsList: RequestHandler = async (_req, res) => {
  const accounts = AuthAccount.listAll();
  res.json({
    success: true,
    data: accounts.map((account) => ({
      id: account.id,
      username: account.username,
      accountType: account.account_type,
      status: account.status,
      groupKeys: account.group_keys,
      createdByAccountId: account.created_by_account_id,
      lastLoginAt: formatSqliteUtcTimestamp(account.last_login_at),
      createdAt: formatSqliteUtcTimestamp(account.created_at),
      updatedAt: formatSqliteUtcTimestamp(account.updated_at),
      syncedLegacyAdmin: account.sync_key === 'legacy-admin',
    })),
  });
};

/** Format one permission-group summary for the settings UI. */
function formatPermissionGroupSummary(group: ReturnType<typeof AuthPermissionGroup.listAllGroups>[number]) {
  return {
    id: group.id,
    groupKey: group.group_key,
    name: group.name,
    description: group.description,
    parentGroupId: group.parent_group_id,
    parentGroupKey: group.parent_group_key,
    priority: group.priority,
    systemGroup: group.system_group,
    directPermissionKeys: group.direct_permission_keys,
    memberCount: group.member_count,
  };
}

/** Handle built-in or generic permission-group reads depending on the requested scope. */
const handlePermissionGroups: RequestHandler = async (req, res) => {
  const scope = String(req.query.scope || '').trim();

  if (scope === 'all') {
    res.json({
      success: true,
      data: AuthPermissionGroup.listAllGroups().map(formatPermissionGroupSummary),
    });
    return;
  }

  res.json({
    success: true,
    data: AuthAccount.listAssignableSystemGroups().map((group) => ({
      groupKey: group.group_key,
      name: group.name,
    })),
  });
};

/** Handle one permission-group detail read with its current members. */
const handlePermissionGroupDetail: RequestHandler = async (req, res) => {
  const groupId = parseRequiredAuthInteger(res, req.params.groupId, 'Invalid group id');
  if (groupId === null) {
    return;
  }

  const group = AuthPermissionGroup.findGroupById(groupId);
  if (!group) {
    res.status(404).json({ error: 'Permission group not found' });
    return;
  }

  const members = AuthPermissionGroup.listGroupMembers(groupId);
  res.json({
    success: true,
    data: {
      group: formatPermissionGroupSummary(group),
      members: members.map((member) => ({
        id: member.id,
        username: member.username,
        accountType: member.account_type,
        status: member.status,
      })),
    },
  });
};

/** Handle one custom permission-group creation. */
const handlePermissionGroupCreate: RequestHandler = async (req, res) => {
  const name = String(req.body?.name || '');
  const description = req.body?.description == null ? null : String(req.body.description);
  const permissionKeys = Array.isArray(req.body?.permissionKeys)
    ? req.body.permissionKeys.map((value: unknown) => String(value || ''))
    : [];

  try {
    const group = AuthPermissionGroup.createCustomGroup({ name, description, permissionKeys });
    res.status(201).json({
      success: true,
      message: 'Permission group created successfully',
      data: formatPermissionGroupSummary(group),
    });
  } catch (error) {
    sendPermissionGroupRouteError(res, error, 'Failed to create permission group');
  }
};

/** Handle one custom permission-group update. */
const handlePermissionGroupUpdate: RequestHandler = async (req, res) => {
  const groupId = parseRequiredAuthInteger(res, req.params.groupId, 'Invalid group id');
  if (groupId === null) {
    return;
  }

  const name = String(req.body?.name || '');
  const description = req.body?.description == null ? null : String(req.body.description);
  const permissionKeys = Array.isArray(req.body?.permissionKeys)
    ? req.body.permissionKeys.map((value: unknown) => String(value || ''))
    : [];

  try {
    const group = AuthPermissionGroup.updateCustomGroup(groupId, { name, description, permissionKeys });
    res.json({
      success: true,
      message: 'Permission group updated successfully',
      data: formatPermissionGroupSummary(group),
    });
  } catch (error) {
    sendPermissionGroupRouteError(res, error, 'Failed to update permission group');
  }
};

/** Handle one custom permission-group deletion. */
const handlePermissionGroupDelete: RequestHandler = async (req, res) => {
  const groupId = parseRequiredAuthInteger(res, req.params.groupId, 'Invalid group id');
  if (groupId === null) {
    return;
  }

  try {
    AuthPermissionGroup.deleteCustomGroup(groupId);
    res.json({
      success: true,
      message: 'Permission group deleted successfully',
    });
  } catch (error) {
    sendPermissionGroupRouteError(res, error, 'Failed to delete permission group');
  }
};

/** Handle adding one account membership to one custom permission group. */
const handlePermissionGroupMemberAdd: RequestHandler = async (req, res) => {
  const groupId = parseRequiredAuthInteger(res, req.params.groupId, 'Invalid group id');
  if (groupId === null) {
    return;
  }

  const accountId = parseRequiredAuthInteger(res, req.body?.accountId, 'Invalid account id');
  if (accountId === null) {
    return;
  }

  try {
    AuthPermissionGroup.addAccountMembership(groupId, accountId);
    res.json({
      success: true,
      message: 'Group member added successfully',
    });
  } catch (error) {
    sendPermissionGroupRouteError(res, error, 'Failed to add group member');
  }
};

/** Handle removing one account membership from one custom permission group. */
const handlePermissionGroupMemberRemove: RequestHandler = async (req, res) => {
  const groupId = parseRequiredAuthInteger(res, req.params.groupId, 'Invalid group id');
  if (groupId === null) {
    return;
  }

  const accountId = parseRequiredAuthInteger(res, req.params.accountId, 'Invalid account id');
  if (accountId === null) {
    return;
  }

  try {
    AuthPermissionGroup.removeAccountMembership(groupId, accountId);
    res.json({
      success: true,
      message: 'Group member removed successfully',
    });
  } catch (error) {
    sendPermissionGroupRouteError(res, error, 'Failed to remove group member');
  }
};

/** Handle built-in guest/anonymous permission matrix reads. */
const handlePageAccessList: RequestHandler = async (_req, res) => {
  const permissions = AuthPermissionGroup.listBuiltInEditablePermissions();
  const groups = AuthPermissionGroup.listBuiltInPageAccess(['anonymous', 'guest', 'admin']);

  res.json({
    success: true,
    data: {
      permissions: permissions.map((permission) => ({
        permissionKey: permission.permission_key,
        label: formatBuiltInPermissionLabel(permission.permission_key, permission.resource),
        description: permission.description,
      })),
      groups: groups.map((group) => ({
        groupKey: group.group_key,
        name: group.name,
        description: group.description,
        permissionKeys: group.permission_keys,
      })),
    },
  });
};

/** Handle built-in guest/anonymous permission replacements. */
const handlePageAccessReplace: RequestHandler = async (req, res) => {
  const groupKey = String(req.params.groupKey || '').trim();
  const permissionKeys = Array.isArray(req.body?.permissionKeys)
    ? req.body.permissionKeys.map((value: unknown) => String(value || ''))
    : null;

  if (groupKey !== 'anonymous' && groupKey !== 'guest') {
    sendAuthBadRequest(res, 'groupKey must be one of: anonymous, guest');
    return;
  }

  if (!permissionKeys) {
    sendAuthBadRequest(res, 'permissionKeys must be an array');
    return;
  }

  try {
    const updatedGroup = AuthPermissionGroup.replaceBuiltInPageAccess(groupKey, permissionKeys);
    res.json({
      success: true,
      message: `${updatedGroup.name} built-in access updated successfully`,
      data: {
        groupKey: updatedGroup.group_key,
        name: updatedGroup.name,
        description: updatedGroup.description,
        permissionKeys: updatedGroup.permission_keys,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update page access';
    const statusCode = message === 'One or more permission keys are invalid' ? 400 : 500;
    res.status(statusCode).json({ error: message });
  }
};

/** Handle system-group changes for one local account. */
const handleAccountSystemGroupUpdate: RequestHandler = async (req, res) => {
  const accountId = parseAuthInteger(req.params.accountId);
  const groupKey = String(req.body?.groupKey || '').trim() as AssignableSystemGroupKey;

  if (accountId === null) {
    sendAuthBadRequest(res, 'Invalid account id');
    return;
  }

  if (groupKey !== 'guest' && groupKey !== 'admin') {
    sendAuthBadRequest(res, 'groupKey must be one of: guest, admin');
    return;
  }

  const targetAccount = AuthAccount.findById(accountId);
  if (!targetAccount) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  if (req.session.accountId === accountId && groupKey !== 'admin') {
    sendAuthBadRequest(res, 'You cannot demote your current admin session');
    return;
  }

  if (targetAccount.account_type === 'admin' && groupKey !== 'admin' && AuthAccount.countActiveAdmins() <= 1) {
    sendAuthBadRequest(res, 'At least one active admin account must remain');
    return;
  }

  try {
    const updatedAccount = AuthAccount.assignSystemGroup(accountId, groupKey);
    res.json({
      success: true,
      message: 'Account group updated successfully',
      account: {
        id: updatedAccount.id,
        username: updatedAccount.username,
        accountType: updatedAccount.account_type,
        status: updatedAccount.status,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update account group';
    res.status(500).json({ error: message });
  }
};

/** Handle admin-side password changes for one local account. */
const handleAccountPasswordUpdate: RequestHandler = async (req, res) => {
  const accountId = parseAuthInteger(req.params.accountId);
  const newPassword = String(req.body?.newPassword || '');

  if (accountId === null) {
    sendAuthBadRequest(res, 'Invalid account id');
    return;
  }

  if (!newPassword.trim()) {
    sendAuthBadRequest(res, 'newPassword is required');
    return;
  }

  try {
    await AuthAccount.updatePassword(accountId, newPassword);
    res.json({
      success: true,
      message: 'Account password updated successfully',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update account password';
    const statusCode = (
      message === 'Password is required'
      || message === 'Synced legacy admin passwords must be changed from the main credentials form'
    ) ? 400 : message === 'Account not found' ? 404 : 500;
    res.status(statusCode).json({ error: message });
  }
};

/** Handle one removable account deletion from the admin UI. */
const handleAccountDelete: RequestHandler = async (req, res) => {
  const accountId = parseAuthInteger(req.params.accountId);

  if (accountId === null) {
    sendAuthBadRequest(res, 'Invalid account id');
    return;
  }

  if (req.session.accountId === accountId) {
    sendAuthBadRequest(res, 'You cannot delete your current session account');
    return;
  }

  try {
    AuthAccount.delete(accountId);
    res.json({
      success: true,
      message: 'Account deleted successfully',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete account';
    const statusCode = (
      message === 'Synced legacy admin accounts cannot be deleted'
      || message === 'At least one active admin account must remain'
    ) ? 400 : message === 'Account not found' ? 404 : 500;
    res.status(statusCode).json({ error: message });
  }
};

router.get('/status', asyncHandler(handleStatus));
router.get('/me', requireAuth, asyncHandler(handleMe));
router.get('/database-info', asyncHandler(handleDatabaseInfo));
router.post('/login', loginLimiter, asyncHandler(handleLogin));
router.post('/logout', asyncHandler(handleLogout));
router.post('/setup', asyncHandler(handleSetup));
router.put('/credentials', requireAdmin, asyncHandler(handleUpdateCredentials));
router.post('/guest-accounts', asyncHandler(handleGuestAccountCreate));
router.get('/accounts', requireAdmin, asyncHandler(handleAccountsList));
router.get('/permission-groups', requireAdmin, asyncHandler(handlePermissionGroups));
router.post('/permission-groups', requireAdmin, asyncHandler(handlePermissionGroupCreate));
router.get('/permission-groups/:groupId', requireAdmin, asyncHandler(handlePermissionGroupDetail));
router.put('/permission-groups/:groupId', requireAdmin, asyncHandler(handlePermissionGroupUpdate));
router.delete('/permission-groups/:groupId', requireAdmin, asyncHandler(handlePermissionGroupDelete));
router.post('/permission-groups/:groupId/members', requireAdmin, asyncHandler(handlePermissionGroupMemberAdd));
router.delete('/permission-groups/:groupId/members/:accountId', requireAdmin, asyncHandler(handlePermissionGroupMemberRemove));
router.get('/page-access', requireAdmin, asyncHandler(handlePageAccessList));
router.put('/page-access/:groupKey', requireAdmin, asyncHandler(handlePageAccessReplace));
router.put('/accounts/:accountId/system-group', requireAdmin, asyncHandler(handleAccountSystemGroupUpdate));
router.put('/accounts/:accountId/password', requireAdmin, asyncHandler(handleAccountPasswordUpdate));
router.delete('/accounts/:accountId', requireAdmin, asyncHandler(handleAccountDelete));

export const authRoutes = router;
