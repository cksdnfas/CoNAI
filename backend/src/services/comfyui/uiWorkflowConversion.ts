import axios from 'axios';
import { ComfyUIServerModel } from '../../models/ComfyUIServer';
import type { ComfyUIServerRecord } from '../../types/comfyuiServer';
import { COMFY_FIXED_SEEDS_META_KEY, COMFY_SEED_INPUT_NAMES } from './seedControl';

/**
 * Convert a ComfyUI "Save" (UI/litegraph) workflow into the API prompt format `/prompt` accepts.
 *
 * The ComfyUI browser frontend does this when it queues a prompt; the server has no such endpoint, so the
 * widget order of every node is read back from the server's `/object_info`. Subgraphs are flattened the way the
 * frontend does it (inner node ids become `instance:inner`). Anything that cannot be mapped faithfully (legacy
 * group nodes, unknown frontend-only nodes feeding real ones, shifted widget values, missing required inputs)
 * fails with a reason instead of guessing, and the caller tells the user to use "Export (API)".
 */

export type ComfyObjectInfoNode = {
  input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> };
  input_order?: { required?: string[]; optional?: string[] };
  display_name?: string;
  output_node?: boolean;
};

/** `_meta` is ignored by ComfyUI; `pos` keeps where a root-level node sat in the ComfyUI editor. */
export type ComfyApiWorkflowNode = {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta: { title: string; pos?: [number, number]; [COMFY_FIXED_SEEDS_META_KEY]?: string[] };
};

export type ComfyUiWorkflowConversionResult = {
  workflow: Record<string, ComfyApiWorkflowNode>;
  warnings: string[];
};

export class ComfyUiWorkflowConversionError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`${issues.slice(0, 3).join(' / ')}${issues.length > 3 ? ` 외 ${issues.length - 3}건` : ''}`);
    this.name = 'ComfyUiWorkflowConversionError';
    this.issues = issues;
  }
}

/** What the user should do when the automatic conversion is not possible. */
export const COMFY_UI_WORKFLOW_EXPORT_HINT = 'ComfyUI에서 Workflow → Export (API)로 내보낸 JSON을 넣어줘.';

type UiLink = { originId: string; originSlot: number; targetId: string; targetSlot: number; type: unknown };
type UiNodeInput = { name?: unknown; type?: unknown; link?: unknown; widget?: { name?: unknown } | null };
type UiNodeOutput = { name?: unknown; type?: unknown };
type UiNode = {
  id: string;
  type: string;
  mode: number;
  title?: string;
  inputs: UiNodeInput[];
  outputs: UiNodeOutput[];
  widgets_values?: unknown;
  pos?: [number, number];
};
type SubgraphDefinition = {
  id: string;
  nodes: UiNode[];
  links: Map<number, UiLink>;
  inputs: { name: string; type: unknown }[];
};

/** One graph level: the root graph, or one subgraph instance expanded in place. */
type Scope = {
  prefix: string;
  nodes: Map<string, UiNode>;
  links: Map<number, UiLink>;
  setNodes: Map<string, UiNode>;
  definition?: SubgraphDefinition;
  instance?: UiNode;
  parent?: Scope;
};

type LinkSource =
  | { kind: 'link'; nodeId: string; slot: number }
  | { kind: 'value'; value: unknown }
  | { kind: 'none' };

