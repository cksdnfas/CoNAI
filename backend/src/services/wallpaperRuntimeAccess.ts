import type { NextFunction, Request, Response } from 'express';
import { AuthAccount } from '../models/AuthAccount';
import { WallpaperRuntimeToken } from '../models/WallpaperRuntimeToken';
import { clearSessionAuthAccess, hasConfiguredAuth } from './auth/sessionAccess';
import { isDirectLoopbackRequest } from '../utils/bootstrapAccess';
import { AuthAccessControlService } from './authAccessControlService';

const RUNTIME_PAGE_PERMISSION = 'page.wallpaper.runtime.view';

/**
 * Who a wallpaper runtime request reads as. `tokenId` is set when a runtime key (not a login) grants
 * it; `accountId` null means the local bootstrap owner or an anonymous viewer (see `isAnonymous`).
 */
export interface WallpaperRuntimeAccess {
  accountId: number | null;
  isAdmin: boolean;
  isAnonymous: boolean;
  permissionKeys: string[];
  tokenId: number | null;
  presetId: string | null;
}

export type WallpaperRuntimeLocals = { wallpaperAccess?: WallpaperRuntimeAccess };

/** Resolve a runtime key session without writing the session (safe for long-lived SSE responses). */
function resolveTokenAccess(req: Request): WallpaperRuntimeAccess | null {
  const token = WallpaperRuntimeToken.findActiveById(req.session?.wallpaperRuntimeTokenId);
  if (!token) {
    return null;
  }

  if (token.account_id === null) {
    // Issued in bootstrap mode; once accounts exist the owner must issue a new key from an account.
    if (hasConfiguredAuth()) {
      return null;
    }
    const resolved = AuthAccessControlService.resolveBootstrapAccess();
    return { accountId: null, isAdmin: true, isAnonymous: false, permissionKeys: resolved.permissionKeys, tokenId: token.id, presetId: token.preset_id };
  }

  const account = AuthAccount.findById(token.account_id);
  if (!account || account.status !== 'active') {
    return null;
  }
  const resolved = AuthAccessControlService.resolveForAccountId(account.id);
  return {
    accountId: account.id,
    isAdmin: account.account_type === 'admin',
    isAnonymous: false,
    permissionKeys: resolved.permissionKeys,
    tokenId: token.id,
    presetId: token.preset_id,
  };
}

/**
 * Resolve the wallpaper runtime reader: a login that may open the runtime page, then a runtime key
 * session, then an anonymous viewer whose group may open it. Never mutates the session.
 */
export function resolveWallpaperRuntimeAccess(req: Request): WallpaperRuntimeAccess | null {
  if (!hasConfiguredAuth()) {
    if (isDirectLoopbackRequest(req)) {
      const resolved = AuthAccessControlService.resolveBootstrapAccess();
      return { accountId: null, isAdmin: true, isAnonymous: false, permissionKeys: resolved.permissionKeys, tokenId: null, presetId: null };
    }
    return resolveTokenAccess(req);
  }

  // A key session is also logged in as the key's account (see POST /session); read it as the key so its preset binds.
  const keyAccess = resolveTokenAccess(req);
  if (keyAccess) {
    return keyAccess;
  }

  if (req.session?.authenticated === true && typeof req.session.accountId === 'number') {
    const account = AuthAccount.findById(req.session.accountId);
    if (account && account.status === 'active') {
      const resolved = AuthAccessControlService.resolveForAccountId(account.id);
      if (resolved.permissionKeys.includes(RUNTIME_PAGE_PERMISSION)) {
        return { accountId: account.id, isAdmin: account.account_type === 'admin', isAnonymous: false, permissionKeys: resolved.permissionKeys, tokenId: null, presetId: null };
      }
    }
  }

  const anonymous = AuthAccessControlService.resolveForGroupKey('anonymous');
  if (anonymous.permissionKeys.includes(RUNTIME_PAGE_PERMISSION)) {
    return { accountId: null, isAdmin: false, isAnonymous: true, permissionKeys: anonymous.permissionKeys, tokenId: null, presetId: null };
  }
  return null;
}

/**
 * A wallpaper key logs its browser in as the key's account (a personal app: the wallpaper is the owner's own screen,
 * so its chat and widgets work exactly like the app). That login ends the moment the key is revoked.
 */
export function dropRevokedWallpaperKeyLogin(req: Request, _res: Response, next: NextFunction): void {
  const tokenId = req.session?.wallpaperRuntimeTokenId;
  if (tokenId !== undefined && !WallpaperRuntimeToken.findActiveById(tokenId)) {
    if (req.session.authenticated === true) clearSessionAuthAccess(req);
    delete req.session.wallpaperRuntimeTokenId;
  }
  next();
}

/** True when the request rides a live runtime key session whose reader may view images. */
export function wallpaperRuntimeSessionGrantsImageView(req: Request): boolean {
  const access = resolveTokenAccess(req);
  return access !== null && access.permissionKeys.includes('images.view');
}

export function getWallpaperRuntimeAccess(res: Response): WallpaperRuntimeAccess {
  const access = (res.locals as WallpaperRuntimeLocals).wallpaperAccess;
  if (!access) {
    throw new Error('wallpaper runtime access was not resolved for this request');
  }
  return access;
}

/** Gate every runtime read; records key use for the token list. */
export function requireWallpaperRuntimeAccess(req: Request, res: Response, next: NextFunction): void {
  const access = resolveWallpaperRuntimeAccess(req);
  if (!access) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  if (access.tokenId !== null) {
    WallpaperRuntimeToken.touch(access.tokenId);
  }
  (res.locals as WallpaperRuntimeLocals).wallpaperAccess = access;
  next();
}

/** Error code on a runtime 403 that a login or a runtime key would lift (the reader is logged out). */
export const WALLPAPER_RUNTIME_SIGN_IN_REQUIRED = 'sign_in_required';

/** Refuse a runtime read; widgets tell a logged-out viewer to sign in or use a key instead of "not allowed". */
export function sendWallpaperRuntimeForbidden(res: Response): void {
  const anonymous = getWallpaperRuntimeAccess(res).isAnonymous;
  res.status(403).json({ success: false, error: 'Forbidden', ...(anonymous ? { code: WALLPAPER_RUNTIME_SIGN_IN_REQUIRED } : {}) });
}

/** Gate administrator data using the resolved runtime login or key session. */
export function requireWallpaperRuntimeAdmin(_req: Request, res: Response, next: NextFunction): void {
  if (!getWallpaperRuntimeAccess(res).isAdmin) {
    sendWallpaperRuntimeForbidden(res);
    return;
  }
  next();
}

/** Narrow a runtime read to readers holding one feature permission. */
export function requireWallpaperRuntimePermission(permissionKey: string) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const access = getWallpaperRuntimeAccess(res);
    if (!access.permissionKeys.includes(permissionKey)) {
      sendWallpaperRuntimeForbidden(res);
      return;
    }
    next();
  };
}
