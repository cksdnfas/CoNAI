/**
 * Stealth PNG Info Extractor
 * Extracts hidden metadata from PNG images using LSB steganography
 * Based on NAI-Tag-Viewer: https://github.com/neggles/sd-webui-stealth-pnginfo/
 *
 * This implementation follows the exact logic from NAI-Tag-Viewer's stealth_pnginfo.py
 */

import sharp from 'sharp';
import zlib from 'zlib';
import { StealthPngSignature } from '../types';

export class StealthPngExtractor {
  private static readonly SIGNATURES = {
    ALPHA_UNCOMPRESSED: 'stealth_pnginfo',
    ALPHA_COMPRESSED: 'stealth_pngcomp',
    RGB_UNCOMPRESSED: 'stealth_rgbinfo',
    RGB_COMPRESSED: 'stealth_rgbcomp'
  } as const;

  /**
   * Extract stealth PNG info from image buffer
   * Follows NAI-Tag-Viewer logic exactly
   */
  static async extractStealthPngInfo(buffer: Buffer): Promise<string | null> {
    try {
      const image = sharp(buffer);
      const metadata = await image.metadata();

      if (!metadata.width || !metadata.height) {
        return null;
      }

      // Get raw pixel data
      const { data, info } = await image
        .raw()
        .toBuffer({ resolveWithObject: true });

      const width = info.width;
      const height = info.height;
      const channels = info.channels;
      const hasAlpha = channels === 4;

      console.log(`🔍 [StealthPNG] Scanning ${width}x${height} image (${channels} channels)`);

      // Variables matching NAI-Tag-Viewer exactly
      let mode: 'alpha' | 'rgb' | null = null;
      let compressed = false;
      let binaryData = '';
      let bufferA = '';
      let bufferRgb = '';
      let indexA = 0;
      let indexRgb = 0;
      let sigConfirmed = false;
      let confirmingSignature = true;
      let readingParamLen = false;
      let readingParam = false;
      let readEnd = false;
      let paramLen = 0;

      const sigLength = this.SIGNATURES.ALPHA_UNCOMPRESSED.length * 8;

      // Scan pixels: x first, then y (matching Python order)
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          const pixelIndex = (y * width + x) * channels;

          let r: number, g: number, b: number, a: number = 0;

          if (hasAlpha) {
            r = data[pixelIndex];
            g = data[pixelIndex + 1];
            b = data[pixelIndex + 2];
            a = data[pixelIndex + 3];
            bufferA += (a & 1).toString();
            indexA++;
          } else {
            r = data[pixelIndex];
            g = data[pixelIndex + 1];
            b = data[pixelIndex + 2];
          }

          bufferRgb += (r & 1).toString();
          bufferRgb += (g & 1).toString();
          bufferRgb += (b & 1).toString();
          indexRgb += 3;

          // Signature confirmation (matching NAI-Tag-Viewer if-elif structure)
          if (confirmingSignature) {
            if (indexA === sigLength && hasAlpha) {
              const decodedSig = this.binaryToString(bufferA);
              const matchedSig = this.matchSignature(decodedSig);

              if (matchedSig) {
                confirmingSignature = false;
                sigConfirmed = true;
                readingParamLen = true;
                mode = 'alpha';
                compressed = matchedSig.compressed;
                console.log(`✅ [StealthPNG] Signature found: ${decodedSig} (mode: alpha, compressed: ${compressed})`);
                bufferA = '';
                indexA = 0;
              } else {
                console.log(`❌ [StealthPNG] No valid signature in alpha channel: ${decodedSig}`);
                readEnd = true;
                break;
              }
            } else if (indexRgb === sigLength) {
              const decodedSig = this.binaryToString(bufferRgb);
              const matchedSig = this.matchSignature(decodedSig);

              if (matchedSig) {
                confirmingSignature = false;
                sigConfirmed = true;
                readingParamLen = true;
                mode = 'rgb';
                compressed = matchedSig.compressed;
                console.log(`✅ [StealthPNG] Signature found: ${decodedSig} (mode: rgb, compressed: ${compressed})`);
                bufferRgb = '';
                indexRgb = 0;
              }
            }
          } else if (readingParamLen) {
            // Read parameter length (32 bits)
            if (mode === 'alpha') {
              if (indexA === 32) {
                paramLen = parseInt(bufferA, 2);
                console.log(`📊 [StealthPNG] Data length: ${paramLen} bits`);
                readingParamLen = false;
                readingParam = true;
                bufferA = '';
                indexA = 0;
              }
            } else {
              if (indexRgb === 33) {
                const pop = bufferRgb[bufferRgb.length - 1];
                bufferRgb = bufferRgb.slice(0, -1);
                paramLen = parseInt(bufferRgb, 2);
                console.log(`📊 [StealthPNG] Data length: ${paramLen} bits`);
                readingParamLen = false;
                readingParam = true;
                bufferRgb = pop;
                indexRgb = 1;
              }
            }
          } else if (readingParam) {
            // Read actual parameter data
            if (mode === 'alpha') {
              if (indexA === paramLen) {
                binaryData = bufferA;
                console.log(`✅ [StealthPNG] Data extraction complete`);
                readEnd = true;
                break;
              }
            } else {
              if (indexRgb >= paramLen) {
                const diff = paramLen - indexRgb;
                if (diff < 0) {
                  bufferRgb = bufferRgb.slice(0, diff);
                }
                binaryData = bufferRgb;
                console.log(`✅ [StealthPNG] Data extraction complete`);
                readEnd = true;
                break;
              }
            }
          } else {
            // Impossible state
            readEnd = true;
            break;
          }
        }

        if (readEnd) {
          break;
        }
      }