const MODE_NEVER = 2;
const MODE_BYPASS = 4;
const SUBGRAPH_INPUT_NODE_ID = '-10';
const SUBGRAPH_OUTPUT_NODE_ID = '-20';
const MAX_SUBGRAPH_DEPTH = 16;
const REROUTE_TYPES = new Set(['Reroute', 'Reroute (rgthree)']);
const PRIMITIVE_NODE_TYPE = 'PrimitiveNode';
const SET_NODE_TYPE = 'SetNode';
const GET_NODE_TYPE = 'GetNode';
const FRONTEND_ONLY_TYPES = new Set([...REROUTE_TYPES, PRIMITIVE_NODE_TYPE, SET_NODE_TYPE, GET_NODE_TYPE]);
const POWER_LORA_LOADER_TYPE = 'Power Lora Loader (rgthree)';
const WIDGET_SPEC_TYPES = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO']);
/** V3 combo whose chosen option brings its own inputs, sent as `parent.child` keys. */
const DYNAMIC_COMBO_TYPE = 'COMFY_DYNAMICCOMBO_V3';
const CONTROL_AFTER_GENERATE_VALUES = new Set(['fixed', 'increment', 'decrement', 'randomize', 'increment-wrap']);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** A UI workflow has a `nodes` array at the root; an API workflow is a map of node id → node, never an array. */
export function isComfyUiWorkflowFormat(value: unknown): boolean {
  return isRecord(value) && Array.isArray(value.nodes);
}

export function isComfyUiWorkflowJson(workflowJson: string): boolean {
  try {
    return isComfyUiWorkflowFormat(JSON.parse(workflowJson));
  } catch {
    return false;
  }
}

function readLinks(raw: unknown): Map<number, UiLink> {
  const links = new Map<number, UiLink>();
  if (!Array.isArray(raw)) return links;
  for (const entry of raw) {
    // Schema 0.4 stores links as [id, origin_id, origin_slot, target_id, target_slot, type]; subgraphs and schema 1 as objects.
    if (Array.isArray(entry) && entry.length >= 5) {
      links.set(Number(entry[0]), { originId: String(entry[1]), originSlot: Number(entry[2]), targetId: String(entry[3]), targetSlot: Number(entry[4]), type: entry[5] });
    } else if (isRecord(entry) && entry.id !== undefined) {
      links.set(Number(entry.id), { originId: String(entry.origin_id), originSlot: Number(entry.origin_slot), targetId: String(entry.target_id), targetSlot: Number(entry.target_slot), type: entry.type });
    }
  }
  return links;
}

function readPosition(raw: unknown): [number, number] | undefined {
  const [x, y] = Array.isArray(raw) ? raw : isRecord(raw) ? [raw[0], raw[1]] : [];
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? [Math.round(x), Math.round(y)] : undefined;
}

function readNodes(raw: unknown): UiNode[] {
  return (Array.isArray(raw) ? raw : []).filter(isRecord).map((node) => ({
    id: String(node.id),
    type: typeof node.type === 'string' ? node.type : '',
    mode: typeof node.mode === 'number' ? node.mode : 0,
    title: typeof node.title === 'string' && node.title.trim().length > 0 ? node.title : undefined,
    inputs: Array.isArray(node.inputs) ? node.inputs.filter(isRecord) as UiNodeInput[] : [],
    outputs: Array.isArray(node.outputs) ? node.outputs.filter(isRecord) as UiNodeOutput[] : [],
    widgets_values: node.widgets_values,
    pos: readPosition(node.pos),
  }));
}

/** Subgraph definitions live under `definitions.subgraphs`, at the root and possibly inside other subgraphs. */
function readSubgraphDefinitions(root: Record<string, unknown>) {
  const definitions = new Map<string, SubgraphDefinition>();
  const visit = (container: Record<string, unknown>) => {
    const list = isRecord(container.definitions) && Array.isArray(container.definitions.subgraphs) ? container.definitions.subgraphs : [];
    for (const raw of list.filter(isRecord)) {
      const id = String(raw.id);
      if (definitions.has(id)) continue;
      definitions.set(id, {
        id,
        nodes: readNodes(raw.nodes),
        links: readLinks(raw.links),
        inputs: (Array.isArray(raw.inputs) ? raw.inputs.filter(isRecord) : []).map((input) => ({ name: String(input.name ?? ''), type: input.type })),
      });
      visit(raw);
    }
  };
  visit(root);
  return definitions;
}

function linkIdOf(input: UiNodeInput | undefined): number | null {
  return input && typeof input.link === 'number' ? input.link : null;
}

