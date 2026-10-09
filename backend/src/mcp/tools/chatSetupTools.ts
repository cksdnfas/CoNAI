import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ChatProposal } from '@conai/shared';
import { z } from 'zod';
import { ChatProposalStore, type NewChatProposal } from '../../services/codex-chat/chatProposals';
import { ChatProfileStore, CHAT_PROFILE_LIMITS, CHAT_PROFILE_TEXT_LIMITS, normalizeAlternateGreetings, normalizeSections, type ChatProfile } from '../../services/codex-chat/chatProfiles';
import { ChatSharedBlockStore, PROFILE_MAX_BLOCKS } from '../../services/codex-chat/chatDisplayBlocks';
import { ChatLorebookStore, PROFILE_MAX_LOREBOOKS } from '../../services/codex-chat/chatLorebook';
import { ModelSlotStore } from '../../services/codex-chat/modelSlots';
import { modelLabelOf } from '../../services/codex-chat/chatModelRoles';
import { normalizeBlock } from '../../services/codex-chat/chatStyle';
import type { McpRequestContext } from '../context';
import { proposeProfileAssets } from '../../services/codex-chat/chatAssetProposals';
import { chatAssetBatchInputSchema, getChatAssetBatch, latestChatAssetBatchId } from '../../services/codex-chat/chatAssetBatches';
import { ChatGenerationPresetStore, resolvePresetWorkflow } from '../../services/codex-chat/chatGenerationPresets';
import { PromptPresetModel } from '../../models/PromptPreset';
import { parseMcpMarkedFields } from './mcpComfyWorkflowService';

function textResult(value: unknown, extra: Record<string, unknown> = {}) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], ...extra };
}

function errorResult(error: unknown) {
  return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] };
}

const BLOCK_KEY_ERROR = 'block.key must match /^[a-z][a-z0-9_-]{0,31}$/';
const PROPOSAL_NOTE = 'The card is shown to the user; nothing is saved until they press 저장.';
const NO_CHAT_ERROR = 'Proposals need an active chat reply.';

/** Profile fields a chat may propose changing. Engine, tool grants, allowlists, presets and provider/model pairs are not among them. */
const PROPOSABLE_KEYS = ['name', 'tagline', 'systemPrompt', 'promptSections', 'greeting', 'alternateGreetings', 'authorNote', 'appearance', 'modelSlotId', 'summarySlotId', 'translationSlotId', 'suggestSlotId', 'lorebookIds', 'blockIds'] as const;
type ProposableKey = typeof PROPOSABLE_KEYS[number];

const KEY_ALIASES: Record<string, ProposableKey> = {
  system_prompt: 'systemPrompt',
  prompt_sections: 'promptSections',
  alternate_greetings: 'alternateGreetings',
  author_note: 'authorNote',
  model_slot: 'modelSlotId',
  model_slot_id: 'modelSlotId',
  summary_slot: 'summarySlotId',
  summary_slot_id: 'summarySlotId',
  translation_slot: 'translationSlotId',
  translation_slot_id: 'translationSlotId',
  suggest_slot: 'suggestSlotId',
  suggest_slot_id: 'suggestSlotId',
  lorebook_ids: 'lorebookIds',
  block_ids: 'blockIds',
};

// ---------------------------------------------------------------- guide text

