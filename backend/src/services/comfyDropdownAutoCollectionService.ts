import axios from 'axios';
import { ComfyUIServerModel } from '../models/ComfyUIServer';
import { CustomDropdownListModel } from '../models/CustomDropdownList';

export const DEFAULT_COMFY_MODEL_API_PATHS = [
  '/models/checkpoints',
  '/models/diffusion_models',
  '/models/unet_gguf',
  '/models/loras',
];

const MODEL_FILE_EXTENSIONS = ['.safetensors', '.ckpt', '.pt', '.pth', '.bin', '.gguf', '.onnx'];
export const AUTO_COLLECT_SOURCE_PATH = 'comfyui-default-server-api';

type ApiModelFileBatch = {
  apiPath: string;
  rootFolder: string;
  files: string[];
};

export type ComfyUIModelFolderScanInput = {
  folderName: string;
  displayName: string;
  files: string[];
};

export type ComfyDropdownApiCollectResult = {
  scannedFolders: number;
  createdLists: number;
  deletedLists: number;
  apiPaths: string[];
  failedPaths: Array<{ apiPath: string; error: string }>;
  sourcePath: string;
};

export class ComfyDropdownApiCollectError extends Error {
  constructor(message: string, readonly result: ComfyDropdownApiCollectResult) {
    super(message);
  }
}

function decodeUnicodeEscapeSequences(value: string) {
  let decoded = value;

  for (let index = 0; index < 4; index++) {
    const next = decoded.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
    if (next === decoded) {
      break;
    }
    decoded = next;
  }

  return decoded.normalize('NFC');
}

/** Normalize ComfyUI model option paths from API JSON, including double-escaped Korean names. */
export function normalizeComfyModelOptionPath(value: string) {
  return decodeUnicodeEscapeSequences(value)
    .replace(/[\\/]+/g, '\\')
    .replace(/^\\+/, '')
    .trim();
}

function hasKnownModelExtension(value: string) {
  const lowerValue = value.toLowerCase();
  return MODEL_FILE_EXTENSIONS.some((extension) => lowerValue.endsWith(extension));
}

function normalizeApiPath(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    return `${parsed.pathname}${parsed.search}` || null;
  } catch {
    const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return withLeadingSlash.replace(/\/{2,}/g, '/');
  }
}

/** Parse user-entered API paths and fall back to the built-in ComfyUI model defaults. */
export function normalizeComfyModelApiPaths(value: unknown) {
  const rawPaths = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\r?\n|,/)
      : [];

  const normalizedPaths = Array.from(new Set(rawPaths
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => normalizeApiPath(entry))
    .filter((entry): entry is string => Boolean(entry))));

  return normalizedPaths.length > 0 ? normalizedPaths : [...DEFAULT_COMFY_MODEL_API_PATHS];
}

function getRootFolderFromApiPath(apiPath: string) {
  const pathname = apiPath.split('?')[0] ?? apiPath;
  const segments = pathname.split('/').map((part) => part.trim()).filter(Boolean);
  return segments[segments.length - 1] ?? 'models';
}

function collectModelFileNames(value: unknown, results: string[] = []) {
  if (typeof value === 'string') {
    results.push(value);
    return results;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectModelFileNames(entry, results);
    }
    return results;
  }

  if (!value || typeof value !== 'object') {
    return results;
  }

  const record = value as Record<string, unknown>;
  for (const key of ['name', 'filename', 'path', 'model', 'value']) {
    const maybeFileName = record[key];
    if (typeof maybeFileName === 'string') {
      results.push(maybeFileName);
      return results;
    }
  }

  for (const entry of Object.values(record)) {
    collectModelFileNames(entry, results);
  }

  return results;
}

async function fetchDefaultServerModelFiles(apiPath: string): Promise<ApiModelFileBatch> {
  const server = ComfyUIServerModel.findDefaultActive() ?? ComfyUIServerModel.findDefault();
  if (!server) {
    throw new Error('대표 ComfyUI 서버가 설정되어 있지 않습니다.');
  }

  const response = await axios.get(apiPath, {
    baseURL: server.endpoint,
    timeout: 120_000,
    headers: {
      Accept: 'application/json',
    },
  });

  const files = collectModelFileNames(response.data)
    .map((entry) => normalizeComfyModelOptionPath(entry))
    .filter((entry) => entry.length > 0 && hasKnownModelExtension(entry));

  return {
    apiPath,
    rootFolder: getRootFolderFromApiPath(apiPath),
    files: Array.from(new Set(files)).sort(),
  };
}

function getModelFolderDisplayName(rootFolder: string, modelOptionPath: string) {
  const parts = modelOptionPath.split('\\').filter(Boolean);
  const subfolderParts = parts.slice(0, -1);
  return subfolderParts.length > 0 ? `${rootFolder}/${subfolderParts.join('/')}` : rootFolder;
}