function inputName(input: UiNodeInput): string | null {
  if (typeof input.widget?.name === 'string') return input.widget.name;
  return typeof input.name === 'string' ? input.name : null;
}

function typesMatch(a: unknown, b: unknown) {
  if (a === '*' || b === '*' || a === undefined || b === undefined) return true;
  if (typeof a !== 'string' || typeof b !== 'string') return a === b;
  const left = a.split(',');
  return b.split(',').some((type) => left.includes(type));
}

export function specOf(info: ComfyObjectInfoNode, name: string): unknown[] | null {
  const spec = info.input?.required?.[name] ?? info.input?.optional?.[name];
  return Array.isArray(spec) ? spec : null;
}

export function specOptions(spec: unknown[]): Record<string, unknown> {
  return isRecord(spec[1]) ? spec[1] : {};
}

export function comboChoices(spec: unknown[]): unknown[] | null {
  if (Array.isArray(spec[0])) return spec[0];
  const options = specOptions(spec).options;
  return spec[0] === 'COMBO' && Array.isArray(options) ? options : null;
}

function orderedInputNames(info: ComfyObjectInfoNode, section: 'required' | 'optional') {
  const declared = info.input?.[section];
  if (!isRecord(declared)) return [];
  const order = info.input_order?.[section];
  return Array.isArray(order) ? order.filter((name) => name in declared) : Object.keys(declared);
}

function isWidgetSpec(spec: unknown[]) {
  const options = specOptions(spec);
  if (options.forceInput === true) return false;
  // `widgetType` names the widget of a multi-type input ("FLOAT,INT"); `socketless` marks frontend widgets such as COLOR.
  if (typeof options.widgetType === 'string' || options.socketless === true) return true;
  return Array.isArray(spec[0]) || (typeof spec[0] === 'string' && (WIDGET_SPEC_TYPES.has(spec[0]) || spec[0] === DYNAMIC_COMBO_TYPE));
}

/** Inputs the frontend fills on its own or may leave out: socketless widgets and V3 autogrow/dynamic blocks. */
function isFrontendManagedSpec(spec: unknown[]) {
  return specOptions(spec).socketless === true || (typeof spec[0] === 'string' && /^COMFY_.+_V3$/.test(spec[0]));
}

/** Inputs the frontend draws as widgets (and so stores in `widgets_values`), in declaration order. */
function widgetInputNames(info: ComfyObjectInfoNode) {
  return [...orderedInputNames(info, 'required'), ...orderedInputNames(info, 'optional')].filter((name) => {
    const spec = specOf(info, name);
    return Boolean(spec && isWidgetSpec(spec));
  });
}

function dynamicComboOptions(spec: unknown[]) {
  const options = specOptions(spec).options;
  return (Array.isArray(options) ? options : []).filter(isRecord).map((option) => ({
    key: option.key,
    inputs: isRecord(option.inputs) ? option.inputs : {},
  }));
}

function valueFitsSpec(value: unknown, spec: unknown[]) {
  if (value === null || value === undefined) return true;
  if (spec[0] === DYNAMIC_COMBO_TYPE) return dynamicComboOptions(spec).some((option) => option.key === value);
  if (comboChoices(spec)) return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  const widgetType = specOptions(spec).widgetType;
  switch (typeof widgetType === 'string' ? widgetType : spec[0]) {
    case 'INT':
    case 'FLOAT':
      return typeof value === 'number';
    case 'BOOLEAN':
      return typeof value === 'boolean';
    case 'STRING':
      return typeof value === 'string';
    default:
      return true;
  }
}

/** Whether the value right after a widget is that widget's "control after generate" companion. */
function isControlCompanion(name: string, spec: unknown[], next: unknown, nextSpec: unknown[] | null) {
  if (typeof next !== 'string' || !CONTROL_AFTER_GENERATE_VALUES.has(next)) return false;
  if (specOptions(spec).control_after_generate === true || COMFY_SEED_INPUT_NAMES.has(name)) return true;
  if (spec[0] !== 'INT' && !comboChoices(spec)) return false;
  // Not flagged: skip it only when the next widget could not take this string itself.
  if (!nextSpec) return true;
  const choices = comboChoices(nextSpec);
  return choices ? !choices.includes(next) : nextSpec[0] !== 'STRING';
}

