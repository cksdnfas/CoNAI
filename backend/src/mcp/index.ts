import { Router, Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server';
import { validateMcpRequestBody } from './requestSecurity';
import type { McpResponseLocals } from './httpAccess';
import { appendMcpAuditRecord } from '../services/mcpAuditService';
import { McpArtifactService } from '../services/mcpArtifactService';

const router = Router();

router.use('/mcp', validateMcpRequestBody);

/**
 * POST /mcp
 * MCP Streamable HTTP 엔드포인트 (Stateless)
 * 각 요청마다 새로운 McpServer + Transport 인스턴스를 생성한다.
 */
router.post('/mcp', async (req: Request, res: Response) => {
  const startedAt = Date.now();
  const auth = (res.locals as McpResponseLocals).mcpAuth;
  const rpcMethod = typeof req.body?.method === 'string' ? req.body.method : null;
  const toolName = rpcMethod === 'tools/call' && typeof req.body?.params?.name === 'string'
    ? req.body.params.name
    : null;
  res.on('finish', () => appendMcpAuditRecord({
    timestamp: new Date().toISOString(),
    keyId: auth?.keyId ?? null,
    keyName: auth?.keyName ?? null,
    ip: req.ip || null,
    rpcMethod,
    toolName,
    statusCode: res.statusCode,
    durationMs: Date.now() - startedAt,
  }));

  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const server = createMcpServer({
      scopes: auth?.scopes ?? [],
      keyId: auth?.keyId,
      keyName: auth?.keyName,
      baseUrl,
    });
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

router.get('/mcp/artifacts/:artifactId', async (req: Request, res: Response) => {
  const artifactId = Array.isArray(req.params.artifactId) ? req.params.artifactId[0] : req.params.artifactId;
  if (!McpArtifactService.verifyDownloadToken(artifactId, req.query.expires, req.query.token)) {
    res.status(401).json({ error: 'Invalid or expired artifact URL' });
    return;
  }

  const artifact = McpArtifactService.resolve(artifactId);
  if (!artifact) {
    res.status(404).json({ error: 'Artifact not found' });
    return;
  }

  res.setHeader('Content-Type', artifact.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(artifact.fileName)}`);
  res.sendFile(artifact.absolutePath);
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
