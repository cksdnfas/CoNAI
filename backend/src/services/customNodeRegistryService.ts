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

export type CustomNodeScaffoldTemplate = 'empty' | 'http_json' | 'image_file';

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

/** Validate one custom node manifest and resolve its entry file. */
async function loadCustomNodeRecord(folderName: string, folderPath: string): Promise<CustomNodeRecord> {
  const manifestPath = path.join(folderPath, 'node.json');
  const manifestContent = await fs.promises.readFile(manifestPath, 'utf8');
  const parsedManifest = customNodeManifestSchema.parse(JSON.parse(manifestContent));

  if (path.isAbsolute(parsedManifest.entry)) {
    throw new Error('Manifest entry must be a relative path');
  }

  const entryPath = path.resolve(folderPath, parsedManifest.entry);
  if (!entryPath.startsWith(path.resolve(folderPath))) {
    throw new Error('Manifest entry must stay inside the custom node folder');
  }

  const entryContent = await fs.promises.readFile(entryPath, 'utf8');
  const packageJsonPath = path.join(folderPath, 'package.json');
  const readmePath = path.join(folderPath, 'README.md');

  return {
    folderName,
    folderPath,
    manifestPath,
    entryPath,
    packageJsonPath: fs.existsSync(packageJsonPath) ? packageJsonPath : null,
    readmePath: fs.existsSync(readmePath) ? readmePath : null,
    sourceHash: buildCustomNodeSourceHash(manifestContent, entryContent),
    manifest: parsedManifest,
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
    inputs: input.template === 'http_json'
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
    outputs: input.template === 'http_json'
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
    ui_schema: input.template === 'http_json'
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
  const templateNotes = template === 'http_json'
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

/** Mark one file-backed custom node module inactive after its folder disappears. */
function deactivateMissingCustomNodeModule(moduleRecord: ModuleDefinitionRecord): boolean {
  if (!moduleRecord.id || moduleRecord.is_active === false) {
    return false;
  }

  return ModuleDefinitionModel.update(moduleRecord.id, {
    is_active: false,
  });
}

export class CustomNodeRegistryService {
  /** Ensure the custom node root directory exists before scanning. */
  static async ensureCustomNodesDirectory(): Promise<void> {
    await fs.promises.mkdir(runtimePaths.customNodesDir, { recursive: true });
  }

  /** Create one starter custom node folder and sync it into module_definitions. */
  static async scaffoldCustomNode(input: CustomNodeScaffoldInput): Promise<CustomNodeScaffoldResult> {
    await this.ensureCustomNodesDirectory();

    if (!/^[a-zA-Z0-9._-]+$/.test(input.folderName)) {
      throw new Error('folderName may only contain letters, numbers, dot, underscore, and dash');
    }

    const template = input.template ?? 'empty';
    const folderPath = path.join(runtimePaths.customNodesDir, input.folderName);
    if (fs.existsSync(folderPath)) {
      throw new Error(`Custom node folder already exists: ${input.folderName}`);
    }

    const manifestPath = path.join(folderPath, 'node.json');
    const entryPath = path.join(folderPath, 'index.js');
    const readmePath = path.join(folderPath, 'README.md');
    const manifest = buildCustomNodeScaffoldManifest({ ...input, template });

    await fs.promises.mkdir(folderPath, { recursive: true });
    await fs.promises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await fs.promises.writeFile(entryPath, buildCustomNodeScaffoldEntrySource(template), 'utf8');
    await fs.promises.writeFile(readmePath, buildCustomNodeScaffoldReadme({ ...input, template }), 'utf8');

    const sync = await this.syncCustomNodesFromFileSystem();
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

    return {
      customNodesDir: runtimePaths.customNodesDir,
      nodes,
      errors,
    };
  }

  /** Find one valid file-backed custom node record by its stable manifest key. */
  static async findCustomNodeRecordByKey(key: string): Promise<CustomNodeRecord | null> {
    const scanResult = await this.scanCustomNodesFromFileSystem();
    return scanResult.nodes.find((node) => node.manifest.key === key) ?? null;
  }

  /** Sync file-backed custom nodes into module_definitions for graph usage. */
  static async syncCustomNodesFromFileSystem(): Promise<CustomNodeSyncResult> {
    const scanResult = await this.scanCustomNodesFromFileSystem();
    let createdCount = 0;
    let updatedCount = 0;
    let deactivatedCount = 0;
    const seenExternalKeys = new Set<string>();

    for (const nodeRecord of scanResult.nodes) {
      const createData = buildModuleDefinitionCreateData(nodeRecord);
      seenExternalKeys.add(nodeRecord.manifest.key);

      try {
        const existingByExternalKey = ModuleDefinitionModel.findByExternalKey(nodeRecord.manifest.key);
        if (existingByExternalKey) {
          const updated = ModuleDefinitionModel.update(existingByExternalKey.id, {
            name: createData.name,
            description: createData.description,
            category: createData.category,
            template_defaults: createData.template_defaults,
            exposed_inputs: createData.exposed_inputs,
            output_ports: createData.output_ports,
            ui_schema: createData.ui_schema,
            is_active: true,
            color: createData.color,
            external_key: createData.external_key,
            source_path: createData.source_path,
            source_hash: createData.source_hash,
          });
          if (updated) {
            updatedCount += 1;
          }
          continue;
        }

        if (ModuleDefinitionModel.existsByName(createData.name)) {
          scanResult.errors.push({
            folderName: nodeRecord.folderName,
            folderPath: nodeRecord.folderPath,
            message: `Module name already exists: ${createData.name}`,
          });
          continue;
        }

        ModuleDefinitionModel.create(createData);
        createdCount += 1;
      } catch (error) {
        scanResult.errors.push({
          folderName: nodeRecord.folderName,
          folderPath: nodeRecord.folderPath,
          message: error instanceof Error ? error.message : 'Failed to sync custom node module',
        });
      }
    }

    const fileBackedModules = ModuleDefinitionModel.findAll(false)
      .filter((moduleRecord) => moduleRecord.authoring_source === 'custom_node_fs');

    for (const moduleRecord of fileBackedModules) {
      if (!moduleRecord.external_key || seenExternalKeys.has(moduleRecord.external_key)) {
        continue;
      }

      if (deactivateMissingCustomNodeModule(moduleRecord)) {
        deactivatedCount += 1;
      }
    }

    return {
      ...scanResult,
      createdCount,
      updatedCount,
      deactivatedCount,
    };
  }
}