/** Read a real node's widgets_values into named inputs. */
function readWidgetValues(node: UiNode, info: ComfyObjectInfoNode) {
  const inputs: Record<string, unknown> = {};
  const widgetNames = widgetInputNames(info);
  const values = node.widgets_values;

  if (node.type === POWER_LORA_LOADER_TYPE && Array.isArray(values)) {
    // rgthree draws its own rows; the API form names them lora_1, lora_2, … in order.
    let loraIndex = 0;
    for (const value of values) {
      if (isRecord(value) && 'lora' in value) {
        loraIndex += 1;
        inputs[`lora_${loraIndex}`] = Object.fromEntries(Object.entries(value).filter(([key, item]) => !(key === 'strengthTwo' && item === null)));
      } else if (isRecord(value) && value.type === 'PowerLoraLoaderHeaderWidget') {
        inputs.PowerLoraLoaderHeaderWidget = { type: 'PowerLoraLoaderHeaderWidget' };
      }
    }
    inputs['➕ Add Lora'] = '';
    return { inputs, widgetSpecs: new Map<string, unknown[]>(), fixedSeeds: [] as string[] };
  }

  const widgetSpecs = new Map<string, unknown[]>();
  const fixedSeeds: string[] = [];
  if (isRecord(values)) {
    // Some nodes (VideoHelperSuite) store widgets by name.
    for (const name of widgetNames) {
      if (name in values) {
        inputs[name] = values[name];
        widgetSpecs.set(name, specOf(info, name)!);
      }
    }
  } else if (Array.isArray(values)) {
    let cursor = 0;
    // A dynamic combo's chosen option adds its inputs' widgets right after the combo itself, named `combo.child`.
    const walk = (entries: Array<[string, unknown[]]>, prefix: string) => {
      const widgets = entries.filter(([, spec]) => isWidgetSpec(spec));
      for (let index = 0; index < widgets.length && cursor < values.length; index += 1) {
        const [name, spec] = widgets[index];
        const fullName = `${prefix}${name}`;
        inputs[fullName] = values[cursor];
        widgetSpecs.set(fullName, spec);
        cursor += 1;
        if (spec[0] === DYNAMIC_COMBO_TYPE) {
          const option = dynamicComboOptions(spec).find((entry) => entry.key === inputs[fullName]);
          if (option) walk(sectionEntries(option.inputs), `${fullName}.`);
          continue;
        }
        const nextSpec = widgets[index + 1]?.[1] ?? null;
        if (cursor < values.length && isControlCompanion(name, spec, values[cursor], nextSpec)) {
          if (values[cursor] === 'fixed' && COMFY_SEED_INPUT_NAMES.has(fullName)) fixedSeeds.push(fullName);
          cursor += 1;
        }
      }
    };
    walk([...orderedInputNames(info, 'required'), ...orderedInputNames(info, 'optional')].map((name) => [name, specOf(info, name)!] as [string, unknown[]]).filter(([, spec]) => spec), '');
  }
  return { inputs, widgetSpecs, fixedSeeds };
}

/** required then optional entries of a nested V3 input block. */
function sectionEntries(block: Record<string, unknown>): Array<[string, unknown[]]> {
  return (['required', 'optional'] as const).flatMap((section) => {
    const declared = block[section];
    return isRecord(declared) ? Object.entries(declared).filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1])) : [];
  });
}

function describeNode(scope: Scope, node: UiNode) {
  return `#${scope.prefix}${node.id} ${node.title ?? node.type}`;
}

