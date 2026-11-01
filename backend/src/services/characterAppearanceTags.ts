import {
  emptyCharacterAppearanceSections,
  formatDanbooruTagForPrompt,
  joinPromptParts,
  normalizeCharacterTag,
  tokenizePrompt,
  type CharacterAppearanceFill,
  type CharacterAppearanceSectionKey,
  type CharacterFacetDimension,
  type CharacterFacetKey,
} from '@conai/shared';
import { z } from 'zod';
import { danbooruBrowserService, type DanbooruTagDescription } from './danbooruBrowserService';
import { processHashTaggingItem, queryActiveImageRecord } from './hashTaggingService';
import { ValidatorService } from './validatorService';

/**
 * Sorting image-prompt tags into the character library's sections and filter dimensions by the installed Danbooru
 * dictionary (tag category and taxonomy groups). One module for every source: a Danbooru character, an image's auto
 * tags, an AI draft or typed text. Without a dictionary every tag goes to `other` and there are no dimensions.
 */

type Placement = CharacterAppearanceSectionKey | 'outfit' | 'drop';

const under = (key: string, prefix: string) => key === prefix || key.startsWith(`${prefix}__`);

/** First matching rule wins, so a tag in an appearance group and in a dropped one (an eye state) is kept. */
const PLACEMENT_RULES: Array<[Placement, string[]]> = [
  ['identity', ['subject__human_subjects', 'subject__groups_counts']],
  ['hair', ['appearance__hair']],
  ['eyes', ['appearance__eyes']],
  ['face', ['appearance__head_face']],
  ['body', ['appearance__body', 'appearance__body_shape_size']],
  ['skin', ['appearance__skin_markings']],
  ['traits', ['subject__fantasy_species', 'subject__creatures_animals', 'subject__robots_nonhumans', 'subject__character_types', 'subject__roles_occupations']],
  ['outfit', ['wardrobe']],
  // Expressions are the setting's expression images; poses, scenes and picture qualities belong to a prompt, not a look.
  ['drop', ['appearance__expression', 'appearance__condition_state', 'action', 'scene', 'visual', 'meta', 'mood', 'relationship', 'sexual']],
];

function placementOf(description: DanbooruTagDescription | undefined): Placement {
  if (!description) return 'other';
  if (description.category === 'character' || description.category === 'copyright') return 'identity';
  if (description.category === 'artist' || description.category === 'meta') return 'drop';
  for (const [placement, prefixes] of PLACEMENT_RULES) {
    if (description.nodeKeys.some((key) => prefixes.some((prefix) => under(key, prefix)))) return placement;
  }
  return 'other';
}

/** A term to place: `text` as written into the section, `tag` its normalized name; `placement` skips the lookup. */
type Term = { text: string; tag: string; placement?: Placement };

/**
 * Put terms into sections and the outfit, keeping their order. `dropUnrelated` leaves out expression, pose, scene and
 * meta tags (fills from a character or an image); typed text keeps them under `other`.
 */
function placeTerms(terms: readonly Term[], dropUnrelated: boolean): Omit<CharacterAppearanceFill, 'name'> {
  const descriptions = danbooruBrowserService.describeTags(terms.filter((term) => !term.placement).map((term) => term.tag));
  const buckets = new Map<Placement, string[]>();
  const seen = new Set<string>();
  for (const term of terms) {
    if (seen.has(term.tag)) continue;
    seen.add(term.tag);
    let placement = term.placement ?? placementOf(descriptions.get(term.tag));
    if (placement === 'drop') {
      if (dropUnrelated) continue;
      placement = 'other';
    }
    buckets.set(placement, [...(buckets.get(placement) ?? []), term.text]);
  }
  const sections = emptyCharacterAppearanceSections();
  for (const key of Object.keys(sections) as CharacterAppearanceSectionKey[]) sections[key] = joinPromptParts(buckets.get(key) ?? []);
  return { sections, outfitTags: joinPromptParts(buckets.get('outfit') ?? []) };
}

