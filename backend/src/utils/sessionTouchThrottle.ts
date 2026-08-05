import type { SessionData, Store as SessionStore } from 'express-session';

/**
 * express-session은 요청마다 store.touch()를 호출해 세션 저장소(auth.db)에 동기 UPDATE를 날린다.
 * 접속자 수십 명이 초 단위로 폴링하면 이 쓰기만으로 단일 이벤트 루프가 직렬 대기한다.
 * 쿠키 만료(now + maxAge)는 요청마다 밀리지만, 마지막으로 기록한 만료보다 이 값 이상 앞서지 않는 한
 * 세션 수명에 실질적 차이가 없다. 30일 세션 대비 최대 드리프트는 1시간(0.14%)이며,
 * 활성 세션이 조기 만료되는 일은 없다.
 */
export const SESSION_TOUCH_MIN_EXPIRY_DRIFT_MS = 60 * 60 * 1000;

/** 추적 맵은 프로세스 로컬 최적화이므로 상한을 두고 오래된 항목부터 버린다(누락 시 원래대로 1회 기록). */
export const SESSION_TOUCH_TRACKING_LIMIT = 10_000;

type SessionStoreCallback = (err?: unknown) => void;

/** Resolve the absolute expiry (ms) the session store would persist for this session. */
export function resolveSessionExpiryMs(sessionData: SessionData | undefined): number | null {
  const cookie = sessionData?.cookie as { expires?: Date | string | null; maxAge?: number | null } | undefined;
  if (!cookie) {
    return null;
  }

  const expires = cookie.expires;
  if (expires instanceof Date) {
    const expiryMs = expires.getTime();
    return Number.isFinite(expiryMs) ? expiryMs : null;
  }

  if (typeof expires === 'string') {
    const parsedExpiryMs = Date.parse(expires);
    return Number.isFinite(parsedExpiryMs) ? parsedExpiryMs : null;
  }

  if (typeof cookie.maxAge === 'number' && Number.isFinite(cookie.maxAge)) {
    return Date.now() + cookie.maxAge;
  }

  return null;
}

/**
 * Skip redundant per-request session touch writes on a session store.
 *
 * A touch still reaches the store whenever the expiry drifts past
 * SESSION_TOUCH_MIN_EXPIRY_DRIFT_MS, whenever the persisted expiry is unknown to this process,
 * or whenever the expiry cannot be resolved. Login persistence and expiry-renewal semantics are
 * therefore unchanged; only the write frequency drops (at most one touch write per session per
 * drift window instead of one per request).
 */
export function throttleSessionStoreTouch(store: SessionStore): SessionStore {
  const originalTouch = typeof store.touch === 'function' ? store.touch.bind(store) : null;
  if (!originalTouch) {
    return store;
  }

  const persistedExpiryBySid = new Map<string, number>();

  const rememberPersistedExpiry = (sid: string, expiryMs: number | null): void => {
    persistedExpiryBySid.delete(sid);

    if (expiryMs === null) {
      return;
    }

    persistedExpiryBySid.set(sid, expiryMs);

    while (persistedExpiryBySid.size > SESSION_TOUCH_TRACKING_LIMIT) {
      const oldestSid = persistedExpiryBySid.keys().next().value;
      if (oldestSid === undefined) {
        break;
      }
      persistedExpiryBySid.delete(oldestSid);
    }
  };

  store.touch = function throttledTouch(sid: string, sessionData: SessionData, callback?: () => void): void {
    const expiryMs = resolveSessionExpiryMs(sessionData);
    const persistedExpiryMs = persistedExpiryBySid.get(sid);
    const isWithinExpiryDrift = expiryMs !== null
      && persistedExpiryMs !== undefined
      && expiryMs - persistedExpiryMs < SESSION_TOUCH_MIN_EXPIRY_DRIFT_MS;

    if (isWithinExpiryDrift) {
      callback?.();
      return;
    }

    originalTouch(sid, sessionData, ((error?: unknown) => {
      if (!error) {
        rememberPersistedExpiry(sid, expiryMs);
      }
      (callback as SessionStoreCallback | undefined)?.(error);
    }) as () => void);
  };

  // set()/destroy() rewrite or remove the persisted row outright, so the tracker follows them
  // and never skips a touch against a stale expiry.
  const originalSet = store.set.bind(store);
  store.set = function trackedSet(sid: string, sessionData: SessionData, callback?: SessionStoreCallback): void {
    originalSet(sid, sessionData, (error?: unknown) => {
      if (!error) {
        rememberPersistedExpiry(sid, resolveSessionExpiryMs(sessionData));
      }
      callback?.(error);
    });
  };

  const originalDestroy = store.destroy.bind(store);
  store.destroy = function trackedDestroy(sid: string, callback?: SessionStoreCallback): void {
    persistedExpiryBySid.delete(sid);
    originalDestroy(sid, callback);
  };

  return store;
}