export async function convertComfyUiWorkflowToApi(
  raw: unknown,
  getNodeInfo: (classType: string) => Promise<ComfyObjectInfoNode | null>,
): Promise<ComfyUiWorkflowConversionResult> {
  if (!isComfyUiWorkflowFormat(raw)) throw new ComfyUiWorkflowConversionError(['ComfyUI 일반 워크플로 형식이 아니야.']);
  const root = raw as Record<string, unknown>;
  const definitions = readSubgraphDefinitions(root);
  const rootNodes = readNodes(root.nodes);
  const issues: string[] = [];
  const warnings: string[] = [];

  const groupNodeNames = new Set(Object.keys(isRecord(root.extra) && isRecord(root.extra.groupNodes) ? root.extra.groupNodes : {}));
  const allNodes = [...rootNodes, ...[...definitions.values()].flatMap((definition) => definition.nodes)];
  for (const node of allNodes) {
    if (!definitions.has(node.type) && (/^workflow[>/]/.test(node.type) || groupNodeNames.has(node.type))) {
      issues.push(`#${node.id} ${node.title ?? node.type}: 예전 방식 그룹 노드는 변환할 수 없어. 서브그래프로 바꾸거나 풀어줘.`);
    }
  }
  if (issues.length > 0) throw new ComfyUiWorkflowConversionError(issues);

  const infoByType = new Map<string, ComfyObjectInfoNode | null>();
  for (const type of new Set(allNodes.map((node) => node.type).filter((type) => type && !FRONTEND_ONLY_TYPES.has(type) && !definitions.has(type)))) {
    infoByType.set(type, await getNodeInfo(type));
  }
  const infoOf = (node: UiNode) => infoByType.get(node.type) ?? null;

  const makeScope = (nodes: UiNode[], links: Map<number, UiLink>, prefix: string, extra: Partial<Scope> = {}): Scope => {
    const setNodes = new Map<string, UiNode>();
    for (const node of nodes) {
      if (node.type === SET_NODE_TYPE && node.mode !== MODE_NEVER && Array.isArray(node.widgets_values)) setNodes.set(String(node.widgets_values[0]), node);
    }
    return { prefix, nodes: new Map(nodes.map((node) => [node.id, node])), links, setNodes, ...extra };
  };
  const rootScope = makeScope(rootNodes, readLinks(root.links), '');
  const childScopes = new Map<string, Scope>();
  const enterInstance = (scope: Scope, instance: UiNode): Scope | null => {
    const key = `${scope.prefix}${instance.id}`;
    const cached = childScopes.get(key);
    if (cached) return cached;
    const definition = definitions.get(instance.type);
    if (!definition) return null;
    if (key.split(':').length > MAX_SUBGRAPH_DEPTH) {
      issues.push(`${describeNode(scope, instance)}: 서브그래프가 너무 깊게 중첩돼 있어.`);
      return null;
    }
    const child = makeScope(definition.nodes, definition.links, `${key}:`, { definition, instance, parent: scope });
    childScopes.set(key, child);
    return child;
  };

  /** Value of an instance's promoted widget: the subgraph inputs that reach an inner widget, in definition order. */
  const promotedWidgetValue = (scope: Scope, slot: number): unknown => {
    const definition = scope.definition!;
    const instance = scope.instance!;
    const widgetSlots = definition.inputs
      .map((_, index) => index)
      .filter((index) => [...definition.links.values()].some((link) => {
        if (link.originId !== SUBGRAPH_INPUT_NODE_ID || link.originSlot !== index) return false;
        const target = scope.nodes.get(link.targetId)?.inputs[link.targetSlot];
        return Boolean(target?.widget);
      }));
    const position = widgetSlots.indexOf(slot);
    const values = instance.widgets_values;
    if (position < 0) return undefined;
    if (Array.isArray(values)) return values[position];
    return isRecord(values) ? values[definition.inputs[slot]?.name] : undefined;
  };

  /** Follow one link through reroutes, primitives, Set/Get pairs, subgraph borders and bypassed nodes. */
  const resolveLink = (scope: Scope, linkId: number | null, target: UiNode, seen = new Set<string>()): LinkSource => {
    if (linkId === null) return { kind: 'none' };
    const seenKey = `${scope.prefix}|${linkId}`;
    if (seen.has(seenKey)) return { kind: 'none' };
    seen.add(seenKey);
    const link = scope.links.get(linkId);
    if (!link) return { kind: 'none' };

    if (link.originId === SUBGRAPH_INPUT_NODE_ID) {
      if (!scope.instance || !scope.parent || !scope.definition) return { kind: 'none' };
      // The instance lists only some of the definition's inputs, in its own order: match by name, never by position.
      const name = scope.definition.inputs[link.originSlot]?.name;
      const outerLink = linkIdOf(scope.instance.inputs.find((input) => input.name === name));
      if (outerLink !== null) return resolveLink(scope.parent, outerLink, target, seen);
      const value = promotedWidgetValue(scope, link.originSlot);
      return value === undefined ? { kind: 'none' } : { kind: 'value', value };
    }

    const origin = scope.nodes.get(link.originId);
    if (!origin) return { kind: 'none' };

    if (REROUTE_TYPES.has(origin.type) || origin.type === SET_NODE_TYPE) return resolveLink(scope, linkIdOf(origin.inputs[0]), target, seen);
    if (origin.type === PRIMITIVE_NODE_TYPE) {
      const value = Array.isArray(origin.widgets_values) ? origin.widgets_values[0] : undefined;
      return value === undefined ? { kind: 'none' } : { kind: 'value', value };
    }
    if (origin.type === GET_NODE_TYPE) {
      const name = Array.isArray(origin.widgets_values) ? String(origin.widgets_values[0]) : '';
      for (let current: Scope | undefined = scope; current; current = current.parent) {
        const setNode = current.setNodes.get(name);
        if (setNode) return resolveLink(current, linkIdOf(setNode.inputs[0]), target, seen);
      }
      issues.push(`${describeNode(scope, origin)}: 짝이 되는 SetNode "${name}"를 찾지 못했어.`);
      return { kind: 'none' };
    }

    const isSubgraph = definitions.has(origin.type);
    if (!isSubgraph && !infoOf(origin)) {
      issues.push(`${describeNode(scope, origin)}: 서버에 없는 노드(${origin.type})라 ${describeNode(scope, target)}에 이어진 값을 알 수 없어.`);
      return { kind: 'none' };
    }
    if (origin.mode === MODE_NEVER) return { kind: 'none' };
    if (origin.mode === MODE_BYPASS) {
      // A bypassed node passes through the input at the same slot when its type matches, else the first matching one.
      const outputType = origin.outputs[link.originSlot]?.type ?? link.type;
      const sameSlot = origin.inputs[link.originSlot];
      const passInput = sameSlot && linkIdOf(sameSlot) !== null && typesMatch(sameSlot.type, outputType)
        ? sameSlot
        : origin.inputs.find((input) => linkIdOf(input) !== null && typesMatch(input.type, outputType));
      return resolveLink(scope, linkIdOf(passInput), target, seen);
    }
    if (isSubgraph) {
      const child = enterInstance(scope, origin);
      if (!child) return { kind: 'none' };
      const inner = [...child.links.entries()].find(([, entry]) => entry.targetId === SUBGRAPH_OUTPUT_NODE_ID && entry.targetSlot === link.originSlot);
      return inner ? resolveLink(child, inner[0], target, seen) : { kind: 'none' };
    }
    return { kind: 'link', nodeId: `${scope.prefix}${origin.id}`, slot: link.originSlot };
  };

  const workflow: Record<string, ComfyApiWorkflowNode> = {};
  const droppedTypes = new Set<string>();

  const emitScope = (scope: Scope) => {
    const ordered = [...scope.nodes.values()].sort((a, b) => (Number(a.id) - Number(b.id)) || a.id.localeCompare(b.id));
    for (const node of ordered) {
      if (FRONTEND_ONLY_TYPES.has(node.type)) continue;
      if (node.mode === MODE_NEVER || node.mode === MODE_BYPASS) continue;
      if (definitions.has(node.type)) {
        const child = enterInstance(scope, node);
        if (child) emitScope(child);
        continue;
      }
      const info = infoOf(node);
      if (!info) {
        // Notes, labels and other frontend-only helpers: harmless unless something reads from them (reported in resolveLink).
        droppedTypes.add(node.type || '(이름 없음)');
        continue;
      }

      const { inputs, widgetSpecs, fixedSeeds } = readWidgetValues(node, info);
      const fromWidgets = new Set(widgetSpecs.keys());
      for (const input of node.inputs) {
        const linkId = linkIdOf(input);
        const name = inputName(input);
        if (linkId === null || !name) continue;
        const source = resolveLink(scope, linkId, node);
        if (source.kind === 'link') inputs[name] = [source.nodeId, source.slot];
        else if (source.kind === 'value') inputs[name] = source.value;
        else continue;
        fromWidgets.delete(name);
      }

      for (const name of fromWidgets) {
        if (!valueFitsSpec(inputs[name], widgetSpecs.get(name)!)) {
          issues.push(`${describeNode(scope, node)}: "${name}" 값(${JSON.stringify(inputs[name])?.slice(0, 40)})이 입력 형식과 안 맞아. 위젯 순서가 서버 노드 버전과 달라.`);
        }
      }

      const key = `${scope.prefix}${node.id}`;
      const missing: string[] = [];
      for (const name of orderedInputNames(info, 'required')) {
        // V3 dynamic inputs (autogrow, dynamic combo) arrive as `name.sub` keys.
        if (inputs[name] !== undefined || Object.keys(inputs).some((key) => key.startsWith(`${name}.`))) continue;
        const spec = specOf(info, name);
        if (spec && isFrontendManagedSpec(spec)) continue;
        const fallback = spec ? specOptions(spec).default ?? comboChoices(spec)?.[0] : undefined;
        if (spec && widgetInputNames(info).includes(name) && fallback !== undefined) {
          inputs[name] = fallback;
          warnings.push(`${describeNode(scope, node)}: "${name}" 값이 없어서 기본값을 넣었어.`);
        } else {
          missing.push(name);
        }
      }
      if (missing.length > 0) missingRequired.set(key, { label: describeNode(scope, node), names: missing });

      const title = node.title ?? info.display_name ?? node.type;
      // Inner subgraph nodes have no place of their own on the root canvas.
      const meta: ComfyApiWorkflowNode['_meta'] = scope.prefix === '' && node.pos ? { title, pos: node.pos } : { title };
      // CoNAI rolls seeds per run; keep the ones ComfyUI had on "fixed".
      if (fixedSeeds.length > 0) meta[COMFY_FIXED_SEEDS_META_KEY] = fixedSeeds;
      workflow[key] = { class_type: node.type, inputs, _meta: meta };
    }
  };
  const missingRequired = new Map<string, { label: string; names: string[] }>();
  emitScope(rootScope);

  // Like the frontend, dangling nodes go out as they are; ComfyUI only validates what an output node reaches.
  const outputKeys = Object.keys(workflow).filter((key) => infoByType.get(workflow[key].class_type)?.output_node === true);
  const reached = new Set<string>();
  const pending = [...outputKeys];
  while (pending.length > 0) {
    const key = pending.pop()!;
    if (reached.has(key) || !workflow[key]) continue;
    reached.add(key);
    for (const value of Object.values(workflow[key].inputs)) {
      if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'number') pending.push(value[0]);
    }
  }
  for (const [key, entry] of missingRequired) {
    if (reached.has(key)) issues.push(`${entry.label}: 필수 입력 ${entry.names.map((name) => `"${name}"`).join(', ')}이 연결돼 있지 않아.`);
  }

  if (droppedTypes.size > 0) warnings.push(`실행에 쓰이지 않는 노드는 뺐어: ${[...droppedTypes].join(', ')}`);
  if (issues.length === 0 && Object.keys(workflow).length === 0) issues.push('실행할 노드가 없어.');
  if (issues.length === 0 && outputKeys.length === 0) issues.push('출력 노드(Save Image 등)가 없어.');
  if (issues.length > 0) throw new ComfyUiWorkflowConversionError([...new Set(issues)]);
  return { workflow, warnings };
}