const DISPLAY_BLOCK_GUIDE = [
  'DISPLAY BLOCK (status card) reference',
  '',
  'A display block is a card the chat renders from a JSON state kept by the server. At runtime the chat model writes only the fields that changed, inside a fenced block named after `key`, e.g. ```status {"hp": 70} ```. The card shows the merged state through `template`.',
  '',
  'Shape of propose_display_block.block:',
  '{ "key": "status", "instruction": "...", "example": "{...JSON object...}", "template": "<html>", "css": "...", "rules": "...", "summary": "{{place}} · HP {{hp}}", "fields": [ { "name": "hp", "min": 0, "max": 100, "step": 10 } ] }',
  '- key: /^[a-z][a-z0-9_-]{0,31}$/ (the fence name). Stored lowercase.',
  '- instruction (max 2000): when and how the chat model should update the block. Goes into its system prompt.',
  '- example (max 4000): a JSON OBJECT. It is the starting state of a new chat AND the shape the chat model sees. Include every field with a realistic start value. {{char}} becomes the character name.',
  '- template (max 20000): HTML with {{slots}}. css (max 20000): styles, scoped to this block only.',
  '- rules (max 2000): free-text update rules the chat model should follow (not enforced).',
  '- summary (max 300): one-line template for the folded strip, e.g. `{{place}} · HP {{hp}}`. Empty: first scalar fields.',
  '- fields (max 40): rules the SERVER enforces on the chat model\'s updates. Entry: name, min, max (numbers), step (largest change per reply), values (allowed values, any type compared as text), readonly (chat model may not change it). Every key is optional except name.',
  '',
  'Template syntax:',
  '- {{name}}, {{a.b}}: a value. Lists are joined with commas.',
  '- Expressions: {{hp / maxhp * 100}}, {{"Lv." + level}}. Operators + - * / %, parentheses, numbers, "strings", true/false.',
  '- Functions: round(x, digits) floor ceil abs min max clamp(x, lo, hi) pct(x, max) len(list) join(list, "·").',
  '- {{#each items}}...{{/each}}: loop; inside, {{.}} is the item and {{field}} an item field.',
  '- {{#if field}}...{{else}}...{{/if}}: truthy test. Comparisons work: {{#if affinity >= 50 && mood == "happy"}} with == != < <= > >= && || !.',
  '- data-pick="text": clickable element; the click is sent with the user\'s next message as a choice (inventory, skills).',
  '- data-set="field=value": click sets that field directly (value read as JSON, else text); use for toggles.',
  'Values are inserted as plain text, never as HTML. The sanitizer removes <script>, on* event attributes, frames, forms and javascript: URLs from the template.',
  '',
  'Worked example (3-field status card):',
  '{ "key": "status", "instruction": "Update after every scene change. Write only changed fields.", "example": "{\\"place\\": \\"Cafe\\", \\"hp\\": 100, \\"mood\\": \\"calm\\"}", "template": "<div class=\\"card\\"><b>{{place}}</b><div class=\\"bar\\"><i style=\\"width:{{pct(hp, 100)}}%\\"></i></div><span>{{mood}}</span></div>", "css": ".card{padding:8px}.bar{height:6px;background:#444}.bar i{display:block;height:100%;background:#4c8}", "rules": "hp drops only when the character is hurt.", "summary": "{{place}} · HP {{hp}}", "fields": [ { "name": "hp", "min": 0, "max": 100, "step": 20 }, { "name": "mood", "values": ["calm", "happy", "angry"] } ] }',
  '',
  'Propose with propose_display_block. The user sees a card and saves it themselves; nothing is saved by you.',
].join('\n');

