import type { McpServer } from '@modelcontextprotocol/server';
import { CHAT_TRANSLATION_LANGUAGES, isChatTranslationLanguage, type ChatProposal } from '@conai/shared';
import { z } from 'zod';
import { ChatProposalStore, type NewChatProposal } from '../../services/codex-chat/chatProposals';
import { ChatProfileStore, CHAT_PROFILE_LIMITS, CHAT_PROFILE_TEXT_LIMITS, normalizeAlternateGreetings, normalizeSections, normalizeProfileScalarField, validateProfileText as limitedText, type ChatProfile } from '../../services/codex-chat/chatProfiles';
import { normalizeGreetingPosition, normalizeOpeningHistory } from '../../services/codex-chat/chatOpeningHistory';
import { ChatSharedBlockStore, PROFILE_MAX_BLOCKS } from '../../services/codex-chat/chatDisplayBlocks';
import { ChatLorebookStore, LORE_RECURSION_MAX_DEPTH, PROFILE_MAX_LOREBOOKS } from '../../services/codex-chat/chatLorebook';
import { ChatJudgePresetStore } from '../../services/codex-chat/chatJudgePresets';
import { assertLinkedFiles, describeLinkedFiles, normalizeLinkedFiles, type LinkedFileLink } from '../../services/codex-chat/chatLinkedFiles';
import { RatingScoreModel } from '../../models/RatingScore';
import { requireFileStoreOwner } from '../../services/fileStoreAccess';
import { CHAT_FEATURES_GUIDE } from './chatSettingsTools';
import { LLM_CONNECTION_TYPES, MODEL_CONNECTION_TYPES, ModelSlotStore } from '../../services/codex-chat/modelSlots';
import { modelLabelOf } from '../../services/codex-chat/chatModelRoles';
import { normalizeBlock } from '../../services/codex-chat/chatStyle';
import type { McpRequestContext } from '../context';
import { proposeProfileAssets } from '../../services/codex-chat/chatAssetProposals';
import { chatAssetBatchInputSchema, getChatAssetBatch, latestChatAssetBatchId } from '../../services/codex-chat/chatAssetBatches';
import { ChatGenerationPresetStore, resolvePresetWorkflow } from '../../services/codex-chat/chatGenerationPresets';
import { PromptPresetModel } from '../../models/PromptPreset';
import { parseMcpMarkedFields } from '../../services/comfyui/comfyWorkflowInputs';
import { errorResult, textResult } from '../toolResults';

const BLOCK_KEY_ERROR = 'block.key must match /^[a-z][a-z0-9_-]{0,31}$/';
const PROPOSAL_NOTE = 'The card is shown to the user; nothing is saved until they press 저장.';
const NO_CHAT_ERROR = 'Proposals need an active chat reply.';

/**
 * Profile fields a chat may propose changing. Grants stay out: engine, tool scopes and allowlists, the page assistant,
 * who may chat with it, generation presets and provider/model pairs are set by hand in the editor.
 */
const PROPOSABLE_KEYS = [
  'name', 'tagline', 'systemPrompt', 'promptSections', 'greeting', 'alternateGreetings', 'openingHistory', 'greetingPosition', 'authorNote', 'appearance',
  'modelSlotId', 'summarySlotId', 'translationSlotId', 'suggestSlotId', 'judgeSlotId', 'judgePresetId', 'lorebookIds', 'blockIds',
  'temperature', 'maxTokens', 'contextTurns', 'contextTokens', 'toolOutputLimit',
  'summaryEnabled', 'summaryTriggerTurns', 'summaryPrompt',
  'translationModelLanguage', 'translationDisplayLanguage', 'translationInstructions',
  'suggestEnabled', 'suggestProfileId',
  'visionEnabled', 'contentRatingMode', 'contentRatingTierId',
  'loreRecursionDepth', 'allowLoreProposals', 'agentEnabled', 'agentDescription', 'linkedFiles',
] as const;
type ProposableKey = typeof PROPOSABLE_KEYS[number];

