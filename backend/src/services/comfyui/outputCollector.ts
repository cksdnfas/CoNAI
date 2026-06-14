import * as fs from 'fs';
import * as path from 'path';
import { runtimePaths } from '../../config/runtimePaths';
import type { ComfyUIHistoryResponse, ComfyUIOutputFile } from '../../types/workflow';

export type ComfyOutputKind = 'image' | 'animated' | 'video';

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
        allOutputs.push({
          ...file,
          nodeId,
          kind: resolveOutputKind(bucket, file),
        });
      });
    }
  }

  if (onlyFinalOutput && allOutputs.length > 0) {
    const maxNodeOrder = Math.max(...allOutputs.map((file) => parseNodeOrder(file.nodeId)));
    const finalOutputs = allOutputs.filter((file) => parseNodeOrder(file.nodeId) === maxNodeOrder);

    console.log(`📦 Found ${allOutputs.length} outputs, returning ${finalOutputs.length} final output(s) from node #${maxNodeOrder}`);
    return finalOutputs;
  }

  console.log(`📦 Found ${allOutputs.length} outputs, returning all`);
  return allOutputs;
}

export function writeModalOutputToTemp(file: ModalComfyFile, fallbackName: string, kind: ComfyOutputKind): CollectedComfyOutput & { tempPath: string } {
  const encoded = typeof file.data_base64 === 'string' ? file.data_base64 : '';
  if (!encoded) {
    throw new Error(`Modal ComfyUI output ${file.filename ?? fallbackName} did not include data_base64`);
  }

  const filename = path.basename(file.filename || fallbackName);
  const tempDir = runtimePaths.tempDir;
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const ext = path.extname(filename) || (kind === 'video' ? '.mp4' : '.png');
  const tempFilePath = path.join(tempDir, `modal_comfyui_${Date.now()}_${Math.random().toString(36).slice(2, 9)}${ext}`);
  fs.writeFileSync(tempFilePath, Buffer.from(encoded, 'base64'));

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