const OBJECT_INFO_TIMEOUT_MS = 15_000;
const OBJECT_INFO_TTL_MS = 5 * 60_000;
const MAX_CONVERSION_SERVERS = 3;
const objectInfoCache = new Map<string, { at: number; value: ComfyObjectInfoNode | null }>();

/** One node's /object_info entry from one server, cached for a few minutes (null = the server has no such node). */
export async function fetchComfyNodeInfo(endpoint: string, classType: string): Promise<ComfyObjectInfoNode | null> {
  const base = endpoint.replace(/\/+$/, '');
  const key = `${base}|${classType}`;
  const cached = objectInfoCache.get(key);
  if (cached && Date.now() - cached.at < OBJECT_INFO_TTL_MS) return cached.value;
  const response = await axios.get(`${base}/object_info/${encodeURIComponent(classType)}`, { timeout: OBJECT_INFO_TIMEOUT_MS });
  const info = isRecord(response.data) ? response.data[classType] : undefined;
  const value = isRecord(info) ? info as ComfyObjectInfoNode : null;
  objectInfoCache.set(key, { at: Date.now(), value });
  return value;
}

function createObjectInfoLookup(server: ComfyUIServerRecord) {
  return (classType: string) => fetchComfyNodeInfo(server.endpoint, classType);
}