const KEY_ALIASES: Record<string, ProposableKey> = {
  system_prompt: 'systemPrompt',
  prompt_sections: 'promptSections',
  alternate_greetings: 'alternateGreetings',
  opening_history: 'openingHistory',
  greeting_position: 'greetingPosition',
  author_note: 'authorNote',
  model_slot: 'modelSlotId',
  model_slot_id: 'modelSlotId',
  summary_slot: 'summarySlotId',
  summary_slot_id: 'summarySlotId',
  translation_slot: 'translationSlotId',
  translation_slot_id: 'translationSlotId',
  suggest_slot: 'suggestSlotId',
  suggest_slot_id: 'suggestSlotId',
  judge_slot: 'judgeSlotId',
  judge_slot_id: 'judgeSlotId',
  judge_preset_id: 'judgePresetId',
  lorebook_ids: 'lorebookIds',
  block_ids: 'blockIds',
  max_tokens: 'maxTokens',
  context_turns: 'contextTurns',
  context_tokens: 'contextTokens',
  tool_output_limit: 'toolOutputLimit',
  summary_enabled: 'summaryEnabled',
  summary_trigger_turns: 'summaryTriggerTurns',
  summary_prompt: 'summaryPrompt',
  translation_model_language: 'translationModelLanguage',
  translation_display_language: 'translationDisplayLanguage',
  translation_instructions: 'translationInstructions',
  suggest_enabled: 'suggestEnabled',
  suggest_profile_id: 'suggestProfileId',
  vision_enabled: 'visionEnabled',
  content_rating_mode: 'contentRatingMode',
  content_rating_tier_id: 'contentRatingTierId',
  lore_recursion_depth: 'loreRecursionDepth',
  allow_lore_proposals: 'allowLoreProposals',
  agent_enabled: 'agentEnabled',
  agent_description: 'agentDescription',
  linked_files: 'linkedFiles',
};