function profileGuide() {
  const slots = ModelSlotStore.list();
  const lorebooks = ChatLorebookStore.list();
  const blocks = ChatSharedBlockStore.list();
  const limits = CHAT_PROFILE_TEXT_LIMITS;
  return [
    'CHAT PROFILE reference',
    '',
    'A profile is a character/persona the user chats with. propose_chat_profile proposes a NEW profile; propose_profile_update proposes changes to an existing one. Both only show a card; the user saves it with the 저장 button.',
    '',
    'Fields (propose_chat_profile):',
    `- name (required, max ${limits.name}), tagline (max ${limits.tagline}, one-line intro shown on the profile card).`,
    `- system_prompt (max ${limits.text}): instructions every chat starts with. Use {{char}} for the profile name and {{user}} for the user's persona name.`,
    `- prompt_sections (max ${limits.sections}): [{ "title": "World", "content": "...", "enabled": true }]. Title max ${limits.sectionTitle}, content max ${limits.text}. Plain sections are appended after the system prompt as "## title". Optional kind "dialogue" marks example conversation (lines starting with {{user}}: / {{char}}: become real turns).`,
    `- greeting (max ${limits.text}) and alternate_greetings (max ${limits.alternateGreetings}): the first message of a new chat is picked at random among them.`,
    `- author_note (max ${limits.authorNote}): scene direction added near the end of every request.`,
    `- appearance (max ${limits.text}): the character's look as image-prompt tags (hair, eyes, outfit…). Character image generation puts it in front of every asset prompt.`,
    '- model_slot: model id or `connection · model` label (the chat model). Omit to start on the default model.',
    `- lorebook_ids (max ${PROFILE_MAX_LOREBOOKS}) and block_ids (max ${PROFILE_MAX_BLOCKS}): link existing shared lorebooks / display blocks by id.`,
    '- typeface: "sans" | "serif" | "mono".',
    `Numeric profile settings are clamped by the app and are not proposable (for reference: context turns ${CHAT_PROFILE_LIMITS.contextTurns.min}-${CHAT_PROFILE_LIMITS.contextTurns.max}, tool rounds ${CHAT_PROFILE_LIMITS.maxToolRounds.min}-${CHAT_PROFILE_LIMITS.maxToolRounds.max}).`,
    '',
    'propose_profile_update patch keys: name, tagline, systemPrompt, promptSections, greeting, alternateGreetings, authorNote, appearance, modelSlotId (or model_slot), summarySlotId, translationSlotId, suggestSlotId, lorebookIds, blockIds (snake_case also accepted). Engine, tool scopes, tool allowlists, presets and provider/model pairs can never be proposed. Values equal to the current ones are dropped.',
    '',
    `Models (connection · model): ${slots.length ? slots.filter((slot) => slot.providerType !== 'decision_typesafe').map((slot) => `#${slot.id} "${slot.label}"${slot.isDefault ? ' (default)' : ''}`).join(', ') : '(none yet)'}`,
    `Lorebooks: ${lorebooks.length ? lorebooks.map((book) => `#${book.id} "${book.name}"`).join(', ') : '(none)'}`,
    `Shared display blocks: ${blocks.length ? blocks.map((block) => `#${block.id} "${block.name}" (\`${block.block.key}\`)`).join(', ') : '(none)'}`,
    '',
    'Never claim a proposal is saved. Tell the user to check the card and press 저장.',
  ].join('\n');
}

// ------------------------------------------------------------ validation

function limitedText(label: string, value: unknown, maxLength: number, options: { required?: boolean } = {}) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  const trimmed = value.trim();
  if (options.required && !trimmed) throw new Error(`${label} must not be empty.`);
  if (trimmed.length > maxLength) throw new Error(`${label} is too long (${trimmed.length} > ${maxLength} characters).`);
  return trimmed;
}

/** A model row id from a number, a numeric string, a `connection · model` label or a model id (case-insensitive); null clears. */
function resolveSlot(label: string, value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const slots = ModelSlotStore.list().filter((slot) => slot.providerType !== 'decision_typesafe');
  const known = `Known models: ${slots.map((slot) => slot.label).join(', ') || '(none)'}`;
  if (typeof value === 'string') {
    const wanted = value.trim().toLowerCase();
    const byName = slots.find((slot) => slot.label.toLowerCase() === wanted) ?? slots.find((slot) => slot.model.toLowerCase() === wanted);
    if (byName) return byName.id;
  }
  const id = ModelSlotStore.existing(value);
  if (id === null) throw new Error(`${label}: unknown model slot ${JSON.stringify(value)}. ${known}`);
  return id;
}