/** Prompt text's terms as written (emphasis kept); LoRA tags stay whole under `other`. */
function textTerms(text: string): Term[] {
  const { terms, loras } = tokenizePrompt(text);
  return [
    ...terms.map((term) => ({ text: term.display, tag: normalizeCharacterTag(term.value) })),
    ...loras.map((lora) => ({ text: lora, tag: lora, placement: 'other' as const })),
  ];
}

/** Typed or drafted text sorted into sections and the default outfit; nothing is left out. */
export function splitAppearanceText(text: string): Omit<CharacterAppearanceFill, 'name'> {
  return placeTerms(textTerms(text), false);
}

export class CharacterAppearanceFillError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/** A Danbooru character's look: its tag and primary work, then its frequent appearance and outfit tags. */
export function fillFromDanbooruCharacter(character: string): CharacterAppearanceFill {
  if (!danbooruBrowserService.isAvailable()) throw new CharacterAppearanceFillError('Danbooru 사전이 설치되어 있지 않아. 설정 → 프롬프트에서 설치해줘.', 409);
  const found = danbooruBrowserService.characterAppearance(character);
  if (!found) throw new CharacterAppearanceFillError('Danbooru 사전에서 그 캐릭터를 찾지 못했어. 영문 태그 이름이나 정확한 한국어 이름으로 찾아줘.', 404);
  const identity = [found.name, ...(found.copyright ? [found.copyright] : [])].map((name) => ({ text: formatDanbooruTagForPrompt(name), tag: name, placement: 'identity' as const }));
  const related = found.tags.map((tag) => ({ text: formatDanbooruTagForPrompt(tag.name), tag: tag.name }));
  return { ...placeTerms([...identity, ...related], true), name: found.translatedName ?? found.displayName };
}

/** Auto-tagger output (tag → confidence) as a look: character tags first, then general tags by confidence. */
export function fillFromAutoTags(tags: { character?: Record<string, number>; general?: Record<string, number> }): CharacterAppearanceFill {
  const byConfidence = (record: Record<string, number> = {}) => Object.entries(record).sort((left, right) => right[1] - left[1]).map(([name]) => name);
  const characters = byConfidence(tags.character).map((name) => ({ text: formatDanbooruTagForPrompt(name), tag: normalizeCharacterTag(name), placement: 'identity' as const }));
  const general = byConfidence(tags.general).map((name) => ({ text: formatDanbooruTagForPrompt(name), tag: normalizeCharacterTag(name) }));
  return { ...placeTerms([...characters, ...general], true), name: null };
}

const fillSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('danbooru'), character: z.string().trim().min(1) }).strict(),
  z.object({ source: z.literal('image'), imageHash: z.string().trim().min(1) }).strict(),
  z.object({ source: z.literal('text'), text: z.string() }).strict(),
]);

/**
 * An unsaved look from one source (`CharacterAppearanceFillInput`). An image without auto tags is tagged now through
 * the library's tagger (the result is stored on the image like any tagging).
 */
export async function fillCharacterAppearance(input: unknown, canViewImages: boolean): Promise<CharacterAppearanceFill> {
  const parsed = fillSchema.safeParse(input);
  if (!parsed.success) throw new CharacterAppearanceFillError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  const value = parsed.data;
  if (value.source === 'danbooru') return fillFromDanbooruCharacter(value.character);
  if (value.source === 'text') return { ...splitAppearanceText(value.text), name: null };
  if (!canViewImages) throw new CharacterAppearanceFillError('Permission required: images.view', 403);
  const record = queryActiveImageRecord(value.imageHash);
  if (!record) throw new CharacterAppearanceFillError('라이브러리에서 그 이미지를 찾지 못했어.', 404);
  let tags = ValidatorService.parseAutoTags(record.auto_tags);
  if (!tags?.general && !tags?.character) {
    const tagged = await processHashTaggingItem(value.imageHash, '[CharacterAppearanceFill]');
    if (!tagged.success) throw new CharacterAppearanceFillError(`이미지 자동 태그를 만들지 못했어: ${tagged.error}`, 502);
    tags = ValidatorService.parseAutoTags(JSON.stringify(tagged.auto_tags));
  }
  return fillFromAutoTags({ character: tags?.character, general: tags?.general });
}

