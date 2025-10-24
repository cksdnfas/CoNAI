/**
 * Prompt parsing utilities
 * Handles weight removal, prompt cleaning, and term parsing
 *
 * This module is shared between backend and frontend to ensure consistent
 * prompt parsing behavior across the entire application.
 */

export interface ParsedPrompt {
  original: string;
  cleaned: string;
  terms: string[];
}

/**
 * Remove weights from prompt and clean it up
 * Examples:
 *   (대한민국:1.2) -> 대한민국
 *   (대한민국:0.5) -> 대한민국
 *   하루노 사쿠라(나루토) -> 하루노 사쿠라(나루토) (no change)
 */
export const removeWeights = (prompt: string): string => {
  if (!prompt) return '';

  // Weight pattern: find (text:number) format and convert to just text
  // Preserve regular parentheses that are not weights
  return prompt.replace(/\(([^:)]+):[+-]?[\d.]+\)/g, '$1');
};

/**
 * Split prompt by comma and clean each term
 */
export const parsePromptTerms = (prompt: string): string[] => {
  if (!prompt) return [];

  return prompt
    .split(',')
    .map(term => term.trim())
    .filter(term => term.length > 0)
    .map(term => removeWeights(term));
};

/**
 * Main function to parse a complete prompt
 */
export const parsePrompt = (prompt: string): ParsedPrompt => {
  const cleaned = removeWeights(prompt);
  const terms = parsePromptTerms(cleaned);

  return {
    original: prompt,
    cleaned,
    terms
  };
};

/**
 * Normalize search term for consistent search behavior
 * Removes weights for search matching
 */
export const normalizeSearchTerm = (searchTerm: string): string => {
  return removeWeights(searchTerm.trim());
};

/**
 * Compare two prompts for equality
 * Removes weights before comparison
 */
export const comparePrompts = (prompt1: string, prompt2: string): boolean => {
  const normalized1 = normalizeSearchTerm(prompt1);
  const normalized2 = normalizeSearchTerm(prompt2);
  return normalized1.toLowerCase() === normalized2.toLowerCase();
};

/**
 * Remove duplicates from prompt array
 * Uses normalized comparison (weight-free, case-insensitive)
 */
export const deduplicatePrompts = (prompts: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const prompt of prompts) {
    const normalized = normalizeSearchTerm(prompt).toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(removeWeights(prompt));
    }
  }

  return result;
};

// =============================================================================
// STEP 1: Primary Refinement Functions
// =============================================================================

/**
 * Split multi-word bracketed expressions into individual items
 * Handles nested brackets and multiple bracket types: (), [], {}
 *
 * Examples:
 *   (Superb Quality, 8K Cinematic:1.2) → (Superb Quality), (8K Cinematic:1.2)
 *   [word1, word2:0.8] → [word1], [word2:0.8]
 *   {{{multi, words}}} → {{{multi}}}, {{{words}}}
 */
export const splitMultiWordBrackets = (prompt: string): string => {
  if (!prompt) return '';

  let result = prompt;

  // Pattern to match bracketed expressions with commas inside
  // Matches: (xxx, yyy), [xxx, yyy], {xxx, yyy}, including nested brackets
  const bracketPattern = /([(\[{]+)([^)\]}]+)([)\]}]+)/g;

  result = result.replace(bracketPattern, (match, openBrackets, content, closeBrackets) => {
    // Check if content contains comma (multi-word case)
    if (!content.includes(',')) {
      return match; // Single word - no splitting needed
    }

    // Split by comma and wrap each term in the same brackets
    const terms = content.split(',').map((term: string) => term.trim()).filter((term: string) => term.length > 0);

    return terms.map((term: string) => `${openBrackets}${term}${closeBrackets}`).join(', ');
  });

  return result;
};

/**
 * Convert NovelAI :: syntax to standard weighted format
 * Filters out non-English prefix text before :: expressions
 *
 * Syntax: weight::words::
 * Examples:
 *   1.5::rain, night:: → (rain:1.5), (night:1.5)
 *   작가프롬 1.23::artist:yuuinami:: → (artist:yuuinami:1.23)
 *   0.74::shiny skin:: → (shiny skin:0.74)
 *   -1.75::deformed:: → (deformed:-1.75)
 */
export const convertNAISyntax = (prompt: string): string => {
  if (!prompt) return '';

  let result = prompt;

  // Pattern: [optional non-English prefix] weight::text::
  // Captures weight and text, ignores non-English prefix
  const naiPattern = /[^a-zA-Z0-9\s,.:_<>()[\]{}]*\s*([-+]?[\d.]+)::(.*?)::/g;

  result = result.replace(naiPattern, (_match, weight, text) => {
    const trimmedText = text.trim();
    if (!trimmedText) return ''; // Empty text - remove entirely

    // Convert to standard format: (text:weight)
    return `(${trimmedText}:${weight})`;
  });

  return result;
};

