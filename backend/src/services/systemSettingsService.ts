import { db } from '../database/init';

interface SystemSetting {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
}

/**
 * 시스템 전역 설정 관리 서비스
 */
export class SystemSettingsService {
  /**
   * 설정값 조회
   */
  static getSetting(key: string): string | null {
    const setting = db
      .prepare('SELECT value FROM system_settings WHERE key = ?')
      .get(key) as { value: string } | undefined;

    return setting?.value || null;
  }

  /**
   * 설정값 조회 (숫자로 변환)
   */
  static getSettingAsNumber(key: string, defaultValue: number): number {
    const value = this.getSetting(key);
    if (!value) return defaultValue;

    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * 설정값 업데이트
   */
  static updateSetting(key: string, value: string): void {
    db.prepare(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `).run(key, value);
  }

  /**
   * 모든 설정 조회
   */
  static getAllSettings(): SystemSetting[] {
    return db.prepare('SELECT * FROM system_settings ORDER BY key').all() as SystemSetting[];
  }

  /**
   * Phase 2 처리 간격 조회 (초)
   */
  static getPhase2Interval(): number {
    return this.getSettingAsNumber('phase2_interval', 30);
  }

  /**
   * Phase 2 처리 간격 업데이트 (초)
   */
  static updatePhase2Interval(seconds: number): void {
    if (seconds < 5 || seconds > 300) {
      throw new Error('간격은 5-300초 사이여야 합니다');
    }
    this.updateSetting('phase2_interval', seconds.toString());
  }

  /**
   * 자동 태깅 폴링 간격 조회 (초)
   */
  static getAutoTagPollingInterval(): number {
    return this.getSettingAsNumber('auto_tag_polling_interval', 30);
  }

  /**
   * 자동 태깅 폴링 간격 업데이트 (초)
   */
  static updateAutoTagPollingInterval(seconds: number): void {
    if (seconds < 5 || seconds > 300) {
      throw new Error('자동 태깅 폴링 간격은 5-300초 사이여야 합니다');
    }
    this.updateSetting('auto_tag_polling_interval', seconds.toString());
  }

  /**
   * 자동 태깅 배치 크기 조회
   */
  static getAutoTagBatchSize(): number {
    return this.getSettingAsNumber('auto_tag_batch_size', 10);
  }

  /**
   * 자동 태깅 배치 크기 업데이트
   */
  static updateAutoTagBatchSize(batchSize: number): void {
    if (batchSize < 1 || batchSize > 100) {
      throw new Error('자동 태깅 배치 크기는 1-100 사이여야 합니다');
    }
    this.updateSetting('auto_tag_batch_size', batchSize.toString());
  }

  /**
   * 파일 검증 활성화 여부 조회
   */
  static isFileVerificationEnabled(): boolean {
    const value = this.getSetting('file_verification_enabled');
    return value === 'true';
  }

  /**
   * 파일 검증 활성화 여부 업데이트
   */
  static updateFileVerificationEnabled(enabled: boolean): void {
    this.updateSetting('file_verification_enabled', enabled.toString());
  }

  /**
   * 파일 검증 간격 조회 (초)
   */
  static getFileVerificationInterval(): number {
    return this.getSettingAsNumber('file_verification_interval', 3600);
  }

  /**
   * 파일 검증 간격 업데이트 (초)
   */
  static updateFileVerificationInterval(seconds: number): void {
    if (seconds < 300 || seconds > 86400) {
      throw new Error('파일 검증 간격은 300-86400초 사이여야 합니다');
    }
    this.updateSetting('file_verification_interval', seconds.toString());
  }
}
