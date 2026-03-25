import sharp from 'sharp';
import zlib from 'zlib';

/**
 * WebP alpha stealth metadata extractor.
 * Supports NovelAI-style `stealth_pngcomp` / `stealth_pnginfo` payloads hidden in alpha-channel LSBs.
 */
export class WebPStealthExtractor {
  private static readonly SIGNATURES = {
    ALPHA_UNCOMPRESSED: 'stealth_pnginfo',
    ALPHA_COMPRESSED: 'stealth_pngcomp',
  } as const;

  private static readonly SIGNATURE_BIT_LENGTH = WebPStealthExtractor.SIGNATURES.ALPHA_UNCOMPRESSED.length * 8;
  private static readonly MAX_DATA_BITS = WebPStealthExtractor.SIGNATURE_BIT_LENGTH + 32 + 2_000_000;

  /**
   * Extract raw metadata object from a WebP buffer.
   */
  static async extract(buffer: Buffer): Promise<Record<string, any> | null> {
    try {
      const { data, info } = await sharp(buffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const width = info.width;
      const height = info.height;
      const channels = info.channels;
      const alphaBits: number[] = [];

      let done = false;
      for (let x = 0; x < width && !done; x++) {
        for (let y = 0; y < height && !done; y++) {
          const base = (y * width + x) * channels;
          alphaBits.push(data[base + 3] & 1);
          if (alphaBits.length >= this.MAX_DATA_BITS) {
            done = true;
          }
        }
      }

      return this.decodeAlphaBits(alphaBits);
    } catch (error) {
      console.warn('WebP stealth extraction error:', error);
      return null;
    }
  }

  /**
   * Decode NovelAI-style stealth payload from alpha LSB bits.
   */
  private static decodeAlphaBits(bits: number[]): Record<string, any> | null {
    if (bits.length < this.SIGNATURE_BIT_LENGTH + 32) {
      return null;
    }

    const signature = this.decodeSignature(bits);
    const isCompressed = signature === this.SIGNATURES.ALPHA_COMPRESSED;
    const isUncompressed = signature === this.SIGNATURES.ALPHA_UNCOMPRESSED;

    if (!isCompressed && !isUncompressed) {
      return null;
    }

    let bitLength = 0;
    for (let i = 0; i < 32; i++) {
      bitLength = bitLength * 2 + bits[this.SIGNATURE_BIT_LENGTH + i];
    }

    const dataStart = this.SIGNATURE_BIT_LENGTH + 32;
    if (bits.length < dataStart + bitLength) {
      return null;
    }

    const byteData = Buffer.alloc(Math.ceil(bitLength / 8));
    for (let i = 0; i < bitLength; i++) {
      if (bits[dataStart + i]) {
        byteData[i >> 3] |= 0x80 >> (i & 7);
      }
    }

    try {
      const payload = isCompressed
        ? zlib.gunzipSync(byteData).toString('utf8')
        : byteData.toString('utf8');

      return JSON.parse(payload) as Record<string, any>;
    } catch {
      return null;
    }
  }

  /**
   * Decode the 15-byte stealth signature from alpha bits.
   */
  private static decodeSignature(bits: number[]): string {
    const chars: number[] = [];

    for (let i = 0; i < this.SIGNATURES.ALPHA_UNCOMPRESSED.length; i++) {
      let byte = 0;
      for (let j = 0; j < 8; j++) {
        byte = (byte << 1) | bits[i * 8 + j];
      }
      chars.push(byte);
    }

    return Buffer.from(chars).toString('ascii');
  }
}