const NOT_PROPOSABLE = 'Engine, tool scopes, tool allowlists, the page assistant, allowed groups, generation presets and provider/model pairs are never proposable (the user sets them in the profile editor).';
const LANGUAGE_IDS = CHAT_TRANSLATION_LANGUAGES.map((language) => language.id);

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
  const slots = ModelSlotStore.list({ usage: false });
  const lorebooks = ChatLorebookStore.list();
  const blocks = ChatSharedBlockStore.list();
  const judges = ChatJudgePresetStore.list();
  const tiers = RatingScoreModel.getAllTiers();
  const profiles = ChatProfileStore.list();
  const limits = CHAT_PROFILE_TEXT_LIMITS;
  return [
    'CHAT PROFILE reference',
    '',
    'A profile is a character/persona the user chats with. propose_chat_profile proposes a NEW profile; propose_profile_update proposes changes to an existing one. Both only show a card; the user saves it with the 저장 button.',
    '',
    'Fields (propose_chat_profile):',
    `- name (required, max ${limits.name}), tagline (max ${limits.tagline}, one-line intro shown on the profile card).`,
    `- system_prompt (max ${limits.text}): instructions every chat starts with. Use {{char}} for the profile name and {{user}} for the user's persona name.`,
    `- prompt_sections (max ${limits.sections}): [{ "title": "World", "content": "...", "enabled": true }]. Title max ${limits.sectionTitle}, content max ${limits.text}. Plain sections are appended after the system prompt as "## title". Optional kind "dialogue" marks example conversation (lines starting with {{user}}: / {{char}}: become example turns). Kind "post" goes after the latest message (a character card's post-history instructions).`,
    `- opening_history (max ${limits.openingHistory}): [{ "role": "user" | "assistant", "content": "..." }], content max ${limits.text}. The opening of every new chat, saved as real messages that scroll out and get summarized like other conversation.`,
    `- greeting (max ${limits.text}) and alternate_greetings (max ${limits.alternateGreetings}): one greeting is picked at random and saved as an assistant message, with the others as variants. greeting_position (integer, default 0): insert it after this many opening_history messages; clamped to the history's length.`,
    `- author_note (max ${limits.authorNote}): scene direction added near the end of every request.`,
    `- appearance (max ${limits.text}): the character's look as image-prompt tags (hair, eyes, outfit…). Character image generation puts it in front of every asset prompt.`,
    '- model_slot: model id or `connection · model` label (the chat model). Omit to start on the default model.',
    `- lorebook_ids (max ${PROFILE_MAX_LOREBOOKS}) and block_ids (max ${PROFILE_MAX_BLOCKS}): link existing shared lorebooks / display blocks by id.`,
    '- typeface: "sans" | "serif" | "mono".',
    '- settings: any other key below, e.g. {"translationSlotId": 3, "translationDisplayLanguage": "ko", "summaryEnabled": true}.',
    '',
    'Other settings (propose_profile_update patch keys, or propose_chat_profile settings; snake_case also accepted). Numbers outside the range are clamped as the editor does; null clears where noted.',
    '- Models per role: modelSlotId (chat), summarySlotId, translationSlotId (null: no translation), suggestSlotId (null: the chat model), judgeSlotId (judge model, TypeSafe rows allowed; null: the judge preset\'s own) — a model id, `connection · model` label or row id.',
    '- judgePresetId: a judge preset that steers each turn (null: no judge). Editor › 모델 › 역할 › 판단.',
    `- temperature (${CHAT_PROFILE_LIMITS.temperature.min}-${CHAT_PROFILE_LIMITS.temperature.max}, null: server default), maxTokens (${CHAT_PROFILE_LIMITS.maxTokens.min}-${CHAT_PROFILE_LIMITS.maxTokens.max}, null: server default; a ceiling, cut to the room left), contextTurns (${CHAT_PROFILE_LIMITS.contextTurns.min}-${CHAT_PROFILE_LIMITS.contextTurns.max}), contextTokens (${CHAT_PROFILE_LIMITS.contextTokens.min}-${CHAT_PROFILE_LIMITS.contextTokens.max}, null: no token cap), toolOutputLimit (${CHAT_PROFILE_LIMITS.toolOutputLimit.min}-${CHAT_PROFILE_LIMITS.toolOutputLimit.max} characters of one tool result). The tool round limit is app-wide (Settings › 채팅 › 자원 › 도구 사용), not a profile field.`,
    `- summaryEnabled (true/false), summaryTriggerTurns (${CHAT_PROFILE_LIMITS.summaryTriggerTurns.min}-${CHAT_PROFILE_LIMITS.summaryTriggerTurns.max}: fold older turns once this many left the window), summaryPrompt (max ${limits.summaryPrompt}, empty: the default). Codex profiles keep their own context (no summary).`,
    `- With a translation model: translationModelLanguage (what the chat model reads and writes) and translationDisplayLanguage (what the user writes and reads), each one of ${LANGUAGE_IDS.join(' | ')}; translationInstructions (max ${limits.translationInstructions}): voice, forms of address and a glossary for translating replies.`,
    '- suggestEnabled: the composer\'s reply suggestions button; suggestProfileId: a chat profile that writes them with its own model and prompt (null: the suggest role\'s model).',
    '- visionEnabled: the model sees images (Codex always does). contentRatingMode "model" (follow the chat model row\'s ceiling; API LLM only) or "custom" with contentRatingTierId (the highest rating tier the model is shown; null: no ceiling).',
    `- loreRecursionDepth (0-${LORE_RECURSION_MAX_DEPTH}): how many times chosen lore entries\' text is scanned for more entries (0: off). allowLoreProposals: the model may save_lore.`,
    `- agentEnabled (default false): other chat profiles may delegate work to this profile. agentDescription (max ${limits.agentDescription}): short description shown in call_agent's agent list.`,
    '- linkedFiles: [{ "id": "<32-hex file store id>", "write": false }]: folders, text files, PDFs or XLSX documents (PDF/XLSX content is read-only) in the shared file store every chat of this profile can open (write: may write there); not inside 로어북/.',
    NOT_PROPOSABLE,
    'Where to find those by hand (profile editor tabs 캐릭터 · 외형 · 모델 · 기억 · 도구 · 꾸미기): engine and model params in 모델; tool scopes, tool list, tool presets and the 페이지 어시스턴트 switch in 도구; generation presets and character images in 외형 (images: propose_profile_assets); who may chat with it in the editor header\'s access menu; colours and blocks in 꾸미기.',
    'Values equal to the current ones are dropped.',
    '',
    `Representative models (route to a model; picking one follows it when it is re-pointed; 대화 is the default): ${slots.filter((slot) => slot.kind === 'route').map((slot) => `#${slot.id} "${slot.label}" → ${slot.model || '(none)'}`).join(', ') || '(none)'}`,
    `Models (connection · model): ${slots.some((slot) => slot.kind === 'model') ? slots.filter((slot) => slot.kind === 'model' && slot.providerType !== 'decision_typesafe').map((slot) => `#${slot.id} "${slot.label}"`).join(', ') : '(none yet)'}`,
    `Judge models (TypeSafe): ${slots.filter((slot) => slot.kind === 'model' && slot.providerType === 'decision_typesafe').map((slot) => `#${slot.id} "${slot.label}"`).join(', ') || '(none)'}`,
    `Judge presets: ${judges.length ? judges.map((preset) => `#${preset.id} "${preset.name}"`).join(', ') : '(none)'}`,
    `Rating tiers (lowest first): ${tiers.length ? tiers.map((tier) => `#${tier.id} "${tier.tier_name}"`).join(', ') : '(none)'}`,
    `Profiles: ${profiles.map((profile) => `#${profile.id} "${profile.name}"`).join(', ') || '(none)'}`,
    `Lorebooks: ${lorebooks.length ? lorebooks.map((book) => `#${book.id} "${book.name}"`).join(', ') : '(none)'}`,
    `Shared display blocks: ${blocks.length ? blocks.map((block) => `#${block.id} "${block.name}" (\`${block.block.key}\`)`).join(', ') : '(none)'}`,
    '',
    'Never claim a proposal is saved. Tell the user to check the card and press 저장.',
  ].join('\n');
}

// ------------------------------------------------------------ validation