/** Active ComfyUI servers that answer /object_info, the default one first. */
function conversionServers(serverId?: number | null) {
  if (serverId) {
    const server = ComfyUIServerModel.findById(serverId);
    return server && server.backend_type !== 'modal' ? [server] : [];
  }
  const servers = ComfyUIServerModel.findActiveServers().filter((server) => server.backend_type !== 'modal');
  return servers.sort((a, b) => Number(b.is_default) - Number(a.is_default)).slice(0, MAX_CONVERSION_SERVERS);
}

/** Convert a UI workflow using the first registered server that knows all of its nodes. */
export async function convertComfyUiWorkflowWithServers(raw: unknown, options: { serverId?: number | null } = {}) {
  const servers = conversionServers(options.serverId);
  if (servers.length === 0) throw new ComfyUiWorkflowConversionError(['변환에 쓸 ComfyUI 서버가 등록돼 있지 않아.']);
  let firstFailure: ComfyUiWorkflowConversionError | null = null;
  for (const server of servers) {
    try {
      const result = await convertComfyUiWorkflowToApi(raw, createObjectInfoLookup(server));
      return { ...result, server: { id: server.id, name: server.name } };
    } catch (error) {
      const failure = error instanceof ComfyUiWorkflowConversionError
        ? error
        : new ComfyUiWorkflowConversionError([`${server.name} 서버에서 노드 정보를 읽지 못했어.`]);
      firstFailure ??= failure;
    }
  }
  throw firstFailure!;
}

/**
 * Normalize a stored workflow_json: API workflows come back untouched (same string), UI workflows are converted.
 * Throws ComfyUiWorkflowConversionError when a UI workflow cannot be converted.
 */
export async function resolveApiWorkflowJson(workflowJson: string): Promise<{ workflowJson: string; converted: boolean; warnings: string[] }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(workflowJson);
  } catch {
    return { workflowJson, converted: false, warnings: [] };
  }
  if (!isComfyUiWorkflowFormat(parsed)) return { workflowJson, converted: false, warnings: [] };
  const result = await convertComfyUiWorkflowWithServers(parsed);
  return { workflowJson: JSON.stringify(result.workflow, null, 2), converted: true, warnings: result.warnings };
}

export function describeComfyUiWorkflowConversionFailure(error: ComfyUiWorkflowConversionError) {
  return `일반 워크플로를 API 형식으로 바꾸지 못했어: ${error.message} ${COMFY_UI_WORKFLOW_EXPORT_HINT}`;
}
