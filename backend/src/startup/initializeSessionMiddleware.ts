import BetterSqlite3Store from 'better-sqlite3-session-store';
import type { Express, RequestHandler } from 'express';
import session, { type Store as SessionStore } from 'express-session';
import { initializeAuthDb, getAuthDb } from '../database/authDb';
import { initializeUserSettingsDb } from '../database/userSettingsDb';
import { initializeAudioDb } from '../database/audioDb';
import { FileStoreService } from '../services/fileStoreService';
import { reconcileLorebookFolders } from '../services/codex-chat/chatLorebookFiles';
import { resolveSessionSecret } from '../utils/sessionSecret';
import { throttleSessionStoreTouch } from '../utils/sessionTouchThrottle';

export interface SessionMiddlewareOptions {
  isSecureContext: boolean;
  isDevelopment: boolean;
}

export interface SessionApiRouteAssemblyOptions<TBeforeRoutes, TRouteRegistration> {
  app: Express;
  apiLimiter: RequestHandler;
  initializeSession(): void | Promise<void>;
  beforeRoutes(): TBeforeRoutes | Promise<TBeforeRoutes>;
  registerRoutes(): TRouteRegistration;
}

/** Keep the authentication-dependent bootstrap order executable without importing the server entry point. */
export async function assembleSessionApiRoutes<TBeforeRoutes, TRouteRegistration>({
  app,
  apiLimiter,
  initializeSession,
  beforeRoutes,
  registerRoutes,
}: SessionApiRouteAssemblyOptions<TBeforeRoutes, TRouteRegistration>): Promise<{
  beforeRoutesResult: TBeforeRoutes;
  routeRegistration: TRouteRegistration;
}> {
  await initializeSession();
  app.use('/api', apiLimiter);
  const beforeRoutesResult = await beforeRoutes();
  return {
    beforeRoutesResult,
    routeRegistration: registerRoutes(),
  };
}

/** Initialize the databases backing sessions, then install session middleware before API routes. */
export async function initializeSessionMiddleware(
  app: Express,
  options: SessionMiddlewareOptions,
): Promise<void> {
  initializeAuthDb();
  initializeUserSettingsDb();
  initializeAudioDb();
  try {
    const { moved, orphaned } = FileStoreService.migrateLayout();
    if (moved || orphaned) console.log(`[file-store] Moved ${moved} blob(s) into per-account directories; ${orphaned} orphan(s) set aside.`);
  } catch (error) {
    console.warn('[file-store] Layout migration will retry on next start:', error instanceof Error ? error.message : error);
  }
  // Lorebook folders may have been edited while the app was down: the files win over the cached entries.
  try {
    const { created, refreshed, removed } = reconcileLorebookFolders();
    if (created || refreshed || removed) console.log(`[lorebook] Reconciled book folders: ${created} new, ${refreshed} refreshed, ${removed} gone.`);
  } catch (error) {
    console.warn('[lorebook] Folder reconcile will retry on next start:', error instanceof Error ? error.message : error);
  }

  const SqliteStore = BetterSqlite3Store(session);
  const sessionSecret = resolveSessionSecret().secret;

  const sessionStore = new SqliteStore({
    client: getAuthDb(),
    expired: {
      clear: true,
      intervalMs: 900000,
    },
  }) as SessionStore;

  app.use(session({
    store: throttleSessionStoreTouch(sessionStore),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: options.isSecureContext && !options.isDevelopment,
      sameSite: 'lax',
    },
    name: 'conai.sid',
  }));
}
