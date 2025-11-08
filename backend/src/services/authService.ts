import argon2 from 'argon2';

/**
 * Authentication Service
 * Handles password hashing and verification using argon2
 */
export class AuthService {
  /**
   * Hash a password using argon2
   * @param password - Plain text password
   * @returns Hashed password
   */
  static async hashPassword(password: string): Promise<string> {
    try {
      const hash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 2 ** 16, // 64 MB
        timeCost: 3,
        parallelism: 1
      });
      return hash;
    } catch (error) {
      console.error('Error hashing password:', error);
      throw new Error('Failed to hash password');
    }
  }

  /**
   * Verify a password against a hash
   * @param hash - Stored password hash
   * @param password - Plain text password to verify
   * @returns True if password matches
   */
  static async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch (error) {
      console.error('Error verifying password:', error);
      return false;
    }
  }
}
