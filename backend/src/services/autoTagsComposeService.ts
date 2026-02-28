import { TaggerResult } from './taggerDaemon';

export interface KaloscopeResult {
  success: boolean;
  model?: string;
  topk?: number;
  artists?: Record<string, number>;
  taglist?: string;
  tagged_at?: string;
  error?: string;
  error_type?: string;
}

type AutoTagsRecord = Record<string, unknown>;

export class AutoTagsComposeService {
  private static readonly legacyTaggerKeys = [
    'caption',
    'taglist',
    'rating',
    'general',
    'character',
    'model',
    'thresholds',
    'tagged_at'
  ] as const;

  static parse(autoTagsJson: string | null | undefined): AutoTagsRecord {
    if (!autoTagsJson) {
      return { version: 2 };
    }

    try {
      const parsed = JSON.parse(autoTagsJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { version: 2 };
      }
      return parsed as AutoTagsRecord;
    } catch {
      return { version: 2 };
    }
  }

  static hasTagger(autoTagsJson: string | null | undefined): boolean {
    const parsed = this.parse(autoTagsJson);
    const tagger = parsed.tagger;
    const legacyRating = parsed.rating;
    const legacyGeneral = parsed.general;

    if (tagger && typeof tagger === 'object' && !Array.isArray(tagger)) {
      return true;
    }

    return !!(
      legacyRating && typeof legacyRating === 'object' &&
      legacyGeneral && typeof legacyGeneral === 'object'
    );
  }

  static hasKaloscope(autoTagsJson: string | null | undefined): boolean {
    const parsed = this.parse(autoTagsJson);
    const kaloscope = parsed.kaloscope;
    if (!kaloscope || typeof kaloscope !== 'object' || Array.isArray(kaloscope)) {
      return false;
    }

    const artists = (kaloscope as AutoTagsRecord).artists ?? (kaloscope as AutoTagsRecord).artist;
    return !!(artists && typeof artists === 'object' && Object.keys(artists as Record<string, unknown>).length > 0);
  }

  static mergeTagger(autoTagsJson: string | null | undefined, taggerResult: TaggerResult): string {
    const parsed = this.parse(autoTagsJson);
    const taggerPayload = {
      caption: taggerResult.caption || '',
      taglist: taggerResult.taglist || '',
      rating: taggerResult.rating || {},
      general: taggerResult.general || {},
      character: taggerResult.character || {},
      model: taggerResult.model || 'unknown',
      thresholds: taggerResult.thresholds || { general: 0.35, character: 0.75 },
      tagged_at: new Date().toISOString()
    };

    const merged: AutoTagsRecord = {
      ...parsed,
      version: 2,
      tagger: taggerPayload
    };

    for (const key of this.legacyTaggerKeys) {
      delete merged[key];
    }

    return JSON.stringify(merged);
  }

  static mergeKaloscope(autoTagsJson: string | null | undefined, kaloscopeResult: KaloscopeResult): string {
    const parsed = this.parse(autoTagsJson);

    const kaloscopePayload = {
      model: kaloscopeResult.model || 'kaloscope-onnx',
      topk: kaloscopeResult.topk || 0,
      artists: kaloscopeResult.artists || {},
      taglist: kaloscopeResult.taglist || '',
      tagged_at: kaloscopeResult.tagged_at || new Date().toISOString()
    };

    const merged: AutoTagsRecord = {
      ...parsed,
      version: 2,
      kaloscope: kaloscopePayload
    };

    return JSON.stringify(merged);
  }
}
