/**
 * Stealth PNG Extractor - LSB Steganography
 * Extracts hidden metadata from PNG images using LSB steganography
 * Based on NAI-Tag-Viewer implementation
 */

const SIGNATURES = {
  ALPHA_UNCOMPRESSED: 'stealth_pnginfo',
  ALPHA_COMPRESSED: 'stealth_pngcomp',
  RGB_UNCOMPRESSED: 'stealth_rgbinfo',
  RGB_COMPRESSED: 'stealth_rgbcomp'
} as const;

/**
 * Extract stealth PNG info - tries LSB method first, then marker method
 */
export async function extractStealthPngInfo(file: File): Promise<string | null> {
  console.log('🔍 [extractStealthPngInfo] Starting extraction...');

  try {
    // Method 1: Try LSB steganography (NovelAI method)
    const lsbResult = await extractStealthPngLSB(file);
    if (lsbResult) {
      console.log('✅ [extractStealthPngInfo] LSB method successful');
      return lsbResult;
    }

    // Method 2: Try simple marker method (fallback)
    console.log('🔍 [extractStealthPngInfo] LSB failed, trying simple marker method...');
    const markerResult = await extractStealthPngMarker(file);
    if (markerResult) {
      console.log('✅ [extractStealthPngInfo] Marker method successful');
      return markerResult;
    }

    console.log('❌ [extractStealthPngInfo] Both methods failed');
    return null;
  } catch (error) {
    console.error('❌ [extractStealthPngInfo] Error:', error);
    return null;
  }
}

/**
 * Extract stealth PNG info using LSB steganography
 */
async function extractStealthPngLSB(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          URL.revokeObjectURL(url);
          resolve(null);
          return;
        }

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const width = canvas.width;
        const height = canvas.height;
        const hasAlpha = true; // RGBA

        console.log(`🔍 [LSB] Scanning ${width}x${height} image (4 channels)`);

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

        const sigLength = SIGNATURES.ALPHA_UNCOMPRESSED.length * 8;

        // Scan pixels: x first, then y (matching Python order)
        outerLoop: for (let x = 0; x < width; x++) {
          for (let y = 0; y < height; y++) {
            const pixelIndex = (y * width + x) * 4; // RGBA = 4 bytes

            const r = data[pixelIndex];
            const g = data[pixelIndex + 1];
            const b = data[pixelIndex + 2];
            const a = data[pixelIndex + 3];

            if (hasAlpha) {
              bufferA += (a & 1).toString();
              indexA++;
            }

            bufferRgb += (r & 1).toString();
            bufferRgb += (g & 1).toString();
            bufferRgb += (b & 1).toString();
            indexRgb += 3;

            // Signature confirmation
            if (confirmingSignature) {
              if (indexA === sigLength && hasAlpha) {
                const decodedSig = binaryToString(bufferA);
                const matchedSig = matchSignature(decodedSig);

                if (matchedSig) {
                  confirmingSignature = false;
                  sigConfirmed = true;
                  readingParamLen = true;
                  mode = 'alpha';
                  compressed = matchedSig.compressed;
                  console.log(`✅ [LSB] Signature found: ${decodedSig} (mode: alpha, compressed: ${compressed})`);
                  bufferA = '';
                  indexA = 0;
                } else {
                  console.log(`❌ [LSB] No valid signature in alpha channel: ${decodedSig}`);
                  readEnd = true;
                  break outerLoop;
                }
              } else if (indexRgb === sigLength) {
                const decodedSig = binaryToString(bufferRgb);
                const matchedSig = matchSignature(decodedSig);

                if (matchedSig) {
                  confirmingSignature = false;
                  sigConfirmed = true;
                  readingParamLen = true;
                  mode = 'rgb';
                  compressed = matchedSig.compressed;
                  console.log(`✅ [LSB] Signature found: ${decodedSig} (mode: rgb, compressed: ${compressed})`);
                  bufferRgb = '';
                  indexRgb = 0;
                }
              }
            } else if (readingParamLen) {
              // Read parameter length (32 bits)
              if (mode === 'alpha') {
                if (indexA === 32) {
                  paramLen = parseInt(bufferA, 2);
                  console.log(`📊 [LSB] Data length: ${paramLen} bits`);
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
                  console.log(`📊 [LSB] Data length: ${paramLen} bits`);
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
                  console.log(`✅ [LSB] Data extraction complete`);
                  readEnd = true;
                  break outerLoop;
                }
              } else {
                if (indexRgb >= paramLen) {
                  const diff = paramLen - indexRgb;
                  if (diff < 0) {
                    bufferRgb = bufferRgb.slice(0, diff);
                  }
                  binaryData = bufferRgb;
                  console.log(`✅ [LSB] Data extraction complete`);
                  readEnd = true;
                  break outerLoop;
                }
              }
            } else {
              readEnd = true;
              break outerLoop;
            }
          }

          if (readEnd) {
            break;
          }
        }

        URL.revokeObjectURL(url);

        if (!sigConfirmed || binaryData === '') {
          console.log('❌ [LSB] No stealth data found');
          resolve(null);
          return;
        }

        // Convert binary string to bytes
        const byteData = binaryToBytes(binaryData);

        try {
          let decodedData: string;

          if (compressed) {
            console.log('🗜️ [LSB] Data is compressed - decompression not supported in browser');
            // Browser doesn't have built-in gzip decompression for raw bytes
            // This would require a library like pako
            resolve(null);
            return;
          } else {
            const decoder = new TextDecoder('utf-8');
            decodedData = decoder.decode(new Uint8Array(byteData));
          }

          console.log(`✅ [LSB] Successfully decoded ${decodedData.length} characters`);
          resolve(decodedData);
        } catch (error) {
          console.error('❌ [LSB] Decoding error:', error);
          resolve(null);
        }
      } catch (error) {
        console.error('❌ [LSB] Extraction error:', error);
        URL.revokeObjectURL(url);
        resolve(null);
      }
    };

    img.onerror = () => {
      console.error('❌ [LSB] Image load error');
      URL.revokeObjectURL(url);
      resolve(null);
    };

    img.src = url;
  });
}

