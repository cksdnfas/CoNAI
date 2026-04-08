import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthCredentials } from '../models/AuthCredentials';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAuth } from '../middleware/authMiddleware';
import { getAuthDbPath } from '../database/authDb';
import fs from 'fs';

const router = Router();

// Rate limiting for login endpoint (prevent brute-force attacks)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 5, // 최대 5회 시도
  message: 'Too many login attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true // 성공한 요청은 카운트 제외
});

/**
 * Check authentication status
 * GET /api/auth/status
 */
router.get('/status', asyncHandler(async (req: Request, res: Response) => {
  const hasCredentials = AuthCredentials.exists();
  const isAuthenticated = req.session?.authenticated === true;

  res.json({
    hasCredentials,
    authenticated: isAuthenticated,
    username: req.session?.username || null
  });
}));

/**
 * Get authentication database information
 * GET /api/auth/database-info
 * No authentication required (for account recovery purposes)
 */
router.get('/database-info', asyncHandler(async (req: Request, res: Response) => {
  const authDbPath = getAuthDbPath();
  const exists = fs.existsSync(authDbPath);

  res.json({
    authDbPath,
    exists,
    recoveryInstructions: {
      ko: '계정을 복구하려면: 1) 서버 중지, 2) auth.db 파일 삭제, 3) 서버 재시작',
      en: 'To recover account: 1) Stop server, 2) Delete auth.db file, 3) Restart server'
    }
  });
}));

/**
 * Login
 * POST /api/auth/login
 */
router.post('/login', loginLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = req.body;

  // Validation
  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  // Check if credentials exist
  if (!AuthCredentials.exists()) {
    res.status(404).json({ error: 'Authentication not configured' });
    return;
  }

  // Verify credentials
  const isValid = await AuthCredentials.verify(username, password);

  if (!isValid) {
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  // Set session
  req.session.authenticated = true;
  req.session.username = username;

  res.json({
    success: true,
    message: 'Login successful',
    username
  });
}));

/**
 * Logout
 * POST /api/auth/logout
 */
router.post('/logout', asyncHandler(async (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
      res.status(500).json({ error: 'Failed to logout' });
      return;
    }

    res.json({
      success: true,
      message: 'Logout successful'
    });
  });
}));

/**
 * Setup authentication credentials (initial setup)
 * POST /api/auth/setup
 */
router.post('/setup', asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = req.body;

  // Validation
  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  // Check if credentials already exist
  if (AuthCredentials.exists()) {
    res.status(409).json({ error: 'Authentication already configured. Use update endpoint instead.' });
    return;
  }

  // Create credentials
  try {
    await AuthCredentials.create(username, password);

    req.session.authenticated = true;
    req.session.username = username;

    res.json({
      success: true,
      message: 'Authentication configured successfully',
      username
    });
  } catch (error) {
    console.error('Error creating auth credentials:', error);
    res.status(500).json({ error: 'Failed to configure authentication' });
  }
}));

/**
 * Update authentication credentials
 * PUT /api/auth/credentials
 */
router.put('/credentials', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newUsername, newPassword } = req.body;

  // Validation
  if (!currentPassword || !newUsername || !newPassword) {
    res.status(400).json({ error: 'Current password, new username, and new password are required' });
    return;
  }

  // Check if credentials exist
  if (!AuthCredentials.exists()) {
    res.status(404).json({ error: 'Authentication not configured' });
    return;
  }

  // Get current credentials
  const current = AuthCredentials.get();
  if (!current) {
    res.status(500).json({ error: 'Failed to retrieve current credentials' });
    return;
  }

  // Verify current password
  const isValid = await AuthCredentials.verify(current.username, currentPassword);
  if (!isValid) {
    res.status(401).json({ error: 'Invalid current password' });
    return;
  }

  // Update credentials
  try {
    await AuthCredentials.update(newUsername, newPassword);

    // Update session with new username
    if (req.session.authenticated) {
      req.session.username = newUsername;
    }

    res.json({
      success: true,
      message: 'Credentials updated successfully',
      username: newUsername
    });
  } catch (error) {
    console.error('Error updating credentials:', error);
    res.status(500).json({ error: 'Failed to update credentials' });
  }
}));

export const authRoutes = router;