function resolveIds(label: string, value: unknown, max: number, existing: (ids: number[]) => number[]) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array of ids.`);
  const ids = [...new Set(value.map(Number))];
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error(`${label} must hold positive integer ids.`);
  if (ids.length > max) throw new Error(`${label} holds at most ${max} ids.`);
  const found = new Set(existing(ids));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) throw new Error(`${label}: no such id ${missing.join(', ')}.`);
  return ids;
}

function resolveSections(value: unknown) {
  if (!Array.isArray(value)) throw new Error('promptSections must be an array of { title, content, enabled? }.');
  if (value.length > CHAT_PROFILE_TEXT_LIMITS.sections) throw new Error(`promptSections holds at most ${CHAT_PROFILE_TEXT_LIMITS.sections} sections.`);
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`promptSections[${index}] must be an object.`);
    const record = entry as Record<string, unknown>;
    limitedText(`promptSections[${index}].title`, record.title ?? '', CHAT_PROFILE_TEXT_LIMITS.sectionTitle);
    limitedText(`promptSections[${index}].content`, record.content ?? '', CHAT_PROFILE_TEXT_LIMITS.text);
  });
  return normalizeSections(value);
}

function resolveGreetings(value: unknown) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error('alternateGreetings must be an array of strings.');
  if (value.length > CHAT_PROFILE_TEXT_LIMITS.alternateGreetings) throw new Error(`alternateGreetings holds at most ${CHAT_PROFILE_TEXT_LIMITS.alternateGreetings} entries.`);
  value.forEach((item, index) => limitedText(`alternateGreetings[${index}]`, item, CHAT_PROFILE_TEXT_LIMITS.text));
  return normalizeAlternateGreetings(value);
}

/** Validates one proposable field and returns its normalized value (what the admin REST would store). */
function normalizeProposedField(key: ProposableKey, value: unknown): unknown {
  switch (key) {
    case 'name': return limitedText('name', value, CHAT_PROFILE_TEXT_LIMITS.name, { required: true });
    case 'tagline': return limitedText('tagline', value, CHAT_PROFILE_TEXT_LIMITS.tagline);
    case 'systemPrompt': return limitedText('systemPrompt', value, CHAT_PROFILE_TEXT_LIMITS.text);
    case 'greeting': return limitedText('greeting', value, CHAT_PROFILE_TEXT_LIMITS.text);
    case 'authorNote': return limitedText('authorNote', value, CHAT_PROFILE_TEXT_LIMITS.authorNote);
    case 'appearance': return limitedText('appearance', value, CHAT_PROFILE_TEXT_LIMITS.text);
    case 'promptSections': return resolveSections(value);
    case 'alternateGreetings': return resolveGreetings(value);
    case 'modelSlotId':
    case 'summarySlotId':
    case 'translationSlotId':
    case 'suggestSlotId': return resolveSlot(key, value);
    case 'lorebookIds': return resolveIds(key, value, PROFILE_MAX_LOREBOOKS, (ids) => ChatLorebookStore.existing(ids));
    case 'blockIds': return resolveIds(key, value, PROFILE_MAX_BLOCKS, (ids) => ChatSharedBlockStore.existing(ids));
  }
}

function withoutSectionIds(value: unknown) {
  return Array.isArray(value) ? value.map((section) => ({ title: section.title, content: section.content, kind: section.kind, enabled: section.enabled })) : value;
}

function sameValue(key: ProposableKey, a: unknown, b: unknown) {
  return key === 'promptSections' ? JSON.stringify(withoutSectionIds(a)) === JSON.stringify(withoutSectionIds(b)) : JSON.stringify(a) === JSON.stringify(b);
}

// --------------------------------------------------------------- builders
// Exported so the proposal rules are testable without an MCP transport. Each returns the proposal to store and the
// warnings for the model; the tool handlers store it and answer.

export type DisplayBlockArgs = { name?: string; block: Record<string, unknown>; link_to_profile?: boolean };

export function buildDisplayBlockProposal(args: DisplayBlockArgs, linkProfileId: number | null) {
  const normalized = normalizeBlock(args.block, 0);
  if (!normalized || !normalized.key) throw new Error(BLOCK_KEY_ERROR);
  const { id: _id, ...block } = { ...normalized, enabled: true };
  const warnings: string[] = [];
  const taken = ChatSharedBlockStore.list().find((shared) => shared.block.key === block.key);
  if (taken) warnings.push(`Key "${block.key}" is already used by shared block "${taken.name}" (#${taken.id}); saving would add a second block with the same key.`);
  let exampleOk = false;
  try {
    const parsed: unknown = JSON.parse(block.example);
    exampleOk = Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch { exampleOk = false; }
  if (!exampleOk) warnings.push('example is not a valid JSON object; the chat model sees it as the format and new chats start from it.');
  if (!block.template.trim()) warnings.push('template is empty; the block will render as a plain list of its fields.');
  const proposal: NewChatProposal = {
    kind: 'display_block',
    name: args.name?.trim() || block.key,
    block,
    linkProfileId: args.link_to_profile === false ? null : linkProfileId,
  };
  return { proposal, warnings, block };
}

export type ProfileProposalArgs = {
  name: string;
  tagline?: string;
  system_prompt: string;
  prompt_sections?: unknown[];
  greeting?: string;
  alternate_greetings?: string[];
  author_note?: string;
  appearance?: string;
  model_slot?: string | number;
  lorebook_ids?: number[];
  block_ids?: number[];
  typeface?: 'sans' | 'serif' | 'mono';
};

export function buildProfileProposal(args: ProfileProposalArgs) {
  const input: Record<string, unknown> = {
    name: normalizeProposedField('name', args.name),
    tagline: normalizeProposedField('tagline', args.tagline ?? ''),
    systemPrompt: normalizeProposedField('systemPrompt', args.system_prompt),
    promptSections: normalizeProposedField('promptSections', args.prompt_sections ?? []),
    greeting: normalizeProposedField('greeting', args.greeting ?? ''),
    alternateGreetings: normalizeProposedField('alternateGreetings', args.alternate_greetings ?? []),
    authorNote: normalizeProposedField('authorNote', args.author_note ?? ''),
    appearance: normalizeProposedField('appearance', args.appearance ?? ''),
    modelSlotId: normalizeProposedField('modelSlotId', args.model_slot ?? null),
    lorebookIds: normalizeProposedField('lorebookIds', args.lorebook_ids ?? []),
    blockIds: normalizeProposedField('blockIds', args.block_ids ?? []),
  };
  if (args.typeface) input.style = { typeface: args.typeface };
  const warnings: string[] = [];
  if (input.modelSlotId === null) warnings.push('No model_slot given; the user must pick a model before saving.');
  const proposal: NewChatProposal = { kind: 'profile', input };
  return { proposal, warnings, input };
}

/** Maps snake_case aliases onto the camelCase whitelist; unknown keys are collected for the error. */
export function readProfilePatch(patch: Record<string, unknown>) {
  const mapped = new Map<ProposableKey, unknown>();
  const forbidden: string[] = [];
  for (const [rawKey, value] of Object.entries(patch)) {
    const key = (PROPOSABLE_KEYS as readonly string[]).includes(rawKey) ? rawKey as ProposableKey : KEY_ALIASES[rawKey];
    if (!key) forbidden.push(rawKey);
    else mapped.set(key, value);
  }
  if (forbidden.length) {
    throw new Error(`Not proposable: ${forbidden.join(', ')}. Engine, tool scopes, tool allowlists, presets and provider/model pairs are never proposable. Allowed keys: ${PROPOSABLE_KEYS.join(', ')}.`);
  }
  return mapped;
}

export function buildProfileUpdateProposal(args: { profile_id?: number; patch: Record<string, unknown> }, defaultProfileId: number | undefined) {
  const profileId = args.profile_id ?? defaultProfileId;
  if (profileId === undefined) throw new Error('profile_id is required.');
  const mapped = readProfilePatch(args.patch);
  const current = ChatProfileStore.find(profileId);
  if (!current) throw new Error(`Chat profile not found: ${profileId}`);
  const patch: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  for (const [key, raw] of mapped) {
    const value = normalizeProposedField(key, raw);
    if (sameValue(key, value, current[key])) continue;
    patch[key] = value;
    before[key] = current[key];
  }
  if (Object.keys(patch).length === 0) throw new Error('Nothing would change: every proposed value equals the current one.');
  const proposal: NewChatProposal = { kind: 'profile_update', profileId, profileName: current.name, patch, before };
  return { proposal };
}

// ------------------------------------------------------------- read views

function profileSummary(profile: ChatProfile) {
  return {
    id: profile.id,
    name: profile.name,
    tagline: profile.tagline,
    engine: profile.engine,
    isEnabled: profile.isEnabled,
    model: modelLabelOf(profile),
    modelSlotId: profile.modelSlotId,
    blockIds: profile.blockIds,
    lorebookIds: profile.lorebookIds,
    systemPromptLength: profile.systemPrompt.length,
  };
}

/** The text a chat may read about a profile. No tool grants, allowlists, presets, provider names or images. */
export function profileSetupView(profile: ChatProfile) {
  const { typeface, roleplay, colors, backgroundDim, backgroundBlur, cast, emoticonGroupIds, blocks } = profile.style;
  return {
    id: profile.id,
    name: profile.name,
    tagline: profile.tagline,
    systemPrompt: profile.systemPrompt,
    promptSections: profile.promptSections,
    greeting: profile.greeting,
    alternateGreetings: profile.alternateGreetings,
    authorNote: profile.authorNote,
    appearance: profile.appearance,
    modelSlotId: profile.modelSlotId,
    summarySlotId: profile.summarySlotId,
    translationSlotId: profile.translationSlotId,
    suggestSlotId: profile.suggestSlotId,
    lorebookIds: profile.lorebookIds,
    blockIds: profile.blockIds,
    style: { typeface, roleplay, colors, backgroundDim, backgroundBlur, emoticonGroupIds, cast: cast.map(({ id, name, color }) => ({ id, name, color })), blockKeys: blocks.map((block) => block.key) },
    mcpEnabled: profile.mcpEnabled,
  };
}

function storeProposal(context: McpRequestContext, proposal: NewChatProposal): ChatProposal {
  if (!context.chatContext) throw new Error(NO_CHAT_ERROR);
  return ChatProposalStore.add(context.chatContext, proposal);
}

function profileAssetsGuide(context: McpRequestContext) {
  const profile = context.chatContext ? ChatProfileStore.find(context.chatContext.profileId) : null;
  return JSON.stringify({
    instruction: 'Use propose_profile_assets(action=create) for one reviewed batch. Emotion names are prompt-preset item descriptions. Slots are separate reference/background/full/avatar prompts. A reference slot blocks followers until the user chooses a successful candidate. After choices, propose_profile_assets(action=apply, batch_id=...) requires a second approval. No jobs or profile changes happen from proposing alone.',
    profile: profile ? { id: profile.id, name: profile.name, appearance: profile.appearance, hasReference: Boolean(profile.referenceHash) } : null,
    generationPresets: ChatGenerationPresetStore.list().map((preset) => {
      const workflow = preset.comfyui ? resolvePresetWorkflow(preset.comfyui).workflow : null;
      return { id: preset.id, name: preset.name, kind: preset.kind, instruction: preset.instruction, ...(preset.comfyui ? { referenceField: preset.comfyui.referenceField, promptFields: workflow ? parseMcpMarkedFields(workflow).filter((field) => preset.comfyui!.exposedFieldIds.includes(field.id) && ['text', 'textarea'].includes(field.type)).map((field) => ({ id: field.id, label: field.label })) : [] } : {}) };
    }),
    expressionPresets: PromptPresetModel.findAllWithItems().map((preset) => ({ id: preset.id, name: preset.name, items: preset.items.map(({ description, value }) => ({ description, value })) })),
  }, null, 2);
}

/** Chat setup tools (scope `configure`, chat accounts with admin rights only): read the setup, propose changes as cards. */
export function registerChatSetupTools(server: McpServer, context: McpRequestContext): void {
  server.tool('get_asset_batch', 'Read a character asset batch: each slot with its status (waiting, queued, processing, completed, failed, blocked), chosen candidate and candidates with review results (expression match, hair/eye match with the reference, judge pick). Without batch_id: the newest batch of the profile (default: your speaking profile). Use it to follow generation and choose candidates for propose_profile_assets(action=apply, picks).', {
    batch_id: z.number().int().positive().optional(), profile_id: z.number().int().positive().optional(),
  }, async ({ batch_id, profile_id }) => {
    try {
      if (!context.chatContext || !context.requester) throw new Error(NO_CHAT_ERROR);
      const profileId = profile_id ?? context.chatContext.profileId;
      const id = batch_id ?? latestChatAssetBatchId(profileId);
      if (!id) return textResult({ batch: null, note: 'This profile has no asset batch yet.' });
      const batch = getChatAssetBatch(context.requester, id, batch_id ? undefined : profileId);
      return textResult({
        id: batch.id, profileId: batch.profileId, createdAt: batch.createdAt,
        slots: batch.slots.map((slot) => ({
          slotKey: slot.slotKey, kind: slot.kind, status: slot.status, chosen: slot.chosenHash,
          candidates: slot.attempts.flatMap((attempt) => attempt.candidates.map((candidate) => ({
            compositeHash: candidate.compositeHash,
            ...(candidate.review ? { review: { expressionMatches: candidate.review.expression?.matches ?? null, hairMatches: candidate.review.hair.matches, eyesMatches: candidate.review.eyes.matches, judge: candidate.review.judge ?? null, similarTo: candidate.review.similarSlots.map((entry) => entry.slotKey) } } : {}),
          }))).slice(-8),
          failure: slot.attempts.at(-1)?.failureCode ?? null,
        })),
      });
    } catch (error) { return errorResult(error); }
  });
  server.tool('propose_profile_assets', 'Propose character asset generation (action=create), or application of already chosen batch candidates (action=apply), as separate approval cards. Read get_chat_setup_guide(topic=profile_assets) first for real preset IDs and ComfyUI prompt fields. Administrators must approve each card; this tool starts no jobs and changes no profile or group. For create, input uses presetId, expressionPresetId (prompt preset descriptions are emotion keywords), optional expressions and slots; ComfyUI needs promptField. For apply, give batch_id. Default target is your speaking profile.', {
    action: z.enum(['create', 'apply']).optional(), profile_id: z.number().int().positive().optional(),
    input: chatAssetBatchInputSchema.omit({ idempotencyKey: true }).optional(), batch_id: z.number().int().positive().optional(),
    picks: z.record(z.string().max(40), z.string().max(200)).optional().describe('apply only: slotKey → compositeHash of a candidate from get_asset_batch to choose for that slot.'),
    avatarCrop: z.object({ x: z.number(), y: z.number(), scale: z.number().positive() }).nullable().optional(),
  }, async (args) => {
    try {
      if (!context.chatContext || !context.requester) throw new Error(NO_CHAT_ERROR);
      const proposal = proposeProfileAssets(context.requester, context.chatContext, args);
      return textResult({ proposalId: proposal.id, note: 'Review and approve this card; creation and application need separate approvals.' }, { structuredContent: { proposal } });
    } catch (error) { return errorResult(error); }
  });
  server.tool(
    'get_chat_setup_guide',
    'Read the reference for writing a chat display block (status card: JSON shape, limits, template syntax, runtime behavior) or a chat profile (fields, limits, placeholders, available model slots, lorebooks and shared blocks). Read it once before proposing.',
    { topic: z.enum(['display_block', 'profile', 'profile_assets']) },
    async ({ topic }) => {
      try {
        return { content: [{ type: 'text' as const, text: topic === 'display_block' ? DISPLAY_BLOCK_GUIDE : topic === 'profile_assets' ? profileAssetsGuide(context) : profileGuide() }] };
      } catch (error) { return errorResult(error); }
    },
  );

  server.tool(
    'list_chat_profiles',
    'List the chat profiles (characters) with id, name, tagline, engine, enabled flag, model label, linked block and lorebook ids, and system prompt length.',
    {},
    async () => {
      try { return textResult(ChatProfileStore.list().map(profileSummary)); } catch (error) { return errorResult(error); }
    },
  );

  server.tool(
    'get_chat_profile',
    'Read the text setup of a chat profile in full: prompts, sections, greetings, author note, model slots, linked lorebooks and blocks, style. Defaults to the profile you are speaking as. Tool grants and connection details are never included.',
    { profile_id: z.number().int().positive().optional() },
    async ({ profile_id }) => {
      try {
        const id = profile_id ?? context.chatContext?.profileId;
        if (id === undefined) throw new Error('profile_id is required.');
        const profile = ChatProfileStore.find(id);
        if (!profile) throw new Error(`Chat profile not found: ${id}`);
        return textResult(profileSetupView(profile));
      } catch (error) { return errorResult(error); }
    },
  );

  server.tool(
    'list_display_blocks',
    'List the shared display blocks (status cards) with id, name, key, field names, summary template and the profiles that link them.',
    {},
    async () => {
      try {
        return textResult(ChatSharedBlockStore.list().map((shared) => ({
          id: shared.id,
          name: shared.name,
          key: shared.block.key,
          fieldNames: shared.block.fields.map((field) => field.name).filter(Boolean),
          summary: shared.block.summary,
          profiles: shared.profiles,
        })));
      } catch (error) { return errorResult(error); }
    },
  );

  server.tool(
    'get_display_block',
    'Read one shared display block in full (key, instruction, example, template, css, rules, summary, field rules).',
    { block_id: z.number().int().positive() },
    async ({ block_id }) => {
      try {
        const shared = ChatSharedBlockStore.find(block_id);
        if (!shared) throw new Error(`Display block not found: ${block_id}`);
        const { id: _id, ...block } = shared.block;
        return textResult({ id: shared.id, name: shared.name, block, profiles: shared.profiles });
      } catch (error) { return errorResult(error); }
    },
  );

  server.tool(
    'propose_display_block',
    'Propose a new shared display block (status card) as a card under your reply. Nothing is saved until the user presses 저장. Read get_chat_setup_guide(display_block) first. The block is validated and normalized; warnings are returned.',
    {
      name: z.string().optional().describe('Name of the shared block (defaults to its key)'),
      block: z.record(z.string(), z.unknown()).describe('{ key, instruction, example, template, css, rules, summary, fields }'),
      link_to_profile: z.boolean().default(true).describe('Offer to link the saved block to the profile you speak as'),
    },
    async (args) => {
      try {
        if (!context.chatContext) throw new Error(NO_CHAT_ERROR);
        const built = buildDisplayBlockProposal(args, context.chatContext.profileId);
        const proposal = storeProposal(context, built.proposal);
        return textResult({ proposalId: proposal.id, block: built.block, warnings: built.warnings, note: PROPOSAL_NOTE }, { structuredContent: { proposal } });
      } catch (error) { return errorResult(error); }
    },
  );

  server.tool(
    'propose_chat_profile',
    'Propose a NEW chat profile as a card under your reply. Nothing is saved until the user presses 저장. Read get_chat_setup_guide(profile) first for limits, model slots, lorebooks and blocks.',
    {
      name: z.string(),
      tagline: z.string().optional(),
      system_prompt: z.string(),
      prompt_sections: z.array(z.object({ title: z.string(), content: z.string(), enabled: z.boolean().optional(), kind: z.enum(['text', 'dialogue']).optional() })).optional(),
      greeting: z.string().optional(),
      alternate_greetings: z.array(z.string()).optional(),
      author_note: z.string().optional(),
      appearance: z.string().optional().describe('Look as image-prompt tags; used for character image generation'),
      model_slot: z.union([z.string(), z.number()]).optional().describe('Model slot name or id'),
      lorebook_ids: z.array(z.number().int().positive()).optional(),
      block_ids: z.array(z.number().int().positive()).optional(),
      typeface: z.enum(['sans', 'serif', 'mono']).optional(),
    },
    async (args) => {
      try {
        if (!context.chatContext) throw new Error(NO_CHAT_ERROR);
        const built = buildProfileProposal(args);
        const proposal = storeProposal(context, built.proposal);
        return textResult({ proposalId: proposal.id, input: built.input, warnings: built.warnings, note: PROPOSAL_NOTE }, { structuredContent: { proposal } });
      } catch (error) { return errorResult(error); }
    },
  );

  server.tool(
    'propose_profile_update',
    'Propose changes to an existing chat profile (default: the one you speak as) as a before/after card. Nothing is saved until the user presses 저장. patch accepts only: name, tagline, systemPrompt, promptSections, greeting, alternateGreetings, authorNote, appearance, modelSlotId (or model_slot), summarySlotId, translationSlotId, suggestSlotId, lorebookIds, blockIds. Engine, tool grants, allowlists, presets and provider/model pairs are never proposable.',
    {
      profile_id: z.number().int().positive().optional(),
      patch: z.record(z.string(), z.unknown()),
    },
    async (args) => {
      try {
        if (!context.chatContext) throw new Error(NO_CHAT_ERROR);
        const built = buildProfileUpdateProposal(args, context.chatContext.profileId);
        const proposal = storeProposal(context, built.proposal);
        return textResult({ proposalId: proposal.id, profileId: args.profile_id ?? context.chatContext.profileId, changed: Object.keys((proposal as { patch?: Record<string, unknown> }).patch ?? {}), note: PROPOSAL_NOTE }, { structuredContent: { proposal } });
      } catch (error) { return errorResult(error); }
    },
  );
}
