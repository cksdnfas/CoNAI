/**
 * Regex Evaluator
 *
 * Handles all regex and string matching conditions:
 * - prompt_contains, prompt_regex
 * - negative_prompt_contains, negative_prompt_regex
 * - model_name, lora_model, filename, ai_tool
 */

import { AutoCollectCondition } from '@conai/shared';
import { ConditionEvaluator, EvaluableImage } from '../types';

export class RegexEvaluator implements ConditionEvaluator {
  /**
   * Regex compilation cache to avoid repeated compilation
   * Key format: "pattern|flags"
   */
  private static regexCache = new Map<string, RegExp>();

  /**
   * Get or compile regex with caching
   */
  private static getRegex(pattern: string, flags?: string): RegExp {
    const cacheKey = `${pattern}|${flags || ''}`;

    let regex = this.regexCache.get(cacheKey);
    if (!regex) {
      regex = flags ? new RegExp(pattern, flags) : new RegExp(pattern);
      this.regexCache.set(cacheKey, regex);
    }

    return regex;
  }

  /**
   * Escape special characters for regex
   */
  private static escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Evaluate regex-based condition
   */
  async evaluate(image: EvaluableImage, condition: AutoCollectCondition): Promise<boolean> {
    const { type, value, case_sensitive = false } = condition;

    // All regex conditions require string value
    if (typeof value !== 'string') {
      return false;
    }

    switch (type) {
      case 'prompt_contains':
        return this.evaluateContains(
          image.prompt || '',
          value as string,
          case_sensitive,
          condition.exact_match
        );

      case 'prompt_regex':
        return this.evaluateRegex(
          image.prompt || '',
          value as string,
          case_sensitive
        );

      case 'negative_prompt_contains':
        return this.evaluateContains(
          image.negative_prompt || '',
          value as string,
          case_sensitive,
          condition.exact_match
        );

      case 'negative_prompt_regex':
        return this.evaluateRegex(
          image.negative_prompt || '',
          value as string,
          case_sensitive
        );

      case 'model_name':
        return this.evaluateContains(
          image.model_name || '',
          value as string,
          case_sensitive,
          condition.exact_match
        );

      case 'ai_tool':
        return this.evaluateExactMatch(
          image.ai_tool || '',
          value as string,
          case_sensitive
        );

      case 'ai_tool_group':
        return this.evaluateAIToolGroup(image.ai_tool || '', value as string);

      case 'lora_model': {
        const loraValue = (image as { lora_models?: string | string[] | null }).lora_models;
        const loraText = typeof loraValue === 'string'
          ? loraValue
          : Array.isArray(loraValue)
            ? loraValue.join(', ')
            : '';

        return this.evaluateContains(
          loraText,
          value as string,
          case_sensitive,
          condition.exact_match
        );
      }

      default:
        return false;
    }
  }

  /**
   * Evaluate contains condition with optional exact match
   */
  private evaluateContains(
    targetText: string,
    searchValue: string,
    caseSensitive: boolean,
    exactMatch?: boolean
  ): boolean {
    const target = caseSensitive ? targetText : targetText.toLowerCase();
    const search = caseSensitive ? searchValue : searchValue.toLowerCase();

    if (exactMatch) {
      const pattern = `\\b${RegexEvaluator.escapeRegex(searchValue)}\\b`;
      const regex = RegexEvaluator.getRegex(pattern, caseSensitive ? undefined : 'i');
      return regex.test(targetText);
    }

    return target.includes(search);
  }

  /**
   * Evaluate regex pattern condition
   */
  private evaluateRegex(
    targetText: string,
    pattern: string,
    caseSensitive: boolean
  ): boolean {
    try {
      const flags = caseSensitive ? 'g' : 'gi';
      const regex = RegexEvaluator.getRegex(pattern, flags);
      return regex.test(targetText);
    } catch (err) {
      console.warn('Invalid regex pattern:', pattern, err);
      return false;
    }
  }

  /**
   * Evaluate exact match condition
   */
  private evaluateExactMatch(
    targetText: string,
    searchValue: string,
    caseSensitive: boolean
  ): boolean {
    const target = caseSensitive ? targetText : targetText.toLowerCase();
    const search = caseSensitive ? searchValue : searchValue.toLowerCase();
    return target === search;
  }

  /**
   * Evaluate grouped AI tool options used by the shared search UI.
   */
  private evaluateAIToolGroup(targetText: string, searchValue: string): boolean {
    const normalizedTarget = targetText.trim().toLowerCase();
    const normalizedSearch = searchValue.trim().toLowerCase();

    if (normalizedSearch === 'nai') {
      return normalizedTarget === 'novelai';
    }
    if (normalizedSearch === 'comfyui') {
      return normalizedTarget === 'comfyui';
    }
    if (normalizedSearch === 'other') {
      return normalizedTarget.length > 0 && normalizedTarget !== 'novelai' && normalizedTarget !== 'comfyui';
    }

    return false;
  }

  /**
   * Get condition types handled by this evaluator
   */
  getHandledTypes(): AutoCollectCondition['type'][] {
    return [
      'prompt_contains',
      'prompt_regex',
      'negative_prompt_contains',
      'negative_prompt_regex',
      'model_name',
      'lora_model',
      'ai_tool',
      'ai_tool_group'
    ];
  }
}