const FACET_RULES: Array<[CharacterFacetKey, { categories?: string[]; nodes?: string[] }]> = [
  ['copyright', { categories: ['copyright'] }],
  ['character', { categories: ['character'] }],
  ['subject', { nodes: ['subject__human_subjects'] }],
  ['hairColor', { nodes: ['appearance__hair__hair_color'] }],
  ['hairLength', { nodes: ['appearance__hair__hair_length'] }],
  ['hairStyle', { nodes: ['appearance__hair__hair_style'] }],
  ['eyeColor', { nodes: ['appearance__eyes__eye_color'] }],
  ['skinColor', { nodes: ['appearance__skin_markings__skin_color'] }],
  ['species', { nodes: ['subject__fantasy_species', 'subject__creatures_animals', 'subject__robots_nonhumans'] }],
  ['outfit', { nodes: ['wardrobe__uniforms_costumes', 'wardrobe__clothing'] }],
];
export const CHARACTER_FACET_KEYS = FACET_RULES.map(([key]) => key);
/** The catalog's dimensions: small fixed sets, offered without counts (counting all characters is too slow). */
const CATALOG_FACET_KEYS: readonly CharacterFacetKey[] = ['hairColor', 'hairLength', 'hairStyle', 'eyeColor', 'skinColor'];

function facetKeysOf(description: DanbooruTagDescription): CharacterFacetKey[] {
  return FACET_RULES.filter(([, rule]) => rule.categories?.includes(description.category)
    || rule.nodes?.some((prefix) => description.nodeKeys.some((key) => under(key, prefix)))).map(([key]) => key);
}

const facetLabel = (description: DanbooruTagDescription) => description.translated ?? formatDanbooruTagForPrompt(description.name);

/**
 * The dimensions present in tag counts: `countsFor(key)` gives a dimension's counts (the caller excludes that
 * dimension's own selection, so its other choices keep their counts). Tags of no dimension are left out.
 */
export function libraryFacetDimensions(countsFor: (key: CharacterFacetKey) => ReadonlyMap<string, number>): CharacterFacetDimension[] {
  const dimensions: CharacterFacetDimension[] = [];
  for (const key of CHARACTER_FACET_KEYS) {
    const counts = countsFor(key);
    const descriptions = danbooruBrowserService.describeTags([...counts.keys()]);
    const values = [...counts].flatMap(([tag, count]) => {
      const description = descriptions.get(tag);
      return description && facetKeysOf(description).includes(key) ? [{ tag, label: facetLabel(description), translated: description.translated, count }] : [];
    }).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
    if (values.length) dimensions.push({ key, values });
  }
  return dimensions;
}

/** Each setting's work for its card: the first of its indexed tags the dictionary files as a copyright (facet label). */
export function settingCopyrightLabels(rows: ReadonlyArray<{ settingId: number; tag: string }>): Map<number, string> {
  const result = new Map<number, string>();
  const descriptions = danbooruBrowserService.describeTags(rows.map((row) => row.tag));
  for (const row of rows) {
    const description = descriptions.get(row.tag);
    if (description && !result.has(row.settingId) && description.category === 'copyright') result.set(row.settingId, facetLabel(description));
  }
  return result;
}

/** The catalog's filter choices: every tag of its dimensions, most used on Danbooru first. */
export function catalogFacetDimensions(): CharacterFacetDimension[] {
  return CATALOG_FACET_KEYS.map((key) => {
    const rule = FACET_RULES.find(([facet]) => facet === key)![1];
    return { key, values: danbooruBrowserService.listTaxonomyTags(rule.nodes ?? []).map((tag) => ({ tag: normalizeCharacterTag(tag.name), label: tag.translated ?? formatDanbooruTagForPrompt(tag.name), translated: tag.translated, count: null })) };
  }).filter((dimension) => dimension.values.length);
}
