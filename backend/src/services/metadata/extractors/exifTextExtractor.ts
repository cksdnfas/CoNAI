export class ExifTextExtractor {
  private static normalize(value: string): string {
    return value.replace(/\u0000/g, '').trim();
  }

  private static extractPrintableSegments(buffer: Buffer, minLength: number = 8): string[] {
    const text = buffer.toString('latin1');
    const matches = text.match(/[\x20-\x7E\r\n\t]{8,}/g) || [];
    return Array.from(new Set(matches.map((value) => this.normalize(value)).filter((value) => value.length >= minLength)));
  }

  private static decodeUtf16LeSegments(buffer: Buffer, minLength: number = 8): string[] {
    const segments: string[] = [];

    for (let offset = 0; offset + 4 <= buffer.length; offset += 2) {
      const view = buffer.subarray(offset);
      const decoded = view.toString('utf16le');
      const cleaned = decoded.replace(/\u0000/g, '');
      const matches = cleaned.match(/[\x20-\x7E\u00A0-\uFFFF\r\n\t]{8,}/g) || [];
      for (const match of matches) {
        const normalized = this.normalize(match);
        if (normalized.length >= minLength) {
          segments.push(normalized);
        }
      }
    }

    return Array.from(new Set(segments));
  }

  static extractCandidateTexts(buffer: Buffer): string[] {
    return Array.from(new Set([
      ...this.extractPrintableSegments(buffer),
      ...this.decodeUtf16LeSegments(buffer),
      this.normalize(buffer.toString('utf8')),
      this.normalize(buffer.toString('latin1')),
    ].filter((value) => value.length > 0)));
  }

  private static scoreCandidate(candidate: string): number {
    let score = 0;

    if (candidate.includes('parameters') && candidate.includes('Steps:')) score += 50;
    if (candidate.includes('Steps:') && candidate.includes('Sampler:')) score += 40;
    if (candidate.includes('Negative prompt:')) score += 20;
    if (candidate.includes('NovelAI')) score += 15;
    if (candidate.includes('ComfyUI')) score += 15;
    if (candidate.includes('"prompt"')) score += 10;
    if (candidate.includes('"steps"')) score += 10;
    if (candidate.startsWith('ExifII*')) score -= 30;
    if (candidate.includes('ExifII*')) score -= 20;

    return score;
  }

  static normalizeAiMetadataText(value: string): string {
    return this.normalize(value)
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\n');
  }

  static findLikelyAiMetadataText(buffer: Buffer): string | null {
    const candidates = this.extractCandidateTexts(buffer)
      .map((candidate) => ({ candidate: this.normalizeAiMetadataText(candidate), score: this.scoreCandidate(candidate) }))
      .sort((a, b) => b.score - a.score || a.candidate.length - b.candidate.length);

    const preferred = candidates.find(({ score }) => score > 0);
    if (preferred) {
      return preferred.candidate;
    }

    return candidates.find(({ candidate }) => candidate.length >= 24)?.candidate || null;
  }
}
