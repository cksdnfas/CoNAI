import { Router, type ErrorRequestHandler } from 'express';
import { isPageSettingsScope, pageSettingsPatch, pageSettingsPermission } from '@conai/shared';
import { requirePermission } from '../middleware/authMiddleware';
import { readPageSettings, verifyPageSettingsWrite } from '../services/pageSettings';
import { updatePostsSettings } from '../services/posts/postsSettings';
import { updateChatSettings } from '../services/codex-chat/chatSettings';
import { generalSettingsRoutes } from './settings/general-settings.routes';
import { mediaSettingsRoutes } from './settings/media-settings.routes';
import { taggerSettingsRoutes } from './settings/tagger-settings.routes';
import { kaloscopeSettingsRoutes } from './settings/kaloscope-settings.routes';
import { embeddingSettingsRoutes } from './settings/embedding-settings.routes';
import { appearanceSettingsRoutes } from './settings/appearance.routes';

const router = Router();
// Reuse the existing native handlers, including their validation, side effects and worker notifications.
// Only exact allowlisted GET/PUT resources reach them; admin tools and subroutes stay inaccessible.
router.use((req, res, next) => {
  const scope = req.path.slice(1);
  if (!isPageSettingsScope(scope)) { res.status(403).json({ success: false, error: '이 경로에서는 허용하지 않는 설정 작업이야.' }); return; }
  if (!['GET', 'PUT'].includes(req.method)) { res.status(405).json({ success: false, error: '지원하지 않는 설정 작업이야.' }); return; }
  const authorize = requirePermission(pageSettingsPermission(scope));
  authorize(req, res, () => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') { res.json({ success: true, data: readPageSettings(scope) }); return; }
    if (!req.get('If-Match')) { res.status(428).json({ success: false, error: '최신 설정을 먼저 읽어줘.' }); return; }
    try { req.body = pageSettingsPatch(scope, req.body); }
    catch (error) { res.status(400).json({ success: false, error: (error as Error).message }); return; }
    res.locals.verifyPageSettingsWrite = () => {
      let allowed = false;
      authorize(req, res, () => { allowed = true; });
      if (!allowed) return false;
      if (req.get('If-Match') !== readPageSettings(scope).revision) {
        res.status(409).json({ success: false, error: '다른 곳에서 설정이 변경됐어. 최신 값을 불러온 뒤 다시 저장해줘.' });
        return false;
      }
      return true;
    };
    if (!verifyPageSettingsWrite(res)) return;
    const json = res.json.bind(res);
    // Native routes return the full AppSettings. Never disclose that payload through a delegated endpoint.
    res.json = (body) => {
      if (res.statusCode >= 400) return json({ success: false, error: res.statusCode === 409
        ? '다른 곳에서 설정이 변경됐어. 최신 값을 불러온 뒤 다시 저장해줘.'
        : res.statusCode === 401 || res.statusCode === 403 ? '설정을 변경할 권한이 없어.'
          : '설정을 적용하지 못했어. 입력 범위와 모델·연산 장치·런타임 준비 상태를 확인해줘.' });
      return json(body?.success === true ? { success: true, data: readPageSettings(scope) } : body);
    };
    next();
  });
});
router.put('/posts', (req, res) => {
  if (!verifyPageSettingsWrite(res)) return;
  updatePostsSettings(req.body);
  res.json({ success: true });
});
router.put('/chat', (req, res) => {
  if (!verifyPageSettingsWrite(res)) return;
  updateChatSettings(req.body);
  res.json({ success: true });
});
router.use(generalSettingsRoutes, mediaSettingsRoutes, taggerSettingsRoutes, kaloscopeSettingsRoutes, embeddingSettingsRoutes, appearanceSettingsRoutes);
// Native worker/file errors can include server paths. They must not escape this delegated boundary.
const settingsError: ErrorRequestHandler = (_error, _req, res, next) => {
  if (res.headersSent) { next(_error); return; }
  res.status(500).json({ success: false, error: '설정을 적용하지 못했어. 관리자에게 런타임 상태 확인을 요청해줘.' });
};
router.use(settingsError);
export const pageSettingsRoutes = router;
