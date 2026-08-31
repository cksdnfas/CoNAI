import type { NextFunction, Request, Response } from 'express';

export const MCP_DECODED_MEDIA_LIMIT_BYTES = 50 * 1024 * 1024;
export const MCP_HTTP_JSON_LIMIT_MB = 70;

const FORBIDDEN_PATH_KEYS = new Set([
  'file_path',
  'filepath',
  'original_path',
  'originalpath',
  'original_file_path',
  'storage_path',
  'storagepath',
  'path',
]);

class McpRequestValidationError extends Error {
  constructor(message: string, readonly statusCode: number, readonly rpcCode: number) {
    super(message);
  }
}

function decodeBase64Payload(payload: string): Buffer {
  const compact = payload.replace(/\s/g, '');
  if (!compact || compact.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new McpRequestValidationError('Invalid base64 media data.', 400, -32602);
  }

  const normalized = compact.padEnd(compact.length + ((4 - (compact.length % 4)) % 4), '=');
  const decoded = Buffer.from(normalized, 'base64');
  if (decoded.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')) {
    throw new McpRequestValidationError('Invalid base64 media data.', 400, -32602);
  }
  return decoded;
}

function detectMediaFamilies(data: Buffer): Set<'image' | 'video' | 'audio'> {
  const families = new Set<'image' | 'video' | 'audio'>();
  const ascii = (start: number, end: number) => data.subarray(start, end).toString('ascii');
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      || (data[0] === 0xff && data[1] === 0xd8)
      || ascii(0, 3) === 'GIF'
      || ascii(0, 2) === 'BM'
      || (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP')) {
    families.add('image');
  }
  if (data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) families.add('video');
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 16).toLowerCase();
    if (brand.includes('avif') || brand.includes('heic') || brand.includes('heif')) families.add('image');
    else if (brand.includes('m4a')) families.add('audio');
    else families.add('video');
  }
  if ((ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE')
      || ascii(0, 3) === 'ID3'
      || ascii(0, 4) === 'OggS'
      || ascii(0, 4) === 'fLaC'
      || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0)) {
    families.add('audio');
  }
  return families;
}

function inspectValue(value: unknown, state: { decodedBytes: number }): void {
  if (typeof value === 'string') {
    if (!value.startsWith('data:')) {
      return;
    }

    const match = /^data:([^;,]+);base64,([\s\S]*)$/i.exec(value);
    if (!match) {
      throw new McpRequestValidationError('Media inputs must use base64 data URLs.', 400, -32602);
    }

    const mimeType = match[1].trim().toLowerCase();
    if (!/^(image|video|audio)\/[a-z0-9.+-]+$/.test(mimeType)) {
      throw new McpRequestValidationError(`Unsupported MCP media MIME type: ${mimeType}`, 400, -32602);
    }

    const decoded = decodeBase64Payload(match[2]);
    const declaredFamily = mimeType.split('/')[0] as 'image' | 'video' | 'audio';
    if (!detectMediaFamilies(decoded).has(declaredFamily)) {
      throw new McpRequestValidationError(`Media bytes do not match declared MIME type: ${mimeType}`, 400, -32602);
    }
    state.decodedBytes += decoded.length;
    if (state.decodedBytes > MCP_DECODED_MEDIA_LIMIT_BYTES) {
      throw new McpRequestValidationError('MCP media payload exceeds the 50 MiB limit.', 413, -32003);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => inspectValue(item, state));
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_PATH_KEYS.has(key.toLowerCase())) {
      throw new McpRequestValidationError(
        `MCP file path input is not allowed (${key}). Use data_url or composite_hash.`,
        400,
        -32602,
      );
    }
    inspectValue(child, state);
  }
}

/** Validate decoded media totals and reject client-supplied server filesystem paths. */
export function validateMcpRequestBody(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'POST') {
    next();
    return;
  }

  try {
    inspectValue(req.body, { decodedBytes: 0 });
    next();
  } catch (error) {
    const validationError = error instanceof McpRequestValidationError
      ? error
      : new McpRequestValidationError('Invalid MCP request body.', 400, -32602);
    res.status(validationError.statusCode).json({
      jsonrpc: '2.0',
      error: { code: validationError.rpcCode, message: validationError.message },
      id: req.body?.id ?? null,
    });
  }
}
