import { AutoTagSearchParams, CharacterFilter, RatingFilter, TagFilter } from '../../types/autoTag';
import { RatingScoreService } from '../ratingScoreService';
import { findAutoTagMatchingKeys } from './autoTagSearchTerms';

/** Evaluate auto-tag search filters against one parsed auto_tags payload in memory. */
export class AutoTagSearchMatcher {
  /** Check whether one auto_tags JSON payload matches the supplied search parameters. */
  static async matchesAutoTagConditions(
    autoTagsJson: string | null,
    searchParams: AutoTagSearchParams,
  ): Promise<boolean> {
    if (!autoTagsJson) {
      return searchParams.has_auto_tags === false;
    }

    if (searchParams.has_auto_tags === false) {
      return false;
    }

    try {
      const autoTags = JSON.parse(autoTagsJson);
      const tagger = autoTags?.tagger && typeof autoTags.tagger === 'object' ? autoTags.tagger : {};
      const kaloscope = autoTags?.kaloscope && typeof autoTags.kaloscope === 'object' ? autoTags.kaloscope : {};

      const resolvedRating = autoTags.rating || tagger.rating;
      const resolvedGeneral = {
        ...(autoTags.general || {}),
        ...(tagger.general || {}),
        ...(kaloscope.general || {}),
        ...(kaloscope.artists || {}),
        ...(kaloscope.artist || {}),
      };
      const resolvedCharacter = {
        ...(autoTags.character || {}),
        ...(tagger.character || {}),
      };
      const resolvedModel = autoTags.model || tagger.model || kaloscope.model;

      if (searchParams.rating && !this.matchesRating(resolvedRating, searchParams.rating)) {
        return false;
      }

      if (searchParams.rating_score) {
        const scoreMatches = await this.matchesRatingScore(resolvedRating, searchParams.rating_score);
        if (!scoreMatches) {
          return false;
        }
      }

      if (searchParams.general_tags && searchParams.general_tags.length > 0) {
        if (!this.matchesGeneralTags(resolvedGeneral, searchParams.general_tags)) {
          return false;
        }
      }

      if (searchParams.character && !this.matchesCharacter(resolvedCharacter, searchParams.character)) {
        return false;
      }

      if (searchParams.model && resolvedModel !== searchParams.model) {
        return false;
      }

      return true;
    } catch (error) {
      console.warn('Failed to parse auto_tags JSON:', error);
      return false;
    }
  }

  /** Match rating-score bounds using the shared weighted score calculator. */
  private static async matchesRatingScore(
    rating: any,
    scoreFilter: { min_score?: number; max_score?: number },
  ): Promise<boolean> {
    if (!rating) return false;

    try {
      const scoreResult = await RatingScoreService.calculateScore(rating);
      const score = scoreResult.score;

      if (scoreFilter.min_score !== undefined && score < scoreFilter.min_score) {
        return false;
      }

      if (scoreFilter.max_score !== undefined && score > scoreFilter.max_score) {
        return false;
      }

      return true;
    } catch (error) {
      console.warn('Failed to calculate rating score:', error);
      return false;
    }
  }

  /** Match rating ranges inside one parsed auto-tag payload. */
  private static matchesRating(rating: any, filter: RatingFilter): boolean {
    if (!rating) return false;

    const types = ['general', 'sensitive', 'questionable', 'explicit'] as const;
    for (const type of types) {
      const typeFilter = filter[type];
      if (!typeFilter) continue;

      const value = rating[type];
      if (value === undefined || value === null) return false;

      if (typeFilter.min !== undefined && value < typeFilter.min) return false;
      if (typeFilter.max !== undefined && value > typeFilter.max) return false;
    }

    return true;
  }

  /** Match general-tag filters against merged general-tag maps. */
  private static matchesGeneralTags(general: any, filters: TagFilter[]): boolean {
    if (!general) return false;

    for (const filter of filters) {
      const matchingKeys = findAutoTagMatchingKeys(general, filter.tag);
      if (matchingKeys.length === 0) return false;

      let hasValidScore = false;

      for (const key of matchingKeys) {
        const value = general[key];
        if (value === undefined || value === null) continue;

        const meetsMinScore = filter.min_score === undefined || value >= filter.min_score;
        const meetsMaxScore = filter.max_score === undefined || value <= filter.max_score;

        if (meetsMinScore && meetsMaxScore) {
          hasValidScore = true;
          break;
        }
      }

      if ((filter.min_score !== undefined || filter.max_score !== undefined) && !hasValidScore) {
        return false;
      }
    }

    return true;
  }

  /** Match character-tag filters against merged character-tag maps. */
  private static matchesCharacter(character: any, filter: CharacterFilter): boolean {
    if (filter.has_character !== undefined) {
      const hasChar = character && Object.keys(character).length > 0;
      if (filter.has_character !== hasChar) return false;
    }

    if (filter.name) {
      if (!character) return false;

      const matchingKeys = findAutoTagMatchingKeys(character, filter.name);
      if (matchingKeys.length === 0) return false;

      let hasValidScore = false;

      for (const key of matchingKeys) {
        const value = character[key];
        if (value === undefined || value === null) continue;

        const meetsMinScore = filter.min_score === undefined || value >= filter.min_score;
        const meetsMaxScore = filter.max_score === undefined || value <= filter.max_score;

        if (meetsMinScore && meetsMaxScore) {
          hasValidScore = true;
          break;
        }
      }

      if ((filter.min_score !== undefined || filter.max_score !== undefined) && !hasValidScore) {
        return false;
      }
    }

    return true;
  }
}
