import { getAuthDb, syncLegacyAuthCredentialToAccessControl } from '../database/authDb';
import { AuthService } from '../services/authService';

export interface AuthCredential {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

/**
 * AuthCredentials Model
 * Keeps the legacy single-admin credential flow alive while the new account model rolls out.
 */
export class AuthCredentials {
  /**
   * Check if authentication credentials exist
   * @returns True if credentials are configured
   */
  static exists(): boolean {
    const db = getAuthDb();
    const result = db.prepare('SELECT COUNT(*) as count FROM auth_credentials').get() as { count: number };
    return result.count > 0;
  }

  /**
   * Get authentication credentials
   * @returns Auth credential or null if not configured
   */
  static get(): AuthCredential | null {
    const db = getAuthDb();
    const result = db.prepare('SELECT * FROM auth_credentials WHERE id = 1').get() as AuthCredential | undefined;
    return result || null;
  }

  /**
   * Create authentication credentials (initial setup)
   * @param username - Username
   * @param password - Plain text password
   * @returns Created credential
   */
  static async create(username: string, password: string): Promise<AuthCredential> {
    if (this.exists()) {
      throw new Error('Authentication credentials already exist. Use update instead.');
    }

    const passwordHash = await AuthService.hashPassword(password);
    const db = getAuthDb();
    const stmt = db.prepare(`
      INSERT INTO auth_credentials (id, username, password_hash, created_at, updated_at)
      VALUES (1, ?, ?, datetime('now'), datetime('now'))
    `);

    stmt.run(username, passwordHash);
    syncLegacyAuthCredentialToAccessControl();

    const result = this.get();
    if (!result) {
      throw new Error('Failed to create authentication credentials');
    }

    return result;
  }

  /**
   * Update authentication credentials
   * @param username - New username
   * @param password - New plain text password
   * @returns Updated credential
   */
  static async update(username: string, password: string): Promise<AuthCredential> {
    const passwordHash = await AuthService.hashPassword(password);
    const db = getAuthDb();
    const stmt = db.prepare(`
      UPDATE auth_credentials
      SET username = ?, password_hash = ?, updated_at = datetime('now')
      WHERE id = 1
    `);

    const result = stmt.run(username, passwordHash);

    if (result.changes === 0) {
      throw new Error('Failed to update authentication credentials');
    }

    syncLegacyAuthCredentialToAccessControl();

    const updated = this.get();
    if (!updated) {
      throw new Error('Failed to retrieve updated credentials');
    }

    return updated;
  }

  /**
   * Verify login credentials
   * @param username - Username to verify
   * @param password - Plain text password to verify
   * @returns True if credentials are valid
   */
  static async verify(username: string, password: string): Promise<boolean> {
    const credential = this.get();

    if (!credential) {
      return false;
    }

    if (credential.username !== username) {
      return false;
    }

    return await AuthService.verifyPassword(credential.password_hash, password);
  }

  /**
   * Delete authentication credentials
   */
  static delete(): void {
    const db = getAuthDb();
    db.prepare('DELETE FROM auth_credentials WHERE id = 1').run();
    syncLegacyAuthCredentialToAccessControl();
  }
}
