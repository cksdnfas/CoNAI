import { AuthAccount } from '../models/AuthAccount';
import { hasConfiguredAuth } from '../routes/auth-route-helpers';
import { AuthAccessControlService } from './authAccessControlService';
import { FileStoreError, fileOwnerKey } from './fileStoreService';
import type { McpRequester } from '../mcp/context';

export type FileStoreAction = 'upload' | 'organize' | 'delete';

export const FILE_STORE_ACTION_PERMISSIONS: Record<FileStoreAction, string> = {
  upload: 'files.edit',
  organize: 'files.edit',
  delete: 'files.delete',
};

const ACTION_DENIED: Record<FileStoreAction, string> = {
  upload: '파일을 올릴 권한이 없어.',
  organize: '파일을 정리할 권한이 없어.',
  delete: '파일을 삭제할 권한이 없어.',
};

/** Shared by chat attachments and MCP. An unbound external key never means the bootstrap owner. */
export function requireFileStoreOwner(requester: McpRequester | undefined): string {
  if (!requester) throw new FileStoreError('파일 접근에는 사용자 계정이 연결된 요청이 필요해.', 403);
  const id = requester.accountId;
  if (id === null) {
    if (hasConfiguredAuth()) throw new FileStoreError('로그인이 필요해.', 401);
    return fileOwnerKey(null);
  }
  if (AuthAccount.findById(id)?.status !== 'active' || !AuthAccessControlService.hasPermission(id, 'files.view')) {
    throw new FileStoreError('파일 보관함 접근 권한이 없어.', 403);
  }
  return fileOwnerKey(id);
}

/** Owner key for one kind of change; each action has its own permission so groups can upload without deleting. */
export function requireFileStoreAction(requester: McpRequester | undefined, action: FileStoreAction): string {
  const owner = requireFileStoreOwner(requester);
  const id = requester?.accountId ?? null;
  if (id !== null && !AuthAccessControlService.hasPermission(id, FILE_STORE_ACTION_PERMISSIONS[action])) {
    throw new FileStoreError(ACTION_DENIED[action], 403);
  }
  return owner;
}

/** Restricted file types are for administrators; bootstrap (no credentials configured) is the local administrator. */
export function canStoreAnyFileType(requester: McpRequester | undefined): boolean {
  const id = requester?.accountId ?? null;
  if (id === null) return !hasConfiguredAuth();
  const account = AuthAccount.findById(id);
  return account?.status === 'active' && account.account_type === 'admin';
}
