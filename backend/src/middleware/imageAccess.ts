import { IMAGE_VIEW_PERMISSION } from '@conai/shared';
import type { RequestHandler } from 'express';
import { allowAnonymousPermission, requirePermission } from './authMiddleware';
import { requireRequesterPermission } from './featureAccess';
import type { McpRequester } from '../mcp/context';

/** Shared feature guard; callers keep their existing owner, public-scope and safety checks. */
export const allowImagesView = allowAnonymousPermission(IMAGE_VIEW_PERMISSION);
export const requireImagesView = requirePermission(IMAGE_VIEW_PERMISSION);

/** Account-bound tools recheck feature grants at call time; external MCP keys retain their separate scope contract. */
export function requireRequesterImagePermission(requester: McpRequester | undefined, permission = IMAGE_VIEW_PERMISSION as string): void {
  requireRequesterPermission(requester, permission);
}

export function canRequesterViewImages(requester: McpRequester): boolean {
  try { requireRequesterImagePermission(requester); return true; } catch { return false; }
}

/** Mutations need their own grant in addition to image reading. */
export const requireImageAction = (permissionKey: string): RequestHandler => (req, res, next) => {
  requireImagesView(req, res, () => requirePermission(permissionKey)(req, res, next));
};
