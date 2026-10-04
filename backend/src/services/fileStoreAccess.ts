import { AuthAccount } from '../models/AuthAccount';
import { hasConfiguredAuth } from '../routes/auth-route-helpers';
import { AuthAccessControlService } from './authAccessControlService';
import { FileStoreError, fileOwnerKey } from './fileStoreService';
import type { McpRequester } from '../mcp/context';

/** Shared by chat attachments and MCP. An unbound external key never means the bootstrap owner. */
export function requireFileStoreOwner(requester: McpRequester | undefined): string {
  if (!requester) throw new FileStoreError('파일 접근에는 사용자 계정이 연결된 요청이 필요해.', 403);
  const id = requester.accountId;
  if (id === null) {
    if (hasConfiguredAuth()) throw new FileStoreError('로그인이 필요해.', 401);
    return fileOwnerKey(null);
  }
  if (AuthAccount.findById(id)?.status !== 'active' || !AuthAccessControlService.hasPermission(id, 'page.files.view')) {
    throw new FileStoreError('파일 보관함 접근 권한이 없어.', 403);
  }
  return fileOwnerKey(id);
}
