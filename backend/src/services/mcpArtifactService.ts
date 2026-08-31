import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { GraphExecutionArtifactModel } from '../models/GraphExecutionArtifact';
import { HistoryQueryRepository } from '../repositories/history/HistoryQueryRepository';
import { FileDiscoveryService } from './folderScan/fileDiscoveryService';
import { ImageUploadService } from './imageUploadService';
import { mcpHttpSettingsService } from './mcpHttpSettingsService';

const MCP_ARTIFACT_PREFIX = 'mcp_artifact_';
const DEFAULT_ARTIFACT_URL_TTL_SECONDS = 15 * 60;

type McpArtifactPayload = {
  kind: 'history' | 'graph';
  id: number;
};

type ResolvedMcpArtifact = {
  payload: McpArtifactPayload;
  absolutePath: string;
  fileName: string;
  mimeType: string;
  historyId?: number;
  queueJobId?: number | null;
  executionId?: number;
};

export type McpArtifactDescriptor = {
  artifact_id: string;
  history_id?: number;
  queue_job_id?: number | null;
  execution_id?: number;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  download_url: string;
  expires_at: string;
};

function sign(value: string): string {
  return crypto.createHmac('sha256', mcpHttpSettingsService.getSigningSecret()).update(value).digest('base64url');
}

function encodeArtifactId(payload: McpArtifactPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${MCP_ARTIFACT_PREFIX}${encoded}.${sign(encoded)}`;
}

function decodeArtifactId(artifactId: string): McpArtifactPayload | null {
  if (!artifactId.startsWith(MCP_ARTIFACT_PREFIX)) {
    return null;
  }

  const signedValue = artifactId.slice(MCP_ARTIFACT_PREFIX.length);
  const separatorIndex = signedValue.lastIndexOf('.');
  if (separatorIndex <= 0) {
    return null;
  }

  const encoded = signedValue.slice(0, separatorIndex);
  const signature = signedValue.slice(separatorIndex + 1);
  const expected = sign(encoded);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<McpArtifactPayload>;
    if ((parsed.kind !== 'history' && parsed.kind !== 'graph') || !Number.isInteger(parsed.id) || Number(parsed.id) <= 0) {
      return null;
    }
    return { kind: parsed.kind, id: Number(parsed.id) };
  } catch {
    return null;
  }
}

function resolveHistoryArtifact(historyId: number): ResolvedMcpArtifact | null {
  const history = HistoryQueryRepository.findByIdWithMetadata(historyId);
  const compositeHash = history?.actual_composite_hash ?? history?.composite_hash;
  if (!history || history.generation_status !== 'completed' || !compositeHash) {
    return null;
  }

  const absolutePath = ImageUploadService.getActiveFilePath(compositeHash);
  if (!absolutePath || !fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    return null;
  }

  return {
    payload: { kind: 'history', id: historyId },
    absolutePath,
    fileName: path.basename(absolutePath),
    mimeType: history.actual_mime_type || FileDiscoveryService.getMimeType(absolutePath),
    historyId,
    queueJobId: history.queue_job_id ?? null,
  };
}

function resolveGraphArtifact(artifactId: number): ResolvedMcpArtifact | null {
  const artifact = GraphExecutionArtifactModel.findByIds([artifactId])[0];
  if (!artifact?.storage_path) {
    return null;
  }

  const absolutePath = path.resolve(artifact.storage_path);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    return null;
  }

  return {
    payload: { kind: 'graph', id: artifactId },
    absolutePath,
    fileName: path.basename(absolutePath),
    mimeType: FileDiscoveryService.getMimeType(absolutePath),
    executionId: artifact.execution_id,
  };
}

async function sha256File(absolutePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(absolutePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export class McpArtifactService {
  static resolve(artifactId: string): ResolvedMcpArtifact | null {
    const payload = decodeArtifactId(artifactId);
    if (!payload) {
      return null;
    }
    return payload.kind === 'history' ? resolveHistoryArtifact(payload.id) : resolveGraphArtifact(payload.id);
  }

  static verifyDownloadToken(artifactId: string, expiresValue: unknown, token: unknown): boolean {
    const expires = typeof expiresValue === 'string' ? Number(expiresValue) : NaN;
    if (!Number.isInteger(expires) || expires <= Math.floor(Date.now() / 1000) || typeof token !== 'string') {
      return false;
    }
    const expected = sign(`${artifactId}:${expires}`);
    return token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  }

  static async createHistoryDescriptor(historyId: number, baseUrl: string): Promise<McpArtifactDescriptor | null> {
    const artifact = resolveHistoryArtifact(historyId);
    return artifact ? this.createDescriptor(artifact, baseUrl) : null;
  }

  static async createGraphDescriptor(artifactId: number, baseUrl: string): Promise<McpArtifactDescriptor | null> {
    const artifact = resolveGraphArtifact(artifactId);
    return artifact ? this.createDescriptor(artifact, baseUrl) : null;
  }

  private static async createDescriptor(artifact: ResolvedMcpArtifact, baseUrl: string): Promise<McpArtifactDescriptor> {
    const artifactId = encodeArtifactId(artifact.payload);
    const expires = Math.floor(Date.now() / 1000) + DEFAULT_ARTIFACT_URL_TTL_SECONDS;
    const token = sign(`${artifactId}:${expires}`);
    const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
    const stats = fs.statSync(artifact.absolutePath);
    return {
      artifact_id: artifactId,
      ...(artifact.historyId ? { history_id: artifact.historyId } : {}),
      ...(artifact.queueJobId !== undefined ? { queue_job_id: artifact.queueJobId } : {}),
      ...(artifact.executionId ? { execution_id: artifact.executionId } : {}),
      file_name: artifact.fileName,
      mime_type: artifact.mimeType,
      size_bytes: stats.size,
      sha256: await sha256File(artifact.absolutePath),
      download_url: `${normalizedBaseUrl}/mcp/artifacts/${encodeURIComponent(artifactId)}?expires=${expires}&token=${encodeURIComponent(token)}`,
      expires_at: new Date(expires * 1000).toISOString(),
    };
  }
}