      if (!sigConfirmed || binaryData === '') {
        console.log('❌ [StealthPNG] No stealth data found');
        return null;
      }

      // Convert binary string to bytes
      const byteData = this.binaryToBytes(binaryData);

      try {
        let decodedData: string;

        if (compressed) {
          console.log('🗜️ [StealthPNG] Decompressing gzip data...');
          const decompressed = zlib.gunzipSync(Buffer.from(byteData));
          decodedData = decompressed.toString('utf-8');
        } else {
          decodedData = Buffer.from(byteData).toString('utf-8');
        }

        console.log(`✅ [StealthPNG] Successfully decoded ${decodedData.length} characters`);
        return decodedData;
      } catch (error) {
        console.error('❌ [StealthPNG] Decompression/decoding error:', error);
        return null;
      }
    } catch (error) {
      console.error('❌ [StealthPNG] Extraction error:', error);
      return null;
    }
  }

  /**
   * Convert binary string to ASCII string
   */
  private static binaryToString(binary: string): string {
    const bytes: number[] = [];
    for (let i = 0; i < binary.length; i += 8) {
      const byte = binary.substring(i, i + 8);
      if (byte.length === 8) {
        bytes.push(parseInt(byte, 2));
      }
    }
    return Buffer.from(bytes).toString('utf-8');
  }

  /**
   * Convert binary string to byte array
   */
  private static binaryToBytes(binary: string): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < binary.length; i += 8) {
      const byte = binary.substring(i, i + 8);
      if (byte.length === 8) {
        bytes.push(parseInt(byte, 2));
      }
    }
    return bytes;
  }

  /**
   * Match signature and return type info
   */
  private static matchSignature(sig: string): StealthPngSignature | null {
    if (sig === this.SIGNATURES.ALPHA_UNCOMPRESSED) {
      return { type: 'alpha', compressed: false };
    }
    if (sig === this.SIGNATURES.ALPHA_COMPRESSED) {
      return { type: 'alpha', compressed: true };
    }
    if (sig === this.SIGNATURES.RGB_UNCOMPRESSED) {
      return { type: 'rgb', compressed: false };
    }
    if (sig === this.SIGNATURES.RGB_COMPRESSED) {
      return { type: 'rgb', compressed: true };
    }
    return null;
  }
}
