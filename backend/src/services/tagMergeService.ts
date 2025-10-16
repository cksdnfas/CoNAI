import { TaggerResult } from './taggerDaemon';

/**
 * TagMergeService - Merge multiple frame tag results into single consolidated result
 * Used for video tagging where multiple frames are analyzed and merged
 */
export class TagMergeService {
  /**
   * Merge multiple frame tagging results into single result
   * Implements conservative rating selection and averaged general/character scores
   *
   * @param results Array of TaggerResult from individual frames
   * @returns Merged TaggerResult representing entire video
   */
  static mergeVideoTagResults(results: TaggerResult[]): TaggerResult {
    try {
      console.log(`[TagMerge] Merging ${results.length} frame results`);

      // Filter successful results
      const successfulResults = results.filter(r => r.success);

      if (successfulResults.length === 0) {
        return {
          success: false,
          error: 'All frame tagging attempts failed',
          error_type: 'MergeError'
        };
      }

      console.log(`[TagMerge] ${successfulResults.length}/${results.length} frames tagged successfully`);

      // 1. Select rating using conservative approach (highest explicit → questionable → sensitive)
      const selectedRating = this.selectConservativeRating(successfulResults);

      // 2. Merge general tags (average scores across frames)
      const mergedGeneral = this.mergeTagScores(
        successfulResults.map(r => r.general || {}),
        0.35 // Default threshold
      );

      // 3. Merge character tags (average scores across frames)
      const mergedCharacter = this.mergeTagScores(
        successfulResults.map(r => r.character || {}),
        0.35 // Use same threshold for consistency, will be filtered again later
      );

      // 4. Generate caption and taglist from merged tags
      const { caption, taglist } = this.generateCaptionAndTaglist(mergedGeneral, mergedCharacter);

      // 5. Get model and thresholds from first successful result
      const firstResult = successfulResults[0];

      const mergedResult: TaggerResult = {
        success: true,
        caption,
        taglist,
        rating: selectedRating,
        general: mergedGeneral,
        character: mergedCharacter,
        model: firstResult.model,
        thresholds: firstResult.thresholds
      };

      console.log('[TagMerge] Merge completed successfully');
      console.log(`[TagMerge] Merged tags: ${Object.keys(mergedGeneral).length} general, ${Object.keys(mergedCharacter).length} character`);

      return mergedResult;

    } catch (error) {
      console.error('[TagMerge] Merge failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown merge error',
        error_type: 'MergeError'
      };
    }
  }

  /**
   * Select rating using conservative approach:
   * 1. Find frame with highest "explicit" value
   * 2. If tied, use highest "questionable" value
   * 3. If still tied, use highest "sensitive" value
   * 4. Return rating from selected frame
   *
   * @param results Array of successful TaggerResult
   * @returns Selected rating object
   */
  private static selectConservativeRating(results: TaggerResult[]): Record<string, number> {
    let selectedFrame = results[0];
    let maxExplicit = selectedFrame.rating?.explicit || 0;
    let maxQuestionable = selectedFrame.rating?.questionable || 0;
    let maxSensitive = selectedFrame.rating?.sensitive || 0;

    for (const result of results) {
      const rating = result.rating;
      if (!rating) continue;

      const explicit = rating.explicit || 0;
      const questionable = rating.questionable || 0;
      const sensitive = rating.sensitive || 0;

      // Compare explicit first
      if (explicit > maxExplicit) {
        selectedFrame = result;
        maxExplicit = explicit;
        maxQuestionable = questionable;
        maxSensitive = sensitive;
      }
      // If explicit is tied, compare questionable
      else if (explicit === maxExplicit && questionable > maxQuestionable) {
        selectedFrame = result;
        maxQuestionable = questionable;
        maxSensitive = sensitive;
      }
      // If both tied, compare sensitive
      else if (explicit === maxExplicit && questionable === maxQuestionable && sensitive > maxSensitive) {
        selectedFrame = result;
        maxSensitive = sensitive;
      }
    }

    console.log(`[TagMerge] Selected rating: explicit=${maxExplicit.toFixed(3)}, questionable=${maxQuestionable.toFixed(3)}, sensitive=${maxSensitive.toFixed(3)}`);

    return selectedFrame.rating || {
      general: 0,
      sensitive: 0,
      questionable: 0,
      explicit: 0
    };
  }

  /**
   * Merge tag scores from multiple frames by averaging
   * Tags appearing in multiple frames get averaged scores
   *
   * @param tagArrays Array of tag objects from each frame
   * @param threshold Minimum score threshold to include tag
   * @returns Merged tag object with averaged scores
   */
  private static mergeTagScores(
    tagArrays: Record<string, number>[],
    threshold: number
  ): Record<string, number> {
    const tagAccumulator: Record<string, { sum: number; count: number }> = {};

    // Accumulate scores for each tag across all frames
    for (const tags of tagArrays) {
      for (const [tagName, score] of Object.entries(tags)) {
        if (!tagAccumulator[tagName]) {
          tagAccumulator[tagName] = { sum: 0, count: 0 };
        }
        tagAccumulator[tagName].sum += score;
        tagAccumulator[tagName].count += 1;
      }
    }

    // Calculate averages
    const mergedTags: Record<string, number> = {};
    for (const [tagName, accumulator] of Object.entries(tagAccumulator)) {
      const avgScore = accumulator.sum / accumulator.count;
      // Only include tags above threshold
      if (avgScore >= threshold) {
        mergedTags[tagName] = avgScore;
      }
    }

    // Sort by score (descending)
    const sortedEntries = Object.entries(mergedTags)
      .sort((a, b) => b[1] - a[1]);

    const sortedTags: Record<string, number> = {};
    for (const [tag, score] of sortedEntries) {
      sortedTags[tag] = score;
    }

    return sortedTags;
  }

  /**
   * Generate caption and taglist from merged tags
   * Combines general and character tags in proper format
   *
   * @param general Merged general tags
   * @param character Merged character tags
   * @returns Object with caption and taglist strings
   */
  private static generateCaptionAndTaglist(
    general: Record<string, number>,
    character: Record<string, number>
  ): { caption: string; taglist: string } {
    // Combine tag names (general first, then character)
    const combinedNames: string[] = [
      ...Object.keys(general),
      ...Object.keys(character)
    ];

    // Caption uses underscores
    const caption = combinedNames.join(', ');

    // Taglist uses spaces and escapes parentheses
    const taglist = caption
      .replace(/_/g, ' ')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');

    return { caption, taglist };
  }

  /**
   * Get merge statistics for debugging
   * @param results Array of TaggerResult
   * @returns Statistics object
   */
  static getMergeStatistics(results: TaggerResult[]): {
    total: number;
    successful: number;
    failed: number;
    successRate: number;
  } {
    const successful = results.filter(r => r.success).length;
    const failed = results.length - successful;

    return {
      total: results.length,
      successful,
      failed,
      successRate: results.length > 0 ? successful / results.length : 0
    };
  }
}
