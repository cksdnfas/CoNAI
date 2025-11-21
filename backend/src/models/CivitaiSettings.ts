import { db } from '../database/init';

export interface CivitaiSettingsRow {
  id: number;
  enabled: number;
  api_call_interval: number;
  total_lookups: number;
  successful_lookups: number;
  failed_lookups: number;
  last_api_call: string | null;
  updated_at: string;
}

export interface CivitaiSettingsData {
  enabled: boolean;
  apiCallInterval: number;
  totalLookups: number;
  successfulLookups: number;
  failedLookups: number;
  lastApiCall: string | null;
}

/**
 * CivitaiSettings - Civitai 기능 설정 관리
 */
export class CivitaiSettings {
  /**
   * 현재 설정 조회
   */
  static get(): CivitaiSettingsData {
    const row = db.prepare(`SELECT * FROM civitai_settings WHERE id = 1`).get() as CivitaiSettingsRow | undefined;

    if (!row) {
      // 기본값 반환 (초기 상태는 비활성화 - API 키 설정 전까지)
      return {
        enabled: false,
        apiCallInterval: 2,
        totalLookups: 0,
        successfulLookups: 0,
        failedLookups: 0,
        lastApiCall: null
      };
    }

    return {
      enabled: !!row.enabled,
      apiCallInterval: row.api_call_interval,
      totalLookups: row.total_lookups,
      successfulLookups: row.successful_lookups,
      failedLookups: row.failed_lookups,
      lastApiCall: row.last_api_call
    };
  }

  /**
   * 설정 업데이트
   */
  static update(settings: Partial<Pick<CivitaiSettingsData, 'enabled' | 'apiCallInterval'>>): boolean {
    const updates: string[] = [];
    const values: any[] = [];

    if (settings.enabled !== undefined) {
      updates.push('enabled = ?');
      values.push(settings.enabled ? 1 : 0);
    }
    if (settings.apiCallInterval !== undefined) {
      updates.push('api_call_interval = ?');
      values.push(Math.max(1, Math.min(10, settings.apiCallInterval)));
    }

    if (updates.length === 0) return false;

    updates.push('updated_at = CURRENT_TIMESTAMP');

    const result = db.prepare(`
      UPDATE civitai_settings SET ${updates.join(', ')} WHERE id = 1
    `).run(...values);

    return result.changes > 0;
  }

  /**
   * 성공 통계 증가
   */
  static incrementSuccess(): void {
    db.prepare(`
      UPDATE civitai_settings
      SET total_lookups = total_lookups + 1,
          successful_lookups = successful_lookups + 1,
          last_api_call = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run();
  }

  /**
   * 실패 통계 증가
   */
  static incrementFailure(): void {
    db.prepare(`
      UPDATE civitai_settings
      SET total_lookups = total_lookups + 1,
          failed_lookups = failed_lookups + 1,
          last_api_call = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run();
  }

  /**
   * 통계 초기화
   */
  static resetStats(): void {
    db.prepare(`
      UPDATE civitai_settings
      SET total_lookups = 0, successful_lookups = 0, failed_lookups = 0,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run();
  }
}