/**
 * Primary refinement function combining all STEP 1 operations
 * This should be called before storing prompts in the database
 *
 * Processing order:
 *   1. Convert NAI :: syntax
 *   2. Split multi-word brackets
 *
 * Example:
 *   Input: (Superb Quality, 8K:1.2), 작가프롬 1.5::rain::
 *   Output: (Superb Quality), (8K:1.2), (rain:1.5)
 */
export const refinePrimaryPrompt = (prompt: string): string => {
  if (!prompt) return '';

  let result = prompt;

  // Step 1: Convert NAI syntax first
  result = convertNAISyntax(result);

  // Step 2: Split multi-word brackets
  result = splitMultiWordBrackets(result);

  // Clean up extra spaces and commas
  result = result.replace(/\s*,\s*,\s*/g, ', ').replace(/,\s*$/, '').trim();

  return result;
};

// =============================================================================
// STEP 3: LoRA and Term Cleaning Functions
// =============================================================================

/**
 * Check if a term is a LoRA model
 * LoRA models are enclosed in <> brackets
 *
 * Examples:
 *   <lora:Model_Name:0.8> → true
 *   <lora:Model_Name> → true
 *   normal word → false
 */
export const isLoRAModel = (term: string): boolean => {
  if (!term) return false;
  const trimmed = term.trim();
  return trimmed.startsWith('<lora:') && trimmed.includes('>');
};

/**
 * Remove weight from LoRA model notation
 *
 * Examples:
 *   <lora:Model_Name:0.8> → <lora:Model_Name>
 *   <lora:Model_Name> → <lora:Model_Name> (no change)
 */
export const removeLoRAWeight = (lora: string): string => {
  if (!lora) return '';

  // Pattern: <lora:name:weight> → <lora:name>
  return lora.replace(/(<lora:[^:>]+):[^>]+>/, '$1>');
};

/**
 * Parse prompt and separate LoRA models from regular terms
 *
 * Returns:
 *   - loras: Array of LoRA model strings
 *   - terms: Array of regular prompt terms
 *
 * Example:
 *   Input: "1girl, solo, <lora:Model_A:0.8>, beautiful, <lora:Model_B:0.5>"
 *   Output: {
 *     loras: ["<lora:Model_A:0.8>", "<lora:Model_B:0.5>"],
 *     terms: ["1girl", "solo", "beautiful"]
 *   }
 */
export const parsePromptWithLoRAs = (prompt: string): { loras: string[], terms: string[] } => {
  if (!prompt) return { loras: [], terms: [] };

  const loras: string[] = [];
  const terms: string[] = [];

  // Split by comma
  const parts = prompt.split(',').map(part => part.trim()).filter(part => part.length > 0);

  for (const part of parts) {
    if (isLoRAModel(part)) {
      loras.push(part);
    } else {
      terms.push(part);
    }
  }

  return { loras, terms };
};

/**
 * Clean a prompt term for collection storage
 * Removes all brackets, weights, and replaces underscores with spaces
 * This is the final cleaning step before storing in prompt_collection table
 *
 * Cleaning steps:
 *   1. Remove all bracket types: (), [], {}, including nested
 *   2. Remove weight notation: :1.2, :0.8, :-1.5
 *   3. Replace underscores with spaces: _ → space
 *   4. Trim and normalize whitespace
 *
 * Examples:
 *   (Superb_Quality:1.2) → Superb Quality
 *   {{best_quality}} → best quality
 *   [low_quality:0.8] → low quality
 *   ((((masterpiece)))) → masterpiece
 */
export const cleanPromptTerm = (term: string): string => {
  if (!term) return '';

  let cleaned = term;

  // Step 1: Remove all types of brackets (multiple passes for nested brackets)
  // Repeat removal until no more brackets remain
  let prevLength = 0;
  while (cleaned.length !== prevLength) {
    prevLength = cleaned.length;
    cleaned = cleaned.replace(/[()[\]{}]/g, '');
  }

  // Step 2: Remove weight notation (:number)
  // Pattern matches :1.2, :-0.5, :+1.0, etc.
  cleaned = cleaned.replace(/:[+-]?[\d.]+/g, '');

  // Step 3: Replace underscores with spaces
  cleaned = cleaned.replace(/_/g, ' ');

  // Step 4: Normalize whitespace (collapse multiple spaces to single space)
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
};
