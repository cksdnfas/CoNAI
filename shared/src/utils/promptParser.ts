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
