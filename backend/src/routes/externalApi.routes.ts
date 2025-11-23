import { Router, Request, Response } from 'express';
import { ExternalApiProvider } from '../models/ExternalApiProvider';
import { ExternalApiService } from '../services/externalApiService';
import { asyncHandler } from '../middleware/asyncHandler';
import { optionalAuth } from '../middleware/authMiddleware';
import type {
  CreateExternalApiProviderInput,
  UpdateExternalApiProviderInput,
} from '../types/externalApi';

const router = Router();

// Apply optional authentication to all routes
router.use(optionalAuth);

/**
 * Get all external API providers
 * GET /api/external-api/providers
 * Returns masked API keys
 */
router.get('/providers', asyncHandler(async (req: Request, res: Response) => {
  const providers = ExternalApiProvider.findAll();

  res.json({
    success: true,
    data: providers
  });
}));

/**
 * Get a specific provider by name
 * GET /api/external-api/providers/:name
 * Returns masked API key
 */
router.get('/providers/:name', asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.params;
  const provider = ExternalApiProvider.findByName(name);

  if (!provider) {
    res.status(404).json({
      success: false,
      error: 'Provider not found'
    });
    return;
  }

  res.json({
    success: true,
    data: provider
  });
}));

/**
 * Create a new external API provider
 * POST /api/external-api/providers
 * Body: { provider_name, display_name, api_key?, api_secret?, base_url?, additional_config?, is_enabled? }
 */
router.post('/providers', asyncHandler(async (req: Request, res: Response) => {
  const input: CreateExternalApiProviderInput = req.body;

  // Validation
  if (!input.provider_name || !input.display_name) {
    res.status(400).json({
      success: false,
      error: 'provider_name and display_name are required'
    });
    return;
  }

  // Check if provider already exists
  if (ExternalApiProvider.exists(input.provider_name)) {
    res.status(409).json({
      success: false,
      error: 'Provider with this name already exists'
    });
    return;
  }

  // Validate provider_name format (alphanumeric, underscore, hyphen only)
  if (!/^[a-z0-9_-]+$/i.test(input.provider_name)) {
    res.status(400).json({
      success: false,
      error: 'provider_name can only contain letters, numbers, underscores, and hyphens'
    });
    return;
  }

  const providerId = ExternalApiProvider.create(input);
  const provider = ExternalApiProvider.findByName(input.provider_name);

  res.status(201).json({
    success: true,
    data: provider,
    message: 'Provider created successfully'
  });
}));

/**
 * Update an existing provider
 * PUT /api/external-api/providers/:name
 * Body: { display_name?, api_key?, api_secret?, base_url?, additional_config?, is_enabled? }
 */
router.put('/providers/:name', asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.params;
  const input: UpdateExternalApiProviderInput = req.body;

  // Check if provider exists
  if (!ExternalApiProvider.exists(name)) {
    res.status(404).json({
      success: false,
      error: 'Provider not found'
    });
    return;
  }

  const updated = ExternalApiProvider.update(name, input);

  if (!updated) {
    res.status(400).json({
      success: false,
      error: 'No changes made'
    });
    return;
  }

  const provider = ExternalApiProvider.findByName(name);

  res.json({
    success: true,
    data: provider,
    message: 'Provider updated successfully'
  });
}));

/**
 * Delete a provider
 * DELETE /api/external-api/providers/:name
 */
router.delete('/providers/:name', asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.params;

  const deleted = ExternalApiProvider.delete(name);

  if (!deleted) {
    res.status(404).json({
      success: false,
      error: 'Provider not found'
    });
    return;
  }

  res.json({
    success: true,
    message: 'Provider deleted successfully'
  });
}));

/**
 * Toggle provider enabled status
 * PATCH /api/external-api/providers/:name/toggle
 * Body: { is_enabled: boolean }
 */
router.patch('/providers/:name/toggle', asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.params;
  const { is_enabled } = req.body;

  if (typeof is_enabled !== 'boolean') {
    res.status(400).json({
      success: false,
      error: 'is_enabled must be a boolean'
    });
    return;
  }

  // 활성화하려는 경우, API 키가 있는지 확인
  if (is_enabled) {
    const apiKey = ExternalApiProvider.getDecryptedKey(name);
    if (!apiKey) {
      res.status(400).json({
        success: false,
        error: 'Cannot enable provider without API key. Please add an API key first.'
      });
      return;
    }
  }

  const updated = ExternalApiProvider.toggleEnabled(name, is_enabled);

  if (!updated) {
    res.status(404).json({
      success: false,
      error: 'Provider not found'
    });
    return;
  }

  const provider = ExternalApiProvider.findByName(name);

  res.json({
    success: true,
    data: provider,
    message: `Provider ${is_enabled ? 'enabled' : 'disabled'} successfully`
  });
}));

/**
 * Test API connection
 * POST /api/external-api/providers/:name/test
 * Tests the connection with the stored API key
 */
router.post('/providers/:name/test', asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.params;

  // Get decrypted API key
  const apiKey = ExternalApiProvider.getDecryptedKey(name);

  if (!apiKey) {
    res.status(400).json({
      success: false,
      error: 'API key not configured or provider is disabled'
    });
    return;
  }

  // Test connection
  const success = await ExternalApiService.testConnection(name, apiKey);

  res.json({
    success,
    message: success
      ? 'Connection test successful'
      : 'Connection test failed - please check your API key'
  });
}));

export default router;
