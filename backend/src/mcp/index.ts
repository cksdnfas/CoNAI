import { Router, Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server';
import { mcpHttpSettingsService } from '../services/mcpHttpSettingsService';

const router = Router();

router.use('/mcp', (_req: Request, res: Response, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

function readMcpApiKey(req: Request): string | null {
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

router.use('/mcp', (_req: Request, res: Response, next) => {
  if (mcpHttpSettingsService.loadSettings().enabled) {
    next();
    return;
  }

  res.status(404).json({
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message: 'MCP HTTP endpoint is disabled.',
    },
    id: null,
  });
});

router.use('/mcp', (req: Request, res: Response, next) => {
  if (mcpHttpSettingsService.isAuthorized(readMcpApiKey(req))) {
    next();
    return;
  }

  res.setHeader('WWW-Authenticate', 'Bearer realm="CoNAI MCP"');
  res.status(401).json({
    jsonrpc: '2.0',
    error: {
      code: -32001,
      message: 'Unauthorized',
    },
    id: null,
  });
});

/**
 * POST /mcp
 * MCP Streamable HTTP 엔드포인트 (Stateless)
 * 각 요청마다 새로운 McpServer + Transport 인스턴스를 생성한다.
 */
router.post('/mcp', async (req: Request, res: Response) => {
  try {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless 모드
    });

    res.on('close', () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('[MCP] Error handling request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

/**
 * GET /mcp — Stateless 모드에서는 SSE 스트림 미지원
 */
router.get('/mcp', (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed. Use POST for stateless MCP requests.' },
    id: null,
  });
});

/**
 * DELETE /mcp — Stateless 모드에서는 세션 삭제 미지원
 */
router.delete('/mcp', (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed. Stateless mode does not support session deletion.' },
    id: null,
  });
});

export { router as mcpRoutes };
