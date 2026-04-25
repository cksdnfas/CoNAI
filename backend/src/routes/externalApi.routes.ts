import { Router, Request, Response } from 'express';
import { routeParam } from './routeParam';
import { ExternalApiProvider } from '../models/ExternalApiProvider';
import { ExternalApiService } from '../services/externalApiService';
import { asyncHandler } from '../middleware/asyncHandler';
import { optionalAuth, requirePermission } from '../middleware/authMiddleware';
import { hasConfiguredAuth } from './auth-route-helpers';
import type {
  CreateExternalApiProviderInput,
  ProviderType,
  UpdateExternalApiProviderInput,
} from '../types/externalApi';

const router = Router();

function isProviderType(value: unknown): value is ProviderType {
  return value === 'general' || value === 'llm_openai_compatible' || value === 'llm_ollama';
}

// Apply optional authentication to all routes
router.use(optionalAuth);

/**
 * Get enabled LLM provider options for graph authoring.
 * GET /api/external-api/llm-options
 * Returns sanitized provider metadata without secrets or base URLs.
 */
router.get('/llm-options', requirePermission('page.generation.view'), asyncHandler(async (_req: Request, res: Response) => {
  const providers = ExternalApiProvider.findEnabledLlmOptions();

  res.json({
    success: true,
    data: providers,
  });
}));

/**
 * Get external API credential security status.
 * GET /api/external-api/security-status
 */
router.get('/security-status', requirePermission('page.settings.view'), asyncHandler(async (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      api_key_encryption_configured: ExternalApiService.hasCustomEncryptionSecret(),
      auth_configured: hasConfiguredAuth(),
    },
  });
}));

router.use(requirePermission('page.settings.view'));

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
  const name = routeParam(req.params.name);
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

  if (input.provider_type !== undefined && !isProviderType(input.provider_type)) {
    res.status(400).json({
      success: false,
      error: 'provider_type must be general, llm_openai_compatible, or llm_ollama'
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
  const name = routeParam(req.params.name);
  const input: UpdateExternalApiProviderInput = req.body;

  if (input.provider_type !== undefined && !isProviderType(input.provider_type)) {
    res.status(400).json({
      success: false,
      error: 'provider_type must be general, llm_openai_compatible, or llm_ollama'
    });
    return;
  }

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
  const name = routeParam(req.params.name);

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
  const name = routeParam(req.params.name);
  const { is_enabled } = req.body;

  if (typeof is_enabled !== 'boolean') {
    res.status(400).json({
      success: false,
      error: 'is_enabled must be a boolean'
    });
    return;
  }

  const provider = ExternalApiProvider.findByName(name);
  if (!provider) {
    res.status(404).json({
      success: false,
      error: 'Provider not found'
    });
    return;
  }

  if (is_enabled && !ExternalApiService.allowsMissingApiKey(provider.provider_type)) {
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

  const updatedProvider = ExternalApiProvider.findByName(name);

  res.json({
    success: true,
    data: updatedProvider,
    message: `Provider ${is_enabled ? 'enabled' : 'disabled'} successfully`
  });
}));

/**
 * Test API connection
 * POST /api/external-api/providers/:name/test
 * Tests the connection with the stored API key
 */
router.post('/providers/:name/test', asyncHandler(async (req: Request, res: Response) => {
  const name = routeParam(req.params.name);

  // Get provider info
  const provider = ExternalApiProvider.findByName(name);
  if (!provider) {
    res.status(404).json({
      success: false,
      error: 'Provider not found'
    });
    return;
  }

  const apiKey = ExternalApiProvider.getDecryptedKey(name);

  if (!apiKey && !ExternalApiService.allowsMissingApiKey(provider.provider_type)) {
    res.status(400).json({
      success: false,
      error: 'API key not configured or provider is disabled'
    });
    return;
  }

  const success = await ExternalApiService.testConnection({
    providerName: name,
    providerType: provider.provider_type,
    apiKey,
    baseUrl: provider.base_url,
  });

  res.json({
    success,
    message: success
      ? 'Connection test successful'
      : 'Connection test failed - please check your API key'
  });
}));

export default router;
