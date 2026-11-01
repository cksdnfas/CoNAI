import type { CharacterAppearanceSectionKey, CharacterAppearanceSections, CharacterOutfit } from '../types/characterLibrary';
import { tokenizePrompt } from './promptParser';

/** Section order in the editor and in the composed appearance text. */
export const CHARACTER_APPEARANCE_SECTION_KEYS: readonly CharacterAppearanceSectionKey[] = ['identity', 'hair', 'eyes', 'face', 'body', 'skin', 'traits', 'other'];

export function emptyCharacterAppearanceSections(): CharacterAppearanceSections {
  return { identity: '', hair: '', eyes: '', face: '', body: '', skin: '', traits: '', other: '' };
}

/** Comma-separated parts without their own leading/trailing commas or blanks, empty parts left out. */
export function joinPromptParts(parts: readonly string[]): string {
  return parts.map((part) => part.replace(/^[\s,]+|[\s,]+$/g, '')).filter(Boolean).join(', ');
}

/** What a setting gives profiles and generation: every section in order, then the chosen (default: first) outfit. */
export function composeCharacterAppearance(look: { sections: CharacterAppearanceSections; outfits: readonly CharacterOutfit[] }, outfitIndex = 0): string {
  return joinPromptParts([...CHARACTER_APPEARANCE_SECTION_KEYS.map((key) => look.sections[key]), look.outfits[outfitIndex]?.tags ?? '']);
}

/** The outfit a profile or workflow names (case-insensitive); the default (first) one when unnamed or gone. */
export function characterOutfitIndex(outfits: readonly CharacterOutfit[], name: string | null | undefined): number {
  const wanted = name?.trim().toLowerCase();
  if (!wanted) return 0;
  const index = outfits.findIndex((outfit) => outfit.name.trim().toLowerCase() === wanted);
  return index < 0 ? 0 : index;
}

/** Danbooru's normalized tag form (`Blue Hair` → `blue_hair`), used to index and match tags. */
export function normalizeCharacterTag(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

/** The distinct plain tags of prompt text, normalized (weights and emphasis removed). */
export function characterTagValues(text: string): string[] {
  return [...new Set(tokenizePrompt(text).terms.map((term) => normalizeCharacterTag(term.value)).filter(Boolean))];
}

/** A Danbooru tag as prompt text: underscores become spaces except in short emoticon-like tags (`^_^`). */
export function formatDanbooruTagForPrompt(name: string, keepUnderscores = false): string {
  return keepUnderscores || name.length <= 3 ? name : name.replace(/_/g, ' ');
}
