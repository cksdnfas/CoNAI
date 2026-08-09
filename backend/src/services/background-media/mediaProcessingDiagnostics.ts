import type { MediaFileProcessingResult } from './mediaProcessingTypes';

let lastProcessingResult: MediaFileProcessingResult | null = null;
let lastBatchProcessingResults: MediaFileProcessingResult[] = [];

/** Retain internal stage detail without changing any existing public return shape. */
export class MediaProcessingDiagnostics {
  static record(result: MediaFileProcessingResult): void {
    lastProcessingResult = result;
  }

  static startBatch(): void {
    lastBatchProcessingResults = [];
  }

  static recordBatch(result: MediaFileProcessingResult): void {
    this.record(result);
    lastBatchProcessingResults.push(result);
  }

  static getLastResult(): MediaFileProcessingResult | null {
    return lastProcessingResult;
  }

  static getLastBatchResults(): readonly MediaFileProcessingResult[] {
    return lastBatchProcessingResults;
  }

  static resetForTests(): void {
    lastProcessingResult = null;
    lastBatchProcessingResults = [];
  }
}
