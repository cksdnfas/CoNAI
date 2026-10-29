import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { runtimePaths } from '../../config/runtimePaths';
import type { ComfyUIHistoryResponse, ComfyUIOutputFile } from '../../types/workflow';

export type ComfyOutputKind = 'image' | 'animated' | 'video' | 'audio';

export type CollectedComfyOutput = ComfyUIOutputFile & {
  nodeId: string;
  kind: ComfyOutputKind;
};

export type ModalComfyFile = {
  node_id?: string;
  filename?: string;
  subfolder?: string;
  type?: string;
  data_base64?: string;
  format?: string;
};

export type ModalComfyGenerateResponse = {
  images?: ModalComfyFile[];
  videos?: ModalComfyFile[];
  error?: string;
};

function resolveOutputKind(bucket: 'images' | 'gifs' | 'videos' | 'files', file: ComfyUIOutputFile): ComfyOutputKind {
  if (bucket === 'videos') {
    return 'video';
  }

  const normalizedFormat = (file.format || '').toLowerCase();
  const extension = path.extname(file.filename).toLowerCase();

  if (normalizedFormat.startsWith('video/') || ['.mp4', '.webm', '.mov', '.mkv', '.avi'].includes(extension)) {
    return 'video';
  }

  if (bucket === 'gifs' || ['.gif', '.webp'].includes(extension)) {
    return 'animated';
  }

  return 'image';
}

function parseNodeOrder(nodeId: string): number {
  const match = nodeId.match(/^\d+/);
  return match ? Number(match[0]) : -1;
}

/** Collapse duplicate ComfyUI buckets that point at the same physical output file. */
function deduplicateComfyOutputs(outputs: CollectedComfyOutput[]): CollectedComfyOutput[] {
  const seen = new Set<string>();
  return outputs.filter((output) => {
    const normalizedLocation = path.posix.normalize(
      `${String(output.type || 'output').replace(/\\/g, '/')}/${String(output.subfolder || '').replace(/\\/g, '/')}/${String(output.filename || '').replace(/\\/g, '/')}`,
    );
    if (seen.has(normalizedLocation)) {
      return false;
    }
    seen.add(normalizedLocation);
    return true;
  });
}

export function extractComfyOutputInfo(
  history: ComfyUIHistoryResponse,
  promptId: string,
  onlyFinalOutput: boolean = true
): CollectedComfyOutput[] {
  const item = history[promptId];
  if (!item || !item.outputs) {
    return [];
  }

  const allOutputs: CollectedComfyOutput[] = [];

  for (const nodeId in item.outputs) {
    const output = item.outputs[nodeId];
    const buckets: Array<'images' | 'gifs' | 'videos' | 'files'> = ['images', 'gifs', 'videos', 'files'];

    for (const bucket of buckets) {
      const files = output[bucket];
      if (!Array.isArray(files)) {
        continue;
      }

      files.forEach((file) => {
        // Audio files in `files` (CoNAIArtifactFileOutput) are collected with the audio outputs below.
        if (bucket === 'files' && isAudioFile(file)) {
          return;
        }
        allOutputs.push({
          ...file,
          nodeId,
          kind: resolveOutputKind(bucket, file),
        });
      });
    }
  }

  // Sounds never take part in the final-node pick: a graph saving an image and a sound keeps both.
  const audioOutputs = extractComfyAudioOutputs(history, promptId);

  if (onlyFinalOutput && allOutputs.length > 0) {
    const maxNodeOrder = Math.max(...allOutputs.map((file) => parseNodeOrder(file.nodeId)));
    const finalOutputs = allOutputs.filter((file) => parseNodeOrder(file.nodeId) === maxNodeOrder);
    const uniqueFinalOutputs = deduplicateComfyOutputs(finalOutputs);

    console.log(`📦 Found ${allOutputs.length} outputs, returning ${uniqueFinalOutputs.length} unique final output(s) from node #${maxNodeOrder}${audioOutputs.length ? ` + ${audioOutputs.length} audio` : ''}`);
    return [...uniqueFinalOutputs, ...audioOutputs];
  }

  const uniqueOutputs = deduplicateComfyOutputs(allOutputs);
  console.log(`📦 Found ${allOutputs.length} outputs, returning ${uniqueOutputs.length} unique output(s)${audioOutputs.length ? ` + ${audioOutputs.length} audio` : ''}`);
  return [...uniqueOutputs, ...audioOutputs];
}

