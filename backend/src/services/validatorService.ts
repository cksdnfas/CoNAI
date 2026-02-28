/**
 * Validator Service
 *
 * Centralized validation and parsing utilities for auto-collection conditions
 * and other validation needs.
 */

export interface ParsedAutoTags {
  rating?: {
    general?: number;
    sensitive?: number;
    questionable?: number;
    explicit?: number;
  };
  general?: Record<string, number>;
  character?: Record<string, number>;
  model?: string;
}

export interface RatingValidationOptions {
  ratingType: string;
  minScore?: number;
  maxScore?: number;
}

export interface ScoreValidationOptions {
  minScore?: number;
  maxScore?: number;
}

export class ValidatorService {
  /**
   * Parse auto_tags JSON string safely
   * Returns null if parsing fails or input is invalid
   */
  static parseAutoTags(autoTagsJson: string | null | undefined): ParsedAutoTags | null {
    if (!autoTagsJson) {
      return null;
    }

    try {
      const parsed = JSON.parse(autoTagsJson) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }

      const tagger = parsed.tagger && typeof parsed.tagger === 'object' && !Array.isArray(parsed.tagger)
        ? parsed.tagger as Record<string, unknown>
        : null;

      const kaloscope = parsed.kaloscope && typeof parsed.kaloscope === 'object' && !Array.isArray(parsed.kaloscope)
        ? parsed.kaloscope as Record<string, unknown>
        : null;

      return {
        rating: (parsed.rating as ParsedAutoTags['rating']) || (tagger?.rating as ParsedAutoTags['rating']),
        general: (parsed.general as ParsedAutoTags['general']) || (tagger?.general as ParsedAutoTags['general']) || (kaloscope?.artists as ParsedAutoTags['general']),
        character: (parsed.character as ParsedAutoTags['character']) || (tagger?.character as ParsedAutoTags['character']),
        model: (parsed.model as string | undefined) || (tagger?.model as string | undefined) || (kaloscope?.model as string | undefined),
      };
    } catch (error) {
      console.warn('Failed to parse auto_tags JSON:', error);
      return null;
    }
  }

  /**
   * Validate rating score against min/max constraints
   *
   * @param autoTags - Parsed auto tags object
   * @param options - Rating validation options
   * @returns true if rating meets constraints, false otherwise
   */
  static validateRating(
    autoTags: ParsedAutoTags | null,
    options: RatingValidationOptions
  ): boolean {
    if (!autoTags?.rating) {
      return false;
    }

    const { ratingType, minScore, maxScore } = options;
    const ratingValue = autoTags.rating[ratingType as keyof typeof autoTags.rating];

    if (ratingValue === undefined || ratingValue === null) {
      return false;
    }

    // min_score check
    if (minScore !== undefined && ratingValue < minScore) {
      return false;
    }

    // max_score check
    if (maxScore !== undefined && ratingValue > maxScore) {
      return false;
    }

    return true;
  }

  /**
   * Validate general tag score against min/max constraints
   *
   * @param autoTags - Parsed auto tags object
   * @param tagName - Tag name to validate
   * @param options - Score validation options
   * @returns true if tag score meets constraints, false otherwise
   */
  static validateGeneralTag(
    autoTags: ParsedAutoTags | null,
    tagName: string,
    options: ScoreValidationOptions
  ): boolean {
    if (!autoTags?.general) {
      return false;
    }

    const tagValue = autoTags.general[tagName];

    if (tagValue === undefined || tagValue === null) {
      return false;
    }

    // min_score check
    if (options.minScore !== undefined && tagValue < options.minScore) {
      return false;
    }

    // max_score check
    if (options.maxScore !== undefined && tagValue > options.maxScore) {
      return false;
    }

    return true;
  }

  /**
   * Validate character score against min/max constraints
   *
   * @param autoTags - Parsed auto tags object
   * @param characterName - Character name to validate
   * @param options - Score validation options
   * @returns true if character score meets constraints, false otherwise
   */
  static validateCharacter(
    autoTags: ParsedAutoTags | null,
    characterName: string,
    options: ScoreValidationOptions
  ): boolean {
    if (!autoTags?.character) {
      return false;
    }

    const characterValue = autoTags.character[characterName];

    if (characterValue === undefined || characterValue === null) {
      return false;
    }

    // min_score check
    if (options.minScore !== undefined && characterValue < options.minScore) {
      return false;
    }

    // max_score check
    if (options.maxScore !== undefined && characterValue > options.maxScore) {
      return false;
    }

    return true;
  }

  /**
   * Check if auto tags have character data
   *
   * @param autoTags - Parsed auto tags object
   * @returns true if character data exists and is not empty
   */
  static hasCharacter(autoTags: ParsedAutoTags | null): boolean {
    return !!(autoTags?.character && Object.keys(autoTags.character).length > 0);
  }

  /**
   * Validate auto tag model field
   *
   * @param autoTags - Parsed auto tags object
   * @param expectedModel - Expected model value
   * @param caseSensitive - Whether comparison should be case-sensitive
   * @returns true if model matches expected value
   */
  static validateModel(
    autoTags: ParsedAutoTags | null,
    expectedModel: string,
    caseSensitive: boolean = false
  ): boolean {
    if (!autoTags?.model) {
      return false;
    }

    const searchValue = caseSensitive ? expectedModel : expectedModel.toLowerCase();
    const modelValue = caseSensitive ? autoTags.model : autoTags.model.toLowerCase();

    return modelValue === searchValue;
  }
}
