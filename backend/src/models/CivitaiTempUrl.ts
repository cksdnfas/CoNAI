import { db } from '../database/init';
import crypto from 'crypto';

export interface CivitaiTempUrlRow {
  id: number;
  token: string;
  composite_hash: string;
  include_metadata: number;
  expires_at: string;
  access_count: number;
  created_at: string;
}

export interface CreateTempUrlInput {
  composite_hash: string;
  include_metadata?: boolean;
  expiresInMinutes?: number;
}

/**
 * CivitaiTempUrl - Post Intent용 임시 URL 관리
 */
export class CivitaiTempUrl {
  private static readonly DEFAULT_EXPIRY_MINUTES = 60; // 1시간

  /**
   * 토큰으로 임시 URL 조회
   */
  static findByToken(token: string): CivitaiTempUrlRow | null {
    const row = db.prepare(`
      SELECT * FROM civitai_temp_urls WHERE token = ?
    `).get(token) as CivitaiTempUrlRow | undefined;
    return row || null;
  }

  /**
   * 유효한 임시 URL 조회 (만료되지 않은 것만)
   */
  static findValidByToken(token: string): CivitaiTempUrlRow | null {
    const row = db.prepare(`
      SELECT * FROM civitai_temp_urls
      WHERE token = ? AND expires_at > datetime('now')
    `).get(token) as CivitaiTempUrlRow | undefined;
    return row || null;
  }

  /**
   * 임시 URL 생성
   */
  static create(input: CreateTempUrlInput): string {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresInMinutes = input.expiresInMinutes || this.DEFAULT_EXPIRY_MINUTES;

    db.prepare(`
      INSERT INTO civitai_temp_urls (
        token, composite_hash, include_metadata, expires_at
      ) VALUES (?, ?, ?, datetime('now', '+' || ? || ' minutes'))
    `).run(
      token,
      input.composite_hash,
      input.include_metadata !== false ? 1 : 0,
      expiresInMinutes
    );

    return token;
  }

  /**
   * 여러 이미지에 대한 임시 URL 생성
   */
  static createMany(compositeHashes: string[], includeMetadata = true, expiresInMinutes = 60): string[] {
    const tokens: string[] = [];
    const stmt = db.prepare(`
      INSERT INTO civitai_temp_urls (
        token, composite_hash, include_metadata, expires_at
      ) VALUES (?, ?, ?, datetime('now', '+' || ? || ' minutes'))
    `);

    const insertMany = db.transaction((hashes: string[]) => {
      for (const hash of hashes) {
        const token = crypto.randomBytes(32).toString('hex');
        stmt.run(token, hash, includeMetadata ? 1 : 0, expiresInMinutes);
        tokens.push(token);
      }
    });

    insertMany(compositeHashes);
    return tokens;
  }

  /**
   * 접근 횟수 증가
   */
  static incrementAccessCount(token: string): void {
    db.prepare(`
      UPDATE civitai_temp_urls
      SET access_count = access_count + 1
      WHERE token = ?
    `).run(token);
  }

  /**
   * 만료된 URL 삭제
   */
  static cleanupExpired(): number {
    const result = db.prepare(`
      DELETE FROM civitai_temp_urls WHERE expires_at <= datetime('now')
    `).run();
    return result.changes;
  }

  /**
   * 특정 토큰 삭제
   */
  static delete(token: string): boolean {
    const result = db.prepare(`DELETE FROM civitai_temp_urls WHERE token = ?`).run(token);
    return result.changes > 0;
  }

  /**
   * 모든 임시 URL 삭제
   */
  static clearAll(): number {
    const result = db.prepare(`DELETE FROM civitai_temp_urls`).run();
    return result.changes;
  }
}
