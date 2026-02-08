import { Router, Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server';

const router = Router();

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