/** Build per-folder lists from API-returned model names while preserving ComfyUI option values. */
export function buildComfyModelFoldersFromApiBatches(batches: Pick<ApiModelFileBatch, 'rootFolder' | 'files'>[]) {
  const folderMap = new Map<string, ComfyUIModelFolderScanInput>();
  const fileSetByFolder = new Map<string, Set<string>>();

  for (const batch of batches) {
    for (const file of batch.files) {
      const modelOptionPath = normalizeComfyModelOptionPath(file);
      if (!hasKnownModelExtension(modelOptionPath)) {
        continue;
      }

      const displayName = getModelFolderDisplayName(batch.rootFolder, modelOptionPath);
      const folder = folderMap.get(displayName) ?? {
        folderName: batch.rootFolder,
        displayName,
        files: [],
      };
      let fileSet = fileSetByFolder.get(displayName);
      if (!fileSet) {
        fileSet = new Set(folder.files);
        fileSetByFolder.set(displayName, fileSet);
      }

      if (!fileSet.has(modelOptionPath)) {
        fileSet.add(modelOptionPath);
        folder.files.push(modelOptionPath);
      }
      folderMap.set(displayName, folder);
    }
  }

  return Array.from(folderMap.values())
    .map((folder) => ({
      ...folder,
      files: [...folder.files].sort(),
    }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function buildMergedComfyDropdownListName(rootFolder: string) {
  return `${rootFolder} (통합)`;
}

function buildAutoCollectedDropdownLists(modelFolders: ComfyUIModelFolderScanInput[], sourcePath: string) {
  const rootFolderMap = new Map<string, Set<string>>();
  const lists: Array<{ name: string; description: string; items: string[]; is_auto_collected: 1; source_path: string }> = [];

  for (const folder of modelFolders) {
    let rootFiles = rootFolderMap.get(folder.folderName);
    if (!rootFiles) {
      rootFiles = new Set<string>();
      rootFolderMap.set(folder.folderName, rootFiles);
    }

    for (const file of folder.files) {
      rootFiles.add(normalizeComfyModelOptionPath(file));
    }
  }

  for (const [rootFolder, files] of Array.from(rootFolderMap.entries())) {
    const items = Array.from(files).sort();
    if (items.length === 0) {
      continue;
    }

    lists.push({
      name: buildMergedComfyDropdownListName(rootFolder),
      description: `ComfyUI ${rootFolder} 통합 모델 목록 (자동 수집)`,
      items,
      is_auto_collected: 1,
      source_path: sourcePath,
    });
  }

  for (const folder of modelFolders) {
    if (folder.files.length === 0) {
      continue;
    }

    lists.push({
      name: folder.displayName,
      description: `ComfyUI ${folder.folderName} 모델 목록 (자동 수집)`,
      items: folder.files.map((item) => normalizeComfyModelOptionPath(item)).sort(),
      is_auto_collected: 1,
      source_path: sourcePath,
    });
  }

  return lists;
}

/** Fetch model paths from the representative ComfyUI server and replace generated auto lists. */
export async function collectAndReplaceComfyModelDropdownListsFromDefaultServer(input: { apiPaths?: unknown } = {}): Promise<ComfyDropdownApiCollectResult> {
  const apiPaths = normalizeComfyModelApiPaths(input.apiPaths);
  const outcomes = await Promise.allSettled(apiPaths.map((apiPath) => fetchDefaultServerModelFiles(apiPath)));
  const batches: ApiModelFileBatch[] = [];
  const failedPaths: ComfyDropdownApiCollectResult['failedPaths'] = [];

  for (const [index, outcome] of outcomes.entries()) {
    if (outcome.status === 'fulfilled') {
      batches.push(outcome.value);
    } else {
      failedPaths.push({
        apiPath: apiPaths[index],
        error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      });
    }
  }

  const result: ComfyDropdownApiCollectResult = {
    scannedFolders: batches.length,
    createdLists: 0,
    deletedLists: 0,
    apiPaths,
    failedPaths,
    sourcePath: AUTO_COLLECT_SOURCE_PATH,
  };

  if (batches.length === 0) {
    return result;
  }

  const successfulRoots = Array.from(new Set(batches.map((batch) => batch.rootFolder)));
  const failedRoots = new Set(failedPaths.map((failure) => getRootFolderFromApiPath(failure.apiPath)));

  try {
    const replacement = CustomDropdownListModel.replaceAutoCollectedForRoots(
      successfulRoots,
      (existingLists) => {
        // Old lists identify only a root, so a failed peer of that root requires retaining its previous union.
        const retainedBatches = successfulRoots.filter((rootFolder) => failedRoots.has(rootFolder)).map((rootFolder) => ({
          rootFolder,
          files: existingLists.filter((list) => list.name === rootFolder
            || list.name === buildMergedComfyDropdownListName(rootFolder)
            || list.name.startsWith(`${rootFolder}/`)).flatMap((list) => list.items),
        }));
        const modelFolders = buildComfyModelFoldersFromApiBatches([...batches, ...retainedBatches]);
        return buildAutoCollectedDropdownLists(modelFolders, AUTO_COLLECT_SOURCE_PATH);
      },
    );
    return { ...result, ...replacement };
  } catch (error) {
    throw new ComfyDropdownApiCollectError(error instanceof Error ? error.message : String(error), result);
  }
}
