import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { runtimePaths } from '../config/runtimePaths';
import { ModuleDefinitionModel } from '../models/ModuleDefinition';
import {
  type ModuleDefinitionCreateData,
  type ModuleDefinitionRecord,
  type ModulePortDefinition,
  type ModuleDefinitionUpdateData,
  type ModuleUiFieldDefinition,
} from '../types/moduleGraph';

const CUSTOM_NODE_PORT_DATA_TYPES = ['image', 'mask', 'prompt', 'text', 'number', 'boolean', 'json', 'any'] as const;
const CUSTOM_NODE_UI_DATA_TYPES = [...CUSTOM_NODE_PORT_DATA_TYPES, 'select'] as const;

const customNodePortSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1).optional(),
  data_type: z.enum(CUSTOM_NODE_PORT_DATA_TYPES),
  description: z.string().optional(),
  required: z.boolean().optional(),
  multiple: z.boolean().optional(),
  default_value: z.unknown().optional(),
  ui_hint: z.string().optional(),
  source_path: z.string().optional(),
});

const customNodeUiFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1).optional(),
  data_type: z.enum(CUSTOM_NODE_UI_DATA_TYPES),
  description: z.string().optional(),
  default_value: z.unknown().optional(),
  options: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  placeholder: z.string().optional(),
  ui_hint: z.string().optional(),
});

const customNodeManifestSchema = z.object({
  schemaVersion: z.number().int().positive(),
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().optional(),
  runtime: z.literal('javascript'),
  entry: z.string().min(1).default('index.js'),
  category: z.string().optional(),
  color: z.string().optional(),
  inputs: z.array(customNodePortSchema).default([]),
  outputs: z.array(customNodePortSchema).default([]),
  ui_schema: z.array(customNodeUiFieldSchema).optional(),
});

export type CustomNodeManifest = z.infer<typeof customNodeManifestSchema>;

export type CustomNodeScanError = {
  folderName: string;
  folderPath: string;
  message: string;
};

export type CustomNodeRecord = {
  folderName: string;
  folderPath: string;
  manifestPath: string;
  entryPath: string;
  packageJsonPath: string | null;
  readmePath: string | null;
  sourceHash: string;
  manifest: CustomNodeManifest;
};

export type CustomNodeScanResult = {
  customNodesDir: string;
  nodes: CustomNodeRecord[];
  errors: CustomNodeScanError[];
};

export type CustomNodeSyncResult = CustomNodeScanResult & {
  createdCount: number;
  updatedCount: number;
  deactivatedCount: number;
};

export type CustomNodeScaffoldTemplate = 'empty' | 'hello_world' | 'http_json' | 'image_file';

export type CustomNodeScaffoldInput = {
  folderName: string;
  key: string;
  name: string;
  description?: string;
  category?: string;
  color?: string;
  template?: CustomNodeScaffoldTemplate;
};

export type CustomNodeScaffoldResult = {
  folderPath: string;
  manifestPath: string;
  entryPath: string;
  template: CustomNodeScaffoldTemplate;
  sync: CustomNodeSyncResult;
};

type LoadedCustomNodeManifest = {
  manifestPath: string;
  manifestContent: string;
  manifest: CustomNodeManifest;
};