const AUDIO_OUTPUT_EXTENSIONS = new Set(['.flac', '.wav', '.mp3', '.ogg', '.opus', '.m4a', '.aac', '.weba']);

function isAudioFile(file: ComfyUIOutputFile): boolean {
  const format = (file.format || '').toLowerCase();
  return format.startsWith('audio/') || AUDIO_OUTPUT_EXTENSIONS.has(path.extname(file.filename || '').toLowerCase());
}

/**
 * Audio outputs of one prompt: SaveAudio* nodes report them in an `audio` bucket, and CoNAIArtifactFileOutput in
 * `files`. Every audio output of every node is returned (an audio graph rarely has more than one save node);
 * image/video outputs are ignored. Audio orders read only these; `extractComfyOutputInfo` appends them after the
 * image/video outputs.
 */
export function extractComfyAudioOutputs(history: ComfyUIHistoryResponse, promptId: string): CollectedComfyOutput[] {
  const item = history[promptId];
  if (!item || !item.outputs) {
    return [];
  }

  const outputs: CollectedComfyOutput[] = [];
  const nodeIds = Object.keys(item.outputs).sort((left, right) => parseNodeOrder(left) - parseNodeOrder(right) || left.localeCompare(right));
  for (const nodeId of nodeIds) {
    const output = item.outputs[nodeId];
    for (const bucket of ['audio', 'files'] as const) {
      const files = output[bucket];
      if (!Array.isArray(files)) continue;
      for (const file of files) {
        if (bucket === 'audio' || isAudioFile(file)) outputs.push({ ...file, nodeId, kind: 'audio' });
      }
    }
  }
  return deduplicateComfyOutputs(outputs);
}

export async function writeModalOutputToTemp(file: ModalComfyFile, fallbackName: string, kind: ComfyOutputKind, signal?: AbortSignal): Promise<CollectedComfyOutput & { tempPath: string }> {
  const encoded = typeof file.data_base64 === 'string' ? file.data_base64 : '';
  if (!encoded) {
    throw new Error(`Modal ComfyUI output ${file.filename ?? fallbackName} did not include data_base64`);
  }

  const filename = path.basename(file.filename || fallbackName);
  const ext = path.extname(filename) || (kind === 'video' ? '.mp4' : '.png');
  const tempFilePath = path.join(runtimePaths.tempDir, `modal_comfyui_${randomUUID()}${ext}`);
  await fs.promises.mkdir(runtimePaths.tempDir, { recursive: true });
  const handle = await fs.promises.open(tempFilePath, 'wx');
  // Decode bounded chunks, keeping incomplete base64 groups between reads.
  async function* decoded() {
    let remainder = '';
    for (let offset = 0; offset < encoded.length; offset += 64 * 1024) {
      signal?.throwIfAborted();
      const part = remainder + encoded.slice(offset, offset + 64 * 1024).replace(/[^A-Za-z0-9+/_=-]/g, '');
      const padding = part.indexOf('=');
      if (padding !== -1) {
        yield Buffer.from(part.slice(0, padding), 'base64');
        return;
      }
      const end = part.length - part.length % 4;
      if (end) yield Buffer.from(part.slice(0, end), 'base64');
      remainder = part.slice(end);
    }
    if (remainder) yield Buffer.from(remainder, 'base64');
  }
  try {
    await pipeline(Readable.from(decoded()), handle.createWriteStream(), { signal });
  } catch (error) {
    try { await fs.promises.rm(tempFilePath, { force: true }); }
    catch (cleanupError) {
      console.warn(`⚠️ Failed to remove temp Modal ComfyUI output ${tempFilePath}:`, cleanupError);
      if (error && typeof error === 'object') Object.assign(error, { cleanupError });
    }
    throw error;
  }

  return {
    filename,
    subfolder: typeof file.subfolder === 'string' ? file.subfolder : '',
    type: typeof file.type === 'string' && file.type.trim().length > 0 ? file.type : 'output',
    format: file.format,
    nodeId: String(file.node_id ?? 'modal'),
    kind,
    tempPath: tempFilePath,
  };
}