/**
 * Extract stealth PNG info using simple marker method (fallback)
 */
async function extractStealthPngMarker(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const buffer = e.target?.result as ArrayBuffer;
        const data = new Uint8Array(buffer);

        // Search for stealth marker: "stealth_pnginfo"
        const marker = new TextEncoder().encode('stealth_pnginfo');

        for (let i = 0; i < data.length - marker.length - 4; i++) {
          let found = true;
          for (let j = 0; j < marker.length; j++) {
            if (data[i + j] !== marker[j]) {
              found = false;
              break;
            }
          }

          if (found) {
            // Read length (4 bytes little-endian after marker)
            const lengthStart = i + marker.length;
            const length =
              data[lengthStart] |
              (data[lengthStart + 1] << 8) |
              (data[lengthStart + 2] << 16) |
              (data[lengthStart + 3] << 24);

            // Read data
            const dataStart = lengthStart + 4;
            const stealthData = data.slice(dataStart, dataStart + length);
            const text = new TextDecoder().decode(stealthData);

            console.log('✅ [Marker] Successfully extracted');
            resolve(text);
            return;
          }
        }

        resolve(null);
      } catch (error) {
        console.error('❌ [Marker] Error:', error);
        resolve(null);
      }
    };

    reader.onerror = () => resolve(null);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Helper: Convert binary string to ASCII string
 */
function binaryToString(binary: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < binary.length; i += 8) {
    const byte = binary.substring(i, i + 8);
    if (byte.length === 8) {
      bytes.push(parseInt(byte, 2));
    }
  }
  return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
}

/**
 * Helper: Convert binary string to byte array
 */
function binaryToBytes(binary: string): number[] {
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
 * Helper: Match signature and return type info
 */
function matchSignature(sig: string): { type: 'alpha' | 'rgb'; compressed: boolean } | null {
  if (sig === SIGNATURES.ALPHA_UNCOMPRESSED) {
    return { type: 'alpha', compressed: false };
  }
  if (sig === SIGNATURES.ALPHA_COMPRESSED) {
    return { type: 'alpha', compressed: true };
  }
  if (sig === SIGNATURES.RGB_UNCOMPRESSED) {
    return { type: 'rgb', compressed: false };
  }
  if (sig === SIGNATURES.RGB_COMPRESSED) {
    return { type: 'rgb', compressed: true };
  }
  return null;
}
