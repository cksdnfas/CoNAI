import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { GraphExecutionArtifactModel } from '../models/GraphExecutionArtifact';
import { HistoryQueryRepository } from '../repositories/history/HistoryQueryRepository';
import { FileDiscoveryService } from './folderScan/fileDiscoveryService';
import { ImageUploadService } from './imageUploadService';
import { mcpHttpSettingsService } from './mcpHttpSettingsService';
import type { McpRequester } from '../mcp/context';
import { requireRequesterImagePermission } from '../middleware/imageAccess';
import { requireMcpResourceOwner } from '../mcp/toolAccess';
import { canAccessSpriteWorkspace, getSpriteWorkspace } from './sprite/spriteCache';
import { audioCandidateFile } from './audio/audioService';
import { AUDIO_MIME_BY_EXTENSION, audioBlobPath } from './audio/audioStore';
import { audioExportMimeType, audioExportResultFile, canAccessAudioExport, getAudioExportWorkspace } from './audio/audioExport';
import { requireRequesterPermission } from '../middleware/featureAccess';
import { MediaMetadataModel } from '../models/Image/MediaMetadataModel';
import { ImageSafetyService } from './imageSafetyService';
import { MediaPostprocessVisibilityService } from './mediaPostprocessVisibilityService';
import { findLibraryMedia } from './sprite/spriteLibrary';

const MCP_ARTIFACT_PREFIX = 'mcp_artifact_';
const DEFAULT_ARTIFACT_URL_TTL_SECONDS = 15 * 60;

type McpArtifactPayload =
  | { kind: 'history' | 'graph'; id: number }
  /** A file inside a temporary sprite workspace (frames ZIP); expires with the workspace. */
  | { kind: 'sprite-frames'; id: string; file: string }
  /** One audio workspace candidate's stored file. */
  | { kind: 'audio'; id: string }
  /** The result of an audio export (single file or ZIP); expires with its export workspace. */
  | { kind: 'audio-export'; id: string }
  /** A library media item's original file, by composite hash (saved sprite sheets, animations, any image or video). */
  | { kind: 'media'; id: string };

const SPRITE_WORKSPACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SPRITE_FILE_NAME = /^[^\\/:*?"<>|]{1,120}\.zip$/;
const MEDIA_HASH = /^(?:[0-9a-f]{48}|[0-9a-f]{32})$/;

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
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as { kind?: string; id?: unknown; file?: unknown };
    if (parsed.kind === 'sprite-frames') {
      return typeof parsed.id === 'string' && SPRITE_WORKSPACE_ID.test(parsed.id) && typeof parsed.file === 'string' && SPRITE_FILE_NAME.test(parsed.file)
        ? { kind: 'sprite-frames', id: parsed.id, file: parsed.file }
        : null;
    }
    if (parsed.kind === 'media') {
      return typeof parsed.id === 'string' && MEDIA_HASH.test(parsed.id) ? { kind: 'media', id: parsed.id } : null;
    }
    if (parsed.kind === 'audio' || parsed.kind === 'audio-export') {
      return typeof parsed.id === 'string' && SPRITE_WORKSPACE_ID.test(parsed.id) ? { kind: parsed.kind, id: parsed.id } : null;
    }
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

function resolveSpriteFramesArtifact(workspaceId: string, file: string): ResolvedMcpArtifact | null {
  const workspace = getSpriteWorkspace(workspaceId);
  if (!workspace || !SPRITE_FILE_NAME.test(file)) return null;
  const absolutePath = path.join(workspace.dir, file);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) return null;
  return { payload: { kind: 'sprite-frames', id: workspaceId, file }, absolutePath, fileName: file, mimeType: 'application/zip' };
}

function resolveAudioArtifact(candidateId: string): ResolvedMcpArtifact | null {
  try {
    const { candidate, file } = audioCandidateFile(candidateId);
    if (candidate.deleted_at) return null;
    const absolutePath = audioBlobPath(file.hash, file.ext);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) return null;
    // eslint-disable-next-line no-control-regex
    const fileName = `${candidate.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')}.${file.ext}`;
    return { payload: { kind: 'audio', id: candidate.id }, absolutePath, fileName, mimeType: AUDIO_MIME_BY_EXTENSION[file.ext] ?? 'application/octet-stream' };
  } catch {
    return null;
  }
}

function resolveAudioExportArtifact(exportId: string): ResolvedMcpArtifact | null {
  const workspace = getAudioExportWorkspace(exportId);
  const file = workspace ? audioExportResultFile(workspace) : null;
  if (!file) return null;
  return { payload: { kind: 'audio-export', id: exportId }, absolutePath: file.path, fileName: file.fileName, mimeType: audioExportMimeType(file.fileName) };
}