function buildDisplayLabel(key: string, label?: string): string {
  if (label && label.trim().length > 0) {
    return label.trim();
  }

  return key
    .split(/[_\-.]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Build one default inspector UI schema from manifest input ports. */
function buildUiSchemaFromInputPorts(inputs: CustomNodeManifest['inputs']): ModuleUiFieldDefinition[] {
  return inputs.map((input) => ({
    key: input.key,
    label: buildDisplayLabel(input.key, input.label),
    data_type: input.data_type,
    description: input.description,
    default_value: input.default_value,
    ui_hint: input.ui_hint,
  }));
}

/** Convert one manifest port into a graph module port definition. */
function buildModulePort(port: CustomNodeManifest['inputs'][number], direction: 'input' | 'output'): ModulePortDefinition {
  return {
    key: port.key,
    label: buildDisplayLabel(port.key, port.label),
    direction,
    data_type: port.data_type,
    description: port.description,
    required: port.required,
    multiple: port.multiple,
    default_value: port.default_value,
    ui_hint: port.ui_hint,
    source_path: port.source_path,
  };
}

/** Convert one manifest into module creation data backed by the file system. */
function buildModuleDefinitionCreateData(record: CustomNodeRecord): ModuleDefinitionCreateData {
  const { manifest } = record;
  const exposedInputs = manifest.inputs.map((input) => buildModulePort(input, 'input'));
  const outputPorts = manifest.outputs.map((output) => buildModulePort(output, 'output'));

  return {
    name: manifest.name,
    description: manifest.description,
    engine_type: 'custom_js',
    authoring_source: 'custom_node_fs',
    category: manifest.category ?? 'Custom',
    template_defaults: {
      node_key: manifest.key,
      runtime: manifest.runtime,
      entry: manifest.entry,
      folder_name: record.folderName,
      folder_path: record.folderPath,
      manifest_schema_version: manifest.schemaVersion,
      package_version: manifest.version ?? null,
    },
    exposed_inputs: exposedInputs,
    output_ports: outputPorts,
    ui_schema: manifest.ui_schema?.map((field) => ({
      key: field.key,
      label: buildDisplayLabel(field.key, field.label),
      data_type: field.data_type,
      description: field.description,
      default_value: field.default_value,
      options: field.options,
      min: field.min,
      max: field.max,
      placeholder: field.placeholder,
      ui_hint: field.ui_hint,
    })) ?? buildUiSchemaFromInputPorts(manifest.inputs),
    is_active: true,
    color: manifest.color ?? '#ff8a65',
    external_key: manifest.key,
    source_path: record.folderPath,
    source_hash: record.sourceHash,
  };
}

/** Build one stable hash from manifest JSON and entry file content. */
function buildCustomNodeSourceHash(manifestContent: string, entryContent: string): string {
  return crypto.createHash('sha256').update(manifestContent).update('\n').update(entryContent).digest('hex');
}

/** Read and validate one custom node manifest file from disk. */
async function loadCustomNodeManifest(folderPath: string): Promise<LoadedCustomNodeManifest> {
  const manifestPath = path.join(folderPath, 'node.json');
  const manifestContent = await fs.promises.readFile(manifestPath, 'utf8');

  return {
    manifestPath,
    manifestContent,
    manifest: customNodeManifestSchema.parse(JSON.parse(manifestContent)),
  };
}

/** Resolve one manifest entry path and keep it inside the custom node folder. */
function resolveCustomNodeEntryPath(folderPath: string, entry: string): string {
  if (path.isAbsolute(entry)) {
    throw new Error('Manifest entry must be a relative path');
  }

  const entryPath = path.resolve(folderPath, entry);
  if (!entryPath.startsWith(path.resolve(folderPath))) {
    throw new Error('Manifest entry must stay inside the custom node folder');
  }

  return entryPath;
}

/** Resolve one optional support file path when it already exists on disk. */
function findExistingCustomNodeFilePath(folderPath: string, fileName: string): string | null {
  const filePath = path.join(folderPath, fileName);
  return fs.existsSync(filePath) ? filePath : null;
}

function changedManifestFields(row: ModuleDefinitionRecord, data: ModuleDefinitionCreateData): ModuleDefinitionUpdateData {
  const changes: ModuleDefinitionUpdateData = {};
  if (row.name !== data.name) changes.name = data.name;
  if (row.description !== (data.description || null)) changes.description = data.description || null;
  if (row.category !== data.category) changes.category = data.category;
  if (row.color !== data.color) changes.color = data.color;
  if (row.source_path !== data.source_path) changes.source_path = data.source_path;
  if (row.source_hash !== data.source_hash) changes.source_hash = data.source_hash;
  if (!row.is_active) changes.is_active = true;
  if (row.template_defaults !== JSON.stringify(data.template_defaults)) changes.template_defaults = data.template_defaults;
  // Input ports and their UI fields jointly define which saved input values survive a schema change.
  if (row.exposed_inputs !== JSON.stringify(data.exposed_inputs) || row.ui_schema !== JSON.stringify(data.ui_schema)) {
    changes.exposed_inputs = data.exposed_inputs;
    changes.ui_schema = data.ui_schema;
  }
  if (row.output_ports !== JSON.stringify(data.output_ports)) changes.output_ports = data.output_ports;
  return changes;
}

/** Sync one file-backed custom node into module_definitions and report the outcome. */
function syncCustomNodeModuleRecord(nodeRecord: CustomNodeRecord, errors: CustomNodeScanError[]): 'created' | 'updated' | 'skipped' {
  const createData = buildModuleDefinitionCreateData(nodeRecord);

  try {
    const existingByExternalKey = ModuleDefinitionModel.findByExternalKey(nodeRecord.manifest.key);
    if (existingByExternalKey) {
      if (existingByExternalKey.authoring_source !== 'custom_node_fs') {
        throw new Error(`Module key already exists: ${nodeRecord.manifest.key}`);
      }
      const changes = changedManifestFields(existingByExternalKey, createData);
      const updated = ModuleDefinitionModel.update(existingByExternalKey.id, changes);
      return updated ? 'updated' : 'skipped';
    }

    if (ModuleDefinitionModel.existsByName(createData.name)) {
      errors.push({
        folderName: nodeRecord.folderName,
        folderPath: nodeRecord.folderPath,
        message: `Module name already exists: ${createData.name}`,
      });
      return 'skipped';
    }

    ModuleDefinitionModel.create(createData);
    return 'created';
  } catch (error) {
    errors.push({
      folderName: nodeRecord.folderName,
      folderPath: nodeRecord.folderPath,
      message: error instanceof Error ? error.message : 'Failed to sync custom node module',
    });
    return 'skipped';
  }
}

/** Validate one custom node manifest and resolve its entry file. */
async function loadCustomNodeRecord(folderName: string, folderPath: string): Promise<CustomNodeRecord> {
  const { manifestPath, manifestContent, manifest } = await loadCustomNodeManifest(folderPath);
  const entryPath = resolveCustomNodeEntryPath(folderPath, manifest.entry);
  const entryContent = await fs.promises.readFile(entryPath, 'utf8');

  return {
    folderName,
    folderPath,
    manifestPath,
    entryPath,
    packageJsonPath: findExistingCustomNodeFilePath(folderPath, 'package.json'),
    readmePath: findExistingCustomNodeFilePath(folderPath, 'README.md'),
    sourceHash: buildCustomNodeSourceHash(manifestContent, entryContent),
    manifest,
  };
}

/** Build one starter manifest for a scaffolded custom node package. */
function buildCustomNodeScaffoldManifest(input: CustomNodeScaffoldInput) {
  return {
    schemaVersion: 1,
    key: input.key,
    name: input.name,
    description: input.description ?? '',
    version: '0.1.0',
    runtime: 'javascript' as const,
    entry: 'index.js',
    category: input.category ?? 'Custom',
    color: input.color ?? '#ff8a65',
    inputs: input.template === 'hello_world'
      ? [
          {
            key: 'name',
            label: 'Name',
            data_type: 'text' as const,
            required: false,
            default_value: 'World',
          },
          {
            key: 'prefix',
            label: 'Prefix',
            data_type: 'text' as const,
            required: false,
            default_value: 'Hello',
          },
        ]
      : input.template === 'http_json'
        ? [
            {
              key: 'url',
              label: 'URL',
              data_type: 'text' as const,
              required: true,
              default_value: 'https://example.com/api',
            },
            {
              key: 'method',
              label: 'Method',
              data_type: 'text' as const,
              required: false,
              default_value: 'GET',
            },
          ]
        : input.template === 'image_file'
          ? [
              {
                key: 'file_path',
                label: 'File Path',
                data_type: 'text' as const,
                required: true,
                default_value: './assets/sample.png',
              },
              {
                key: 'status_text',
                label: 'Status Text',
                data_type: 'text' as const,
                required: false,
                default_value: 'Loaded image from file path',
              },
            ]
          : [],
    outputs: input.template === 'hello_world'
      ? [
          {
            key: 'text',
            label: 'Greeting',
            data_type: 'text' as const,
            required: true,
          },
          {
            key: 'payload',
            label: 'Payload',
            data_type: 'json' as const,
          },
        ]
      : input.template === 'http_json'
        ? [
            {
              key: 'response_json',
              label: 'Response JSON',
              data_type: 'json' as const,
              required: true,
            },
            {
              key: 'status_text',
              label: 'Status Text',
              data_type: 'text' as const,
            },
          ]
        : input.template === 'image_file'
          ? [
              {
                key: 'preview_image',
                label: 'Preview Image',
                data_type: 'image' as const,
                required: true,
              },
              {
                key: 'status_text',
                label: 'Status Text',
                data_type: 'text' as const,
              },
            ]
          : [
              {
                key: 'text',
                label: 'Text',
                data_type: 'text' as const,
                required: true,
              },
            ],
    ui_schema: input.template === 'hello_world'
      ? [
          {
            key: 'name',
            label: 'Name',
            data_type: 'text' as const,
          },
          {
            key: 'prefix',
            label: 'Prefix',
            data_type: 'text' as const,
          },
        ]
      : input.template === 'http_json'
        ? [
            {
              key: 'url',
              label: 'URL',
              data_type: 'text' as const,
            },
            {
              key: 'method',
              label: 'Method',
              data_type: 'text' as const,
            },
          ]
        : input.template === 'image_file'
          ? [
              {
                key: 'file_path',
                label: 'File Path',
                data_type: 'text' as const,
              },
              {
                key: 'status_text',
                label: 'Status Text',
                data_type: 'text' as const,
              },
            ]
          : [],
  };
}

/** Build one starter entry source file for a scaffolded custom node package. */
function buildCustomNodeScaffoldEntrySource(template: CustomNodeScaffoldTemplate): string {
  if (template === 'hello_world') {
    return `module.exports = async function run(ctx) {
  const name = String(ctx.inputs.name ?? 'World')
  const prefix = String(ctx.inputs.prefix ?? 'Hello')

  ctx.log(\`Generating greeting for \${name}\`)

  return {
    outputs: {
      text: \`\${prefix}, \${name}!\`,
      payload: {
        prefix,
        name,
        generatedAt: new Date().toISOString(),
      },
    },
  }
}
`;
  }

  if (template === 'http_json') {
    return `module.exports = async function run(ctx) {
  const url = String(ctx.inputs.url ?? '').trim()
  const method = String(ctx.inputs.method ?? 'GET').trim().toUpperCase() || 'GET'

  if (!url) {
    throw new Error('HTTP JSON template requires a URL input')
  }

  ctx.log(\`Requesting: \${method} \${url}\`)

  const response = await fetch(url, { method })
  const data = await response.json()

  return {
    outputs: {
      response_json: data,
      status_text: \`\${response.status} \${response.statusText}\`,
    },
  }
}
`;
  }

  if (template === 'image_file') {
    return `const path = require('path')

module.exports = async function run(ctx) {
  const filePath = String(ctx.inputs.file_path ?? '').trim()
  const statusText = String(ctx.inputs.status_text ?? 'Loaded image from file path')

  if (!filePath) {
    throw new Error('Image File template requires a file_path input')
  }

  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(__dirname, filePath)
  ctx.log(\`Loading image from: \${resolvedPath}\`)

  return {
    outputs: {
      preview_image: resolvedPath,
      status_text: statusText,
    },
  }
}
`;
  }

  return `module.exports = async function run(ctx) {
  const input = ctx.inputs

  return {
    outputs: {
      text: JSON.stringify(input, null, 2),
    },
  }
}
`;
}

/** Build one starter README for a scaffolded custom node package. */
function buildCustomNodeScaffoldReadme(input: CustomNodeScaffoldInput): string {
  const template = input.template ?? 'empty';
  const templateNotes = template === 'hello_world'
    ? [
        '- The `Hello World` template is a friendly first custom node with text and JSON outputs.',
        '- Edit `name` and `prefix` defaults in `node.json`, then tweak the runtime logic in `index.js`.',
      ]
    : template === 'http_json'
      ? [
          '- The `HTTP JSON` template shows how to call an external API and return JSON/text outputs.',
          '- Edit the default URL and request method in `node.json` or through the module graph inspector.',
        ]
      : template === 'image_file'
        ? [
            '- The `Image File` template shows how to return an image output from a local file path.',
            '- `preview_image` can return either an absolute path or a path relative to the custom node folder.',
          ]
        : [
            '- The `Empty` template is a minimal echo-style starter for text or JSON-shaped experimentation.',
          ];

  return `# ${input.name}

This folder was scaffolded by CoNAI as a local file-based custom node package.

## Files

- \`node.json\` — manifest consumed by the custom node registry
- \`index.js\` — runtime entry file executed by the custom JS node runner

## Runtime notes

- For \`.js\` entries, prefer CommonJS exports such as \`module.exports = async function run(ctx) { ... }\`
- If you want ESM syntax like \`export default\`, use an ESM entry file such as \`.mjs\` and update the manifest entry path
- Return outputs through \`{ outputs: { ... } }\`
- Supported local output types currently include text, prompt, number, boolean, json, any, image, and mask
- For image or mask outputs, return either a \`data:image/...;base64,...\` string or a file path string

## Template notes

${templateNotes.join('\n')}

## Quick iteration loop

1. Edit \`node.json\` to change ports or defaults.
2. Edit \`index.js\` to change runtime behavior.
3. Save the files under \`user/custom_nodes\`.
4. CoNAI will auto-rescan through the custom node folder watcher, or you can press rescan in the UI.
5. Use the custom node management panel to run an ad-hoc test.
`;
}

class RegistryStoppingError extends Error {
  readonly statusCode = 503;
  constructor() { super('Custom node registry is stopping'); }
}

export class CustomNodeRegistryService {
  private static lastSync: Promise<CustomNodeSyncResult> | null = null;
  private static queuedSync: Promise<CustomNodeSyncResult> | null = null;
  private static stopping = false;
  private static scaffolds = new Set<Promise<CustomNodeScaffoldResult>>();

  /** HTTP rescans and scaffolds can still own a future SQLite write after the watcher has closed. */
  static async stopAndDrain(): Promise<void> {
    this.stopping = true;
    await Promise.allSettled([this.lastSync, ...this.scaffolds]);
  }

  /** Ensure the custom node root directory exists before scanning. */
  static async ensureCustomNodesDirectory(): Promise<void> {
    await fs.promises.mkdir(runtimePaths.customNodesDir, { recursive: true });
  }

  /** Create one starter custom node folder and sync it into module_definitions. */
  static async scaffoldCustomNode(input: CustomNodeScaffoldInput): Promise<CustomNodeScaffoldResult> {
    if (this.stopping) throw new RegistryStoppingError();
    const write = this.writeScaffold(input);
    this.scaffolds.add(write);
    try { return await write; } finally { this.scaffolds.delete(write); }
  }

  private static async writeScaffold(input: CustomNodeScaffoldInput): Promise<CustomNodeScaffoldResult> {
    await this.ensureCustomNodesDirectory();

    if (!/^[a-zA-Z0-9._-]+$/.test(input.folderName)) {
      throw new Error('folderName may only contain letters, numbers, dot, underscore, and dash');
    }

    const template = input.template ?? 'empty';
    const folderPath = path.join(runtimePaths.customNodesDir, input.folderName);
    const manifestPath = path.join(folderPath, 'node.json');
    const entryPath = path.join(folderPath, 'index.js');
    const readmePath = path.join(folderPath, 'README.md');
    const manifest = buildCustomNodeScaffoldManifest({ ...input, template });

    try {
      await fs.promises.mkdir(folderPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Custom node folder already exists: ${input.folderName}`);
      throw error;
    }
    await fs.promises.writeFile(entryPath, buildCustomNodeScaffoldEntrySource(template), 'utf8');
    await fs.promises.writeFile(readmePath, buildCustomNodeScaffoldReadme({ ...input, template }), 'utf8');
    await fs.promises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const sync = await this.enqueueSync();
    return {
      folderPath,
      manifestPath,
      entryPath,
      template,
      sync,
    };
  }

  /** Scan `user/custom_nodes` and return valid node packages plus load errors. */
  static async scanCustomNodesFromFileSystem(): Promise<CustomNodeScanResult> {
    await this.ensureCustomNodesDirectory();

    const nodes: CustomNodeRecord[] = [];
    const errors: CustomNodeScanError[] = [];
    const entries = await fs.promises.readdir(runtimePaths.customNodesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const folderName = entry.name;
      const folderPath = path.join(runtimePaths.customNodesDir, folderName);

      try {
        nodes.push(await loadCustomNodeRecord(folderName, folderPath));
      } catch (error) {
        errors.push({
          folderName,
          folderPath,
          message: error instanceof Error ? error.message : 'Failed to load custom node folder',
        });
      }
    }

    const keys = new Set<string>();
    const duplicates = new Set<string>();
    for (const { manifest } of nodes) {
      if (keys.has(manifest.key)) duplicates.add(manifest.key);
      keys.add(manifest.key);
    }
    const uniqueNodes = nodes.filter(({ manifest, folderName, folderPath }) => {
      if (!duplicates.has(manifest.key)) return true;
      errors.push({ folderName, folderPath, message: `Duplicate custom node key: ${manifest.key}` });
      return false;
    });
    return {
      customNodesDir: runtimePaths.customNodesDir,
      nodes: uniqueNodes,
      errors,
    };
  }

  /** Find one valid file-backed custom node record by its stable manifest key. */
  static async findCustomNodeRecordByKey(key: string): Promise<CustomNodeRecord | null> {
    const scanResult = await this.scanCustomNodesFromFileSystem();
    return scanResult.nodes.find((node) => node.manifest.key === key) ?? null;
  }

  /** Requests arriving during a scan share one fresh pass, never an older filesystem snapshot. */
  static syncCustomNodesFromFileSystem(): Promise<CustomNodeSyncResult> {
    if (this.stopping) return Promise.reject(new RegistryStoppingError());
    return this.enqueueSync();
  }

  private static enqueueSync(): Promise<CustomNodeSyncResult> {
    if (this.queuedSync) return this.queuedSync;
    const start = () => {
      this.queuedSync = null;
      return this.scanAndApply();
    };
    const result = (this.lastSync ?? Promise.resolve()).then(start, start);
    this.queuedSync = this.lastSync = result;
    const release = () => { if (this.lastSync === result) this.lastSync = null; };
    void result.then(release, release);
    return result;
  }

  private static async scanAndApply(): Promise<CustomNodeSyncResult> {
    const scanResult = await this.scanCustomNodesFromFileSystem();
    let createdCount = 0;
    let updatedCount = 0;
    for (const nodeRecord of scanResult.nodes) {
      const syncOutcome = syncCustomNodeModuleRecord(nodeRecord, scanResult.errors);
      if (syncOutcome === 'created') {
        createdCount += 1;
      }

      if (syncOutcome === 'updated') {
        updatedCount += 1;
      }
    }

    const deactivatedCount = ModuleDefinitionModel.deactivateMissingFileNodes(scanResult.nodes.map(node => node.manifest.key));

    return {
      ...scanResult,
      createdCount,
      updatedCount,
      deactivatedCount,
    };
  }
}
