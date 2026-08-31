import type { NextFunction, Request, Response } from 'express';
import { mcpHttpSettingsService, type McpHttpAuthentication } from '../services/mcpHttpSettingsService';

export type McpResponseLocals = {
  mcpAuth?: McpHttpAuthentication;
};

export function readMcpApiKey(req: Request): string | null {
  const authorization = req.get('authorization');
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return req.get('x-conai-mcp-key')?.trim()
    || req.get('x-api-key')?.trim()
    || null;
}

function isSignedArtifactRequest(req: Request): boolean {
  return req.method === 'GET' && /^\/mcp\/artifacts\/[A-Za-z0-9._-]+$/.test(req.originalUrl.split('?')[0]);
}

/** Authenticate HTTP MCP before the large JSON parser is allowed to read request bytes. */
export function requireMcpHttpAccess(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');

  if (!mcpHttpSettingsService.loadSettings().enabled) {
    res.status(404).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'MCP HTTP endpoint is disabled.' },
      id: null,
    });
    return;
  }

  if (isSignedArtifactRequest(req)) {
    next();
    return;
  }

  const authentication = mcpHttpSettingsService.authenticate(readMcpApiKey(req));
  if (!authentication) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="CoNAI MCP"');
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized' },
      id: null,
    });
    return;
  }

  (res.locals as McpResponseLocals).mcpAuth = authentication;
  next();
}