/** Only media the library would show: processed, not hidden by the safety filter, its file still on disk. */
function resolveMediaArtifact(compositeHash: string): ResolvedMcpArtifact | null {
  if (!MEDIA_HASH.test(compositeHash)) return null;
  const metadata = MediaMetadataModel.findByHash(compositeHash);
  if (!metadata || !MediaPostprocessVisibilityService.isReadyRecord(metadata) || ImageSafetyService.isHidden(metadata.rating_score)) return null;
  const media = findLibraryMedia(compositeHash);
  if (!media || !fs.statSync(media.filePath).isFile()) return null;
  return { payload: { kind: 'media', id: compositeHash }, absolutePath: media.filePath, fileName: media.name, mimeType: media.mimeType || FileDiscoveryService.getMimeType(media.filePath) };
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
  /** Verify the stable identity before account authorization, without touching its host file. */
  static identity(artifactId: string): McpArtifactPayload | null {
    return decodeArtifactId(artifactId);
  }
  static resolve(artifactId: string): ResolvedMcpArtifact | null {
    const payload = decodeArtifactId(artifactId);
    if (!payload) {
      return null;
    }
    if (payload.kind === 'sprite-frames') return resolveSpriteFramesArtifact(payload.id, payload.file);
    if (payload.kind === 'audio') return resolveAudioArtifact(payload.id);
    if (payload.kind === 'audio-export') return resolveAudioExportArtifact(payload.id);
    if (payload.kind === 'media') return resolveMediaArtifact(payload.id);
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

  static async createHistoryDescriptor(historyId: number, baseUrl: string, requester?: McpRequester): Promise<McpArtifactDescriptor | null> {
    if (requester) {
      requireRequesterImagePermission(requester);
      requireMcpResourceOwner({ scopes: [], requester }, HistoryQueryRepository.findAllWithMetadata({ ids: [historyId], limit: 1 })[0], true);
    }
    const artifact = resolveHistoryArtifact(historyId);
    if (!artifact) return null;
    const descriptor = await this.createDescriptor(artifact, baseUrl);
    return requester ? { ...descriptor, download_url: `${baseUrl.replace(/\/$/, '')}/api/generation-history/${historyId}/file` } : descriptor;
  }

  static async createGraphDescriptor(artifactId: number, baseUrl: string): Promise<McpArtifactDescriptor | null> {
    const artifact = resolveGraphArtifact(artifactId);
    return artifact ? this.createDescriptor(artifact, baseUrl) : null;
  }

  /**
   * A frames ZIP built in a sprite workspace. Account-bound callers get the session download route for this file (the workspace
   * owner is checked there and here); key callers get the signed `/mcp/artifacts` URL.
   */
  static async createSpriteFramesDescriptor(workspaceId: string, file: string, baseUrl: string, requester?: McpRequester): Promise<McpArtifactDescriptor | null> {
    const artifact = resolveSpriteFramesArtifact(workspaceId, file);
    if (!artifact) return null;
    if (requester) {
      const owner = getSpriteWorkspace(workspaceId)?.owner;
      if (!owner || !canAccessSpriteWorkspace(owner, requester)) {
        throw new Error('Resource is not accessible to this account.');
      }
    }
    const descriptor = await this.createDescriptor(artifact, baseUrl);
    return requester ? { ...descriptor, download_url: `${baseUrl.replace(/\/$/, '')}/api/sprite/results/${workspaceId}/download?file=${encodeURIComponent(file)}` } : descriptor;
  }

  /**
   * One audio candidate's file. Account-bound callers need audio.view and get the session file route; key callers get
   * the signed `/mcp/artifacts` URL.
   */
  static async createAudioDescriptor(candidateId: string, baseUrl: string, requester?: McpRequester): Promise<McpArtifactDescriptor | null> {
    if (requester) requireRequesterPermission(requester, 'audio.view');
    const artifact = resolveAudioArtifact(candidateId);
    if (!artifact) return null;
    const descriptor = await this.createDescriptor(artifact, baseUrl);
    return requester ? { ...descriptor, download_url: `${baseUrl.replace(/\/$/, '')}/api/audio/candidates/${candidateId}/file?download=1` } : descriptor;
  }

  /** An export result: only its starter (or an admin) may fetch it. */
  static async createAudioExportDescriptor(exportId: string, baseUrl: string, requester?: McpRequester): Promise<McpArtifactDescriptor | null> {
    const artifact = resolveAudioExportArtifact(exportId);
    if (!artifact) return null;
    if (requester) {
      requireRequesterPermission(requester, 'audio.view');
      const owner = getAudioExportWorkspace(exportId)?.owner;
      if (!owner || !canAccessAudioExport(owner, requester)) throw new Error('Resource is not accessible to this account.');
    }
    const descriptor = await this.createDescriptor(artifact, baseUrl);
    return requester ? { ...descriptor, download_url: `${baseUrl.replace(/\/$/, '')}/api/audio/exports/${exportId}/download` } : descriptor;
  }

  /**
   * A library media item's original file (a saved sprite sheet, say). Account-bound callers need images.view and get
   * the session original-download route; key callers get the signed `/mcp/artifacts` URL.
   */
  static async createMediaDescriptor(compositeHash: string, baseUrl: string, requester?: McpRequester): Promise<McpArtifactDescriptor | null> {
    if (requester) requireRequesterImagePermission(requester);
    const artifact = resolveMediaArtifact(compositeHash);
    if (!artifact) return null;
    const descriptor = await this.createDescriptor(artifact, baseUrl);
    return requester ? { ...descriptor, download_url: `${baseUrl.replace(/\/$/, '')}/api/images/${compositeHash}/download/original` } : descriptor;
  }

  /** Resolve a stable artifact ID and issue a fresh short-lived download URL. */
  static async refreshDescriptor(artifactId: string, baseUrl: string, requester?: McpRequester): Promise<McpArtifactDescriptor | null> {
    if (requester) {
      const identity = decodeArtifactId(artifactId);
      if (identity?.kind === 'sprite-frames') return this.createSpriteFramesDescriptor(identity.id, identity.file, baseUrl, requester);
      if (identity?.kind === 'audio') return this.createAudioDescriptor(identity.id, baseUrl, requester);
      if (identity?.kind === 'audio-export') return this.createAudioExportDescriptor(identity.id, baseUrl, requester);
      if (identity?.kind === 'media') return this.createMediaDescriptor(identity.id, baseUrl, requester);
      return identity?.kind === 'history' ? this.createHistoryDescriptor(identity.id, baseUrl, requester) : null;
    }
    const artifact = this.resolve(artifactId);
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
