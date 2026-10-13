import type { Request, Response } from 'express';
import { selectPageSettings, PAGE_SETTINGS_SCOPES, type PageSettingsScopeId, type PageSettingsSnapshot } from '@conai/shared';
import { settingsService } from './settingsService';
import { loadPostsSettings } from './posts/postsSettings';
import { loadChatSettings } from './codex-chat/chatSettings';
import { nativeEditRevision } from './nativeEditRevision';

export function readPageSettings(scope: PageSettingsScopeId): PageSettingsSnapshot {
  const settings = settingsService.loadSettings();
  const source = scope === 'posts' ? loadPostsSettings() : scope === 'chat' ? loadChatSettings()
    : scope === 'metadata' ? settings.metadataExtraction : scope === 'image-save' ? settings.imageSave
      : scope === 'video-optimization' ? settings.videoOptimization : scope === 'generation-throttle' ? settings.generationThrottle : settings[scope];
  const values = selectPageSettings(scope, source);
  return { values, revision: nativeEditRevision(values) };
}

/** Called again immediately before mutation, after any asynchronous dependency checks. */
export function verifyPageSettingsWrite(res: Response): boolean {
  const verify = res.locals.verifyPageSettingsWrite as (() => boolean) | undefined;
  return verify ? verify() : true;
}

/** Native admin editors use the same revisions as delegated dialogs. */
export function verifyNativePageSettingsRevision(req: Request, res: Response, scope: PageSettingsScopeId): boolean {
  if (req.get('If-Match') && req.get('If-Match') !== readPageSettings(scope).revision) {
    res.status(409).json({ success: false, error: '다른 곳에서 설정이 변경됐어. 최신 값을 불러온 뒤 다시 저장해줘.' });
    return false;
  }
  return true;
}
export function pageSettingsRevisions() {
  return Object.fromEntries((Object.keys(PAGE_SETTINGS_SCOPES) as PageSettingsScopeId[]).map((scope) => [scope, readPageSettings(scope).revision]));
}
