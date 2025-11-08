import { Router, Request, Response } from 'express';
import { AuthCredentials } from '../models/AuthCredentials';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

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
 * Login
 * POST /api/auth/login
 */
router.post('/login', asyncHandler(async (req: Request, res: Response) => {
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

    res.json({
      success: true,
      message: 'Authentication configured successfully'
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
router.put('/credentials', asyncHandler(async (req: Request, res: Response) => {
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
      message: 'Credentials updated successfully'
    });
  } catch (error) {
    console.error('Error updating credentials:', error);
    res.status(500).json({ error: 'Failed to update credentials' });
  }
}));

export const authRoutes = router;