/** A model row id from a number, a numeric string, a `connection · model` label or a model id (case-insensitive); null clears. */
function resolveSlot(label: string, value: unknown, options: { judge?: boolean } = {}): number | null {
  if (value === null || value === undefined || value === '') return null;
  // A judge may use a TypeSafe decision model as well; every other role needs an LLM row.
  const slots = ModelSlotStore.list({ usage: false }).filter((slot) => options.judge || slot.providerType !== 'decision_typesafe');
  const known = `Known models: ${slots.map((slot) => slot.label).join(', ') || '(none)'}`;
  if (typeof value === 'string') {
    const wanted = value.trim().toLowerCase();
    const byName = slots.find((slot) => slot.label.toLowerCase() === wanted) ?? slots.find((slot) => slot.kind === 'model' && slot.model.toLowerCase() === wanted);
    if (byName) return ModelSlotStore.checked(byName.id, options.judge ? MODEL_CONNECTION_TYPES : LLM_CONNECTION_TYPES);
  }
  const id = ModelSlotStore.existing(value);
  if (id === null) throw new Error(`${label}: unknown model slot ${JSON.stringify(value)}. ${known}`);
  return ModelSlotStore.checked(id, options.judge ? MODEL_CONNECTION_TYPES : LLM_CONNECTION_TYPES);
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

function resolveOpeningHistory(value: unknown) {
  if (!Array.isArray(value)) throw new Error('openingHistory must be an array of { role, content }.');
  if (value.length > CHAT_PROFILE_TEXT_LIMITS.openingHistory) throw new Error(`openingHistory holds at most ${CHAT_PROFILE_TEXT_LIMITS.openingHistory} entries.`);
  value.forEach((entry, index) => {
    if (!entry || (entry.role !== 'user' && entry.role !== 'assistant')) throw new Error(`openingHistory[${index}].role must be "user" or "assistant".`);
    limitedText(`openingHistory[${index}].content`, entry.content, CHAT_PROFILE_TEXT_LIMITS.text);
  });
  return normalizeOpeningHistory(value);
}

function translationLanguage(label: string, value: unknown) {
  if (!isChatTranslationLanguage(value)) throw new Error(`${label} must be one of ${LANGUAGE_IDS.join(', ')}.`);
  return value;
}

function ratingTier(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const id = Number(value);
  const tiers = RatingScoreModel.getAllTiers();
  if (!tiers.some((tier) => tier.id === id)) throw new Error(`contentRatingTierId: unknown rating tier ${JSON.stringify(value)}. Tiers: ${tiers.map((tier) => `#${tier.id} "${tier.tier_name}"`).join(', ') || '(none)'}.`);
  return id;
}

function judgePreset(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const id = ChatJudgePresetStore.existing(Number(value));
  if (id === null) throw new Error(`judgePresetId: no such judge preset ${JSON.stringify(value)}. Presets: ${ChatJudgePresetStore.list().map((preset) => `#${preset.id} "${preset.name}"`).join(', ') || '(none)'}.`);
  return id;
}

function suggestProfile(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const profile = ChatProfileStore.find(Number(value));
  if (!profile) throw new Error(`suggestProfileId: no such chat profile ${JSON.stringify(value)} (list_chat_profiles lists them).`);
  return profile.id;
}

/**
 * New links must point to supported shared files or folders outside lorebooks; existing profile links pass through.
 */
function proposedLinkedFiles(value: unknown, owner: string | null, kept: LinkedFileLink[]) {
  if (!Array.isArray(value)) throw new Error('linkedFiles must be a list of { id, write }.');
  const links = normalizeLinkedFiles(value);
  if (links.length !== value.length) throw new Error('linkedFiles: each item needs the 32-character id of a file store folder or text file (list_files / search_files show ids), at most 20, no repeats.');
  const added = links.filter((link) => !kept.some((item) => item.id === link.id));
  if (added.length && !owner) throw new Error('linkedFiles: linking needs a chat account with the file store.');
  return owner ? assertLinkedFiles(owner, links, kept) : links;
}

/** What validating a field may need beyond its value: the proposer's file store and the profile's current links. */
type FieldContext = { owner?: string | null; current?: ChatProfile | null; openingHistory?: ChatProfile['openingHistory'] };

/** Validates one proposable field and returns its normalized value (what the admin REST would store). */
function normalizeProposedField(key: ProposableKey, value: unknown, fieldContext: FieldContext = {}): unknown {
  switch (key) {
    case 'name':
    case 'tagline':
    case 'agentDescription':
    case 'systemPrompt':
    case 'greeting':
    case 'authorNote':
    case 'appearance':
    case 'summaryPrompt':
    case 'translationInstructions': return normalizeProfileScalarField(key, value);
    case 'promptSections': return resolveSections(value);
    case 'alternateGreetings': return resolveGreetings(value);
    case 'openingHistory': return resolveOpeningHistory(value);
    case 'greetingPosition': return normalizeGreetingPosition(value, (fieldContext.openingHistory ?? fieldContext.current?.openingHistory ?? []).length);
    case 'modelSlotId':
    case 'summarySlotId':
    case 'translationSlotId':
    case 'suggestSlotId': return resolveSlot(key, value);
    case 'judgeSlotId': return resolveSlot(key, value, { judge: true });
    case 'judgePresetId': return judgePreset(value);
    case 'lorebookIds': return resolveIds(key, value, PROFILE_MAX_LOREBOOKS, (ids) => ChatLorebookStore.existing(ids));
    case 'blockIds': return resolveIds(key, value, PROFILE_MAX_BLOCKS, (ids) => ChatSharedBlockStore.existing(ids));
    case 'temperature':
    case 'maxTokens':
    case 'contextTurns':
    case 'contextTokens':
    case 'toolOutputLimit':
    case 'summaryTriggerTurns':
    case 'loreRecursionDepth':
    case 'summaryEnabled':
    case 'suggestEnabled':
    case 'visionEnabled':
    case 'agentEnabled':
    case 'allowLoreProposals': return normalizeProfileScalarField(key, value);
    case 'translationModelLanguage':
    case 'translationDisplayLanguage': return translationLanguage(key, value);
    case 'suggestProfileId': return suggestProfile(value);
    case 'contentRatingMode':
      if (value !== 'model' && value !== 'custom') throw new Error('contentRatingMode must be "model" or "custom".');
      return value;
    case 'contentRatingTierId': return ratingTier(value);
    case 'linkedFiles': return proposedLinkedFiles(value, fieldContext.owner ?? null, fieldContext.current?.linkedFiles ?? []);
  }
}

/** How a value with an id in it reads on the card; null where the raw value already reads well. */
function displayValue(key: ProposableKey, value: unknown, owner: string | null): string | null {
  const none = '—';
  if (key === 'contentRatingTierId') return value === null ? '제한 없음' : RatingScoreModel.getAllTiers().find((tier) => tier.id === value)?.tier_name ?? `#${String(value)}`;
  if (key === 'judgePresetId') return value === null ? none : ChatJudgePresetStore.find(Number(value))?.name ?? `#${String(value)}`;
  if (key === 'suggestProfileId') return value === null ? none : ChatProfileStore.find(Number(value))?.name ?? `#${String(value)}`;
  if (key === 'linkedFiles') {
    const links = Array.isArray(value) ? value as LinkedFileLink[] : [];
    if (!links.length) return none;
    return owner ? describeLinkedFiles(owner, links, 'profile').map((view) => `${view.name}${view.kind === 'folder' ? '/' : ''}${view.write ? ' (쓰기)' : ''}`).join(', ') : `${links.length}`;
  }
  return null;
}

/** The proposer's execution key, when the account may access the shared file store. */
function proposerFileOwner(context: McpRequestContext): string | null {
  try { return context.requester ? requireFileStoreOwner(context.requester) : null; } catch { return null; }
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
  opening_history?: ChatProfile['openingHistory'];
  greeting_position?: number;
  author_note?: string;
  appearance?: string;
  model_slot?: string | number;
  lorebook_ids?: number[];
  block_ids?: number[];
  typeface?: 'sans' | 'serif' | 'mono';
  /** Any other proposable key (camelCase or snake_case), as in a profile update patch. */
  settings?: Record<string, unknown>;
};

/** The top-level arguments of propose_chat_profile; `settings` may not repeat them. */
const PROFILE_ARG_KEYS = new Set<ProposableKey>(['name', 'tagline', 'systemPrompt', 'promptSections', 'greeting', 'alternateGreetings', 'openingHistory', 'greetingPosition', 'authorNote', 'appearance', 'modelSlotId', 'lorebookIds', 'blockIds']);

export function buildProfileProposal(args: ProfileProposalArgs, owner: string | null = null) {
  const openingHistory = resolveOpeningHistory(args.opening_history ?? []);
  const input: Record<string, unknown> = {
    name: normalizeProposedField('name', args.name),
    tagline: normalizeProposedField('tagline', args.tagline ?? ''),
    systemPrompt: normalizeProposedField('systemPrompt', args.system_prompt),
    promptSections: normalizeProposedField('promptSections', args.prompt_sections ?? []),
    greeting: normalizeProposedField('greeting', args.greeting ?? ''),
    alternateGreetings: normalizeProposedField('alternateGreetings', args.alternate_greetings ?? []),
    openingHistory,
    greetingPosition: normalizeProposedField('greetingPosition', args.greeting_position ?? 0, { openingHistory }),
    authorNote: normalizeProposedField('authorNote', args.author_note ?? ''),
    appearance: normalizeProposedField('appearance', args.appearance ?? ''),
    modelSlotId: normalizeProposedField('modelSlotId', args.model_slot ?? null),
    lorebookIds: normalizeProposedField('lorebookIds', args.lorebook_ids ?? []),
    blockIds: normalizeProposedField('blockIds', args.block_ids ?? []),
  };
  if (args.typeface) input.style = { typeface: args.typeface };
  for (const [key, raw] of readProfilePatch(args.settings ?? {})) {
    if (PROFILE_ARG_KEYS.has(key)) throw new Error(`settings.${key}: give it as its own argument instead.`);
    input[key] = normalizeProposedField(key, raw, { owner, current: null });
  }
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
    throw new Error(`Not proposable: ${forbidden.join(', ')}. ${NOT_PROPOSABLE} Allowed keys: ${PROPOSABLE_KEYS.join(', ')}.`);
  }
  return mapped;
}

export function buildProfileUpdateProposal(args: { profile_id?: number; patch: Record<string, unknown> }, defaultProfileId: number | undefined, owner: string | null = null) {
  const profileId = args.profile_id ?? defaultProfileId;
  if (profileId === undefined) throw new Error('profile_id is required.');
  const mapped = readProfilePatch(args.patch);
  const current = ChatProfileStore.find(profileId);
  if (!current) throw new Error(`Chat profile not found: ${profileId}`);
  const openingHistory = mapped.has('openingHistory') ? resolveOpeningHistory(mapped.get('openingHistory')) : current.openingHistory;
  // Shrinking the history may also move the greeting, even when the patch leaves its position implicit.
  if (mapped.has('openingHistory') && !mapped.has('greetingPosition')) mapped.set('greetingPosition', current.greetingPosition);
  const patch: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  const display: Record<string, { before: string; after: string }> = {};
  for (const [key, raw] of mapped) {
    const value = key === 'openingHistory' ? openingHistory : normalizeProposedField(key, raw, { owner, current, openingHistory });
    if (sameValue(key, value, current[key])) continue;
    patch[key] = value;
    before[key] = current[key];
    const shown = displayValue(key, value, owner);
    if (shown !== null) display[key] = { before: displayValue(key, current[key], owner) ?? '—', after: shown };
  }
  if (Object.keys(patch).length === 0) throw new Error('Nothing would change: every proposed value equals the current one.');
  const proposal: NewChatProposal = { kind: 'profile_update', profileId, profileName: current.name, patch, before, ...(Object.keys(display).length ? { display } : {}) };
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

/**
 * The text a chat may read about a profile. No tool grants, allowlists, presets, provider names or images; the
 * engine and the page assistant switch are shown read-only so the chat can say where they are set.
 */
export function profileSetupView(profile: ChatProfile, owner: string | null = null) {
  const { typeface, roleplay, colors, backgroundDim, backgroundBlur, cast, emoticonGroupIds, blocks } = profile.style;
  return {
    id: profile.id,
    name: profile.name,
    tagline: profile.tagline,
    systemPrompt: profile.systemPrompt,
    promptSections: profile.promptSections,
    greeting: profile.greeting,
    alternateGreetings: profile.alternateGreetings,
    openingHistory: profile.openingHistory,
    greetingPosition: profile.greetingPosition,
    authorNote: profile.authorNote,
    appearance: profile.appearance,
    modelSlotId: profile.modelSlotId,
    summarySlotId: profile.summarySlotId,
    translationSlotId: profile.translationSlotId,
    suggestSlotId: profile.suggestSlotId,
    judgeSlotId: profile.judgeSlotId,
    judgePresetId: profile.judgePresetId,
    lorebookIds: profile.lorebookIds,
    blockIds: profile.blockIds,
    temperature: profile.temperature,
    maxTokens: profile.maxTokens,
    contextTurns: profile.contextTurns,
    contextTokens: profile.contextTokens,
    toolOutputLimit: profile.toolOutputLimit,
    summaryEnabled: profile.summaryEnabled,
    summaryTriggerTurns: profile.summaryTriggerTurns,
    summaryPrompt: profile.summaryPrompt,
    translationModelLanguage: profile.translationModelLanguage,
    translationDisplayLanguage: profile.translationDisplayLanguage,
    translationInstructions: profile.translationInstructions,
    suggestEnabled: profile.suggestEnabled,
    suggestProfileId: profile.suggestProfileId,
    visionEnabled: profile.visionEnabled,
    contentRatingMode: profile.contentRatingMode,
    contentRatingTierId: profile.contentRatingTierId,
    loreRecursionDepth: profile.loreRecursionDepth,
    allowLoreProposals: profile.allowLoreProposals,
    agentEnabled: profile.agentEnabled,
    agentDescription: profile.agentDescription,
    // Resolve shared file names only when the requester may access the file store.
    linkedFiles: owner
      ? describeLinkedFiles(owner, profile.linkedFiles, 'profile').map((view) => ({ id: view.id, name: view.missing ? null : view.name, kind: view.kind, write: view.write, ...(view.missing ? { missing: true } : {}) }))
      : profile.linkedFiles,
    style: { typeface, roleplay, colors, backgroundDim, backgroundBlur, emoticonGroupIds, cast: cast.map(({ id, name, color }) => ({ id, name, color })), blockKeys: blocks.map((block) => block.key) },
    mcpEnabled: profile.mcpEnabled,
    notProposable: { engine: profile.engine, pageAssist: profile.pageAssist },
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
    // Emotion names are the item descriptions; the prompt text behind them stays on the server.
    expressionPresets: PromptPresetModel.findAllWithItems().map((preset) => ({ id: preset.id, name: preset.name, emotions: preset.items.map(({ description }) => description) })),
  });
}

/** Chat setup tools (scope `configure`, chat accounts with admin rights only): read the setup, propose changes as cards. */
export function registerChatSetupTools(server: McpServer, context: McpRequestContext): void {
  server.registerTool('get_asset_batch', { description: 'Read a character asset batch: each slot with its status (waiting, queued, processing, completed, failed, blocked), chosen candidate and candidates with review results (expression match, hair/eye match with the reference, judge pick). Without batch_id: the newest batch of the profile (default: your speaking profile). Use it to follow generation and choose candidates for propose_profile_assets(action=apply, picks).', inputSchema: z.object({
    batch_id: z.number().int().positive().optional(), profile_id: z.number().int().positive().optional(),
  }) }, async ({ batch_id, profile_id }) => {
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
  server.registerTool('propose_profile_assets', { description: 'Propose character asset generation (action=create), or application of already chosen batch candidates (action=apply), as separate approval cards. Read get_chat_setup_guide(topic=profile_assets) first for real preset IDs and ComfyUI prompt fields. Administrators must approve each card; this tool starts no jobs and changes no profile or group. For create, input uses presetId, expressionPresetId (prompt preset descriptions are emotion keywords), optional expressions and slots; ComfyUI needs promptField. For apply, give batch_id. Default target is your speaking profile.', inputSchema: z.object({
    action: z.enum(['create', 'apply']).optional(), profile_id: z.number().int().positive().optional(),
    input: chatAssetBatchInputSchema.omit({ idempotencyKey: true }).optional(), batch_id: z.number().int().positive().optional(),
    picks: z.record(z.string().max(40), z.string().max(200)).optional().describe('apply only: slotKey → compositeHash of a candidate from get_asset_batch to choose for that slot.'),
    avatarCrop: z.object({ x: z.number(), y: z.number(), scale: z.number().positive() }).nullable().optional(),
  }) }, async (args) => {
    try {
      if (!context.chatContext || !context.requester) throw new Error(NO_CHAT_ERROR);
      const proposal = proposeProfileAssets(context.requester, context.chatContext, args);
      return textResult({ proposalId: proposal.id, note: 'Review and approve this card; creation and application need separate approvals.' }, { structuredContent: { proposal } });
    } catch (error) { return errorResult(error); }
  });
  server.registerTool(
    'get_chat_setup_guide',
    { description: 'Read the reference for writing a chat display block (status card: JSON shape, limits, template syntax, runtime behavior), a chat profile (every proposable setting with its range, where the others are set by hand, available models, judge presets, rating tiers, lorebooks and shared blocks), character assets, or how the chat\'s user-side features work (features: narration lines, reply orders, file versions, minutes, record book, linked files, web research, outside MCP tools). Read it once before proposing.', inputSchema: z.object({ topic: z.enum(['display_block', 'profile', 'profile_assets', 'features']) }) },
    async ({ topic }) => {
      try {
        return { content: [{ type: 'text' as const, text: topic === 'display_block' ? DISPLAY_BLOCK_GUIDE : topic === 'profile_assets' ? profileAssetsGuide(context) : topic === 'features' ? CHAT_FEATURES_GUIDE : profileGuide() }] };
      } catch (error) { return errorResult(error); }
    },
  );

  server.registerTool(
    'list_chat_profiles',
    { description: 'List the chat profiles (characters) with id, name, tagline, engine, enabled flag, model label, linked block and lorebook ids, and system prompt length.', inputSchema: z.object({}) },
    async () => {
      try { return textResult(ChatProfileStore.list().map(profileSummary)); } catch (error) { return errorResult(error); }
    },
  );

  server.registerTool(
    'get_chat_profile',
    { description: 'Read the setup of a chat profile in full: prompts, sections, greetings, author note, model rows per role, judge, model params, context and summary, translation languages, suggestions, vision and content rating ceiling, lore recursion, linked files, linked lorebooks and blocks, style. Defaults to the profile you are speaking as. Tool grants and connection details are never included.', inputSchema: z.object({ profile_id: z.number().int().positive().optional() }) },
    async ({ profile_id }) => {
      try {
        const id = profile_id ?? context.chatContext?.profileId;
        if (id === undefined) throw new Error('profile_id is required.');
        const profile = ChatProfileStore.find(id);
        if (!profile) throw new Error(`Chat profile not found: ${id}`);
        return textResult(profileSetupView(profile, proposerFileOwner(context)));
      } catch (error) { return errorResult(error); }
    },
  );

  server.registerTool(
    'list_display_blocks',
    { description: 'List the shared display blocks (status cards) with id, name, key, field names, summary template and the profiles that link them.', inputSchema: z.object({}) },
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

  server.registerTool(
    'get_display_block',
    { description: 'Read one shared display block in full (key, instruction, example, template, css, rules, summary, field rules).', inputSchema: z.object({ block_id: z.number().int().positive() }) },
    async ({ block_id }) => {
      try {
        const shared = ChatSharedBlockStore.find(block_id);
        if (!shared) throw new Error(`Display block not found: ${block_id}`);
        const { id: _id, ...block } = shared.block;
        return textResult({ id: shared.id, name: shared.name, block, profiles: shared.profiles });
      } catch (error) { return errorResult(error); }
    },
  );

  server.registerTool(
    'propose_display_block',
    { description: 'Propose a new shared display block (status card) as a card under your reply. Nothing is saved until the user presses 저장. get_chat_setup_guide(display_block) has the block format; read it unless you already know it. The block is validated and normalized; warnings are returned.', inputSchema: z.object({
      name: z.string().optional().describe('Name of the shared block (defaults to its key)'),
      block: z.record(z.string(), z.unknown()).describe('{ key, instruction, example, template, css, rules, summary, fields }'),
      link_to_profile: z.boolean().default(true).describe('Offer to link the saved block to the profile you speak as'),
    }) },
    async (args) => {
      try {
        if (!context.chatContext) throw new Error(NO_CHAT_ERROR);
        const built = buildDisplayBlockProposal(args, context.chatContext.profileId);
        const proposal = storeProposal(context, built.proposal);
        return textResult({ proposalId: proposal.id, block: built.block, warnings: built.warnings, note: PROPOSAL_NOTE }, { structuredContent: { proposal } });
      } catch (error) { return errorResult(error); }
    },
  );

  server.registerTool(
    'propose_chat_profile',
    { description: 'Propose a NEW chat profile as a card under your reply. Nothing is saved until the user presses 저장. get_chat_setup_guide(profile) lists limits, model slots, lorebooks and blocks: read it when you need one of them (a wrong value is refused with the allowed ones).', inputSchema: z.object({
      name: z.string(),
      tagline: z.string().optional(),
      system_prompt: z.string(),
      prompt_sections: z.array(z.object({ title: z.string(), content: z.string(), enabled: z.boolean().optional(), kind: z.enum(['text', 'dialogue', 'post']).optional() })).optional(),
      greeting: z.string().optional(),
      alternate_greetings: z.array(z.string()).optional(),
      opening_history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).optional().describe('Opening of every new chat, saved as real conversation messages'),
      greeting_position: z.number().int().optional().describe('Insert the greeting after this many opening_history messages (default 0)'),
      author_note: z.string().optional(),
      appearance: z.string().optional().describe('Look as image-prompt tags; used for character image generation'),
      model_slot: z.union([z.string(), z.number()]).optional().describe('Model slot name or id'),
      lorebook_ids: z.array(z.number().int().positive()).optional(),
      block_ids: z.array(z.number().int().positive()).optional(),
      typeface: z.enum(['sans', 'serif', 'mono']).optional(),
      settings: z.record(z.string(), z.unknown()).optional().describe('Other proposable settings by key, e.g. {"translationSlotId": 3, "translationDisplayLanguage": "ko", "summaryEnabled": true}; get_chat_setup_guide(profile) lists them'),
    }) },
    async (args) => {
      try {
        if (!context.chatContext) throw new Error(NO_CHAT_ERROR);
        const built = buildProfileProposal(args, proposerFileOwner(context));
        const proposal = storeProposal(context, built.proposal);
        return textResult({ proposalId: proposal.id, input: built.input, warnings: built.warnings, note: PROPOSAL_NOTE }, { structuredContent: { proposal } });
      } catch (error) { return errorResult(error); }
    },
  );

  server.registerTool(
    'propose_profile_update',
    { description: `Propose changes to an existing chat profile (default: the one you speak as) as a before/after card. Nothing is saved until the user presses 저장. patch keys (camelCase or snake_case): ${PROPOSABLE_KEYS.join(', ')}. get_chat_setup_guide(profile) gives each key's meaning, range and the ids to use. ${NOT_PROPOSABLE}`, inputSchema: z.object({
      profile_id: z.number().int().positive().optional(),
      patch: z.record(z.string(), z.unknown()),
    }) },
    async (args) => {
      try {
        if (!context.chatContext) throw new Error(NO_CHAT_ERROR);
        const built = buildProfileUpdateProposal(args, context.chatContext.profileId, proposerFileOwner(context));
        const proposal = storeProposal(context, built.proposal);
        return textResult({ proposalId: proposal.id, profileId: args.profile_id ?? context.chatContext.profileId, changed: Object.keys((proposal as { patch?: Record<string, unknown> }).patch ?? {}), note: PROPOSAL_NOTE }, { structuredContent: { proposal } });
      } catch (error) { return errorResult(error); }
    },
  );
}
