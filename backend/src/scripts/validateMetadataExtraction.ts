import assert from 'assert';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import sharp from 'sharp';
import { MetadataExtractor } from '../services/metadata';
import { ImageMetadataWriteService } from '../services/imageMetadataWriteService';
import { WebPConversionService } from '../services/webpConversionService';

/**
 * Build a CRC32 for handcrafted PNG chunks.
 */
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Build a PNG chunk from type and payload bytes.
 */
function createPngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])) >>> 0, 0);
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

/**
 * Insert a PNG tEXt chunk before IEND.
 */
function insertTextChunk(pngBuffer: Buffer, key: string, value: string): Buffer {
  const iendMarkerOffset = pngBuffer.lastIndexOf(Buffer.from('IEND'));
  const iendChunkOffset = iendMarkerOffset - 4;
  const chunkData = Buffer.concat([
    Buffer.from(key, 'utf8'),
    Buffer.from([0]),
    Buffer.from(value, 'utf8')
  ]);
  const textChunk = createPngChunk('tEXt', chunkData);
  return Buffer.concat([
    pngBuffer.slice(0, iendChunkOffset),
    textChunk,
    pngBuffer.slice(iendChunkOffset)
  ]);
}

/**
 * Convert a byte buffer into MSB-first bits.
 */
function bufferToBits(buffer: Buffer): number[] {
  const bits: number[] = [];
  for (const byte of buffer) {
    for (let bit = 7; bit >= 0; bit--) {
      bits.push((byte >> bit) & 1);
    }
  }
  return bits;
}

/**
 * Convert a number into fixed-length MSB-first bits.
 */
function numberToBits(value: number, length: number): number[] {
  const bits = new Array<number>(length).fill(0);
  for (let i = 0; i < length; i++) {
    bits[length - 1 - i] = (value >> i) & 1;
  }
  return bits;
}

/**
 * Create a PNG fixture with WebUI parameters.
 */
async function createWebUiPngFixture(filePath: string): Promise<{ prompt: string }> {
  const prompt = [
    'masterpiece, 1girl',
    'Negative prompt: lowres, blurry',
    'Steps: 28, Sampler: Euler a, CFG scale: 7, Seed: 1234, Size: 832x1216, Model: animeModel'
  ].join('\n');

  const basePng = await sharp({
    create: {
      width: 832,
      height: 1216,
      channels: 3,
      background: { r: 255, g: 0, b: 0 }
    }
  }).png().toBuffer();

  fs.writeFileSync(filePath, insertTextChunk(basePng, 'parameters', prompt));
  return { prompt };
}

/**
 * Create a JPEG fixture with EXIF prompt text.
 */
async function createExifJpegFixture(filePath: string): Promise<void> {
  await sharp({
    create: {
      width: 640,
      height: 640,
      channels: 3,
      background: { r: 0, g: 255, b: 0 }
    }
  })
    .jpeg()
    .withExif({
      IFD0: {
        ImageDescription: 'masterpiece, 1girl\\nNegative prompt: lowres\\nSteps: 20, Sampler: Euler a'
      }
    })
    .toFile(filePath);
}

function createNovelAiPayload() {
  return {
    Description: '1girl, breakfast scene',
    Software: 'NovelAI',
    Source: 'NovelAI Diffusion V4.5 4BDE2A90',
    Comment: JSON.stringify({
      prompt: '1girl, breakfast scene',
      steps: 26,
      height: 1024,
      width: 1024,
      scale: 4.0,
      cfg_rescale: 0.0,
      seed: 1496421763,
      noise_schedule: 'karras',
      sampler: 'k_euler_ancestral',
      v4_prompt: {
        caption: {
          base_caption: '1girl, breakfast scene',
          char_captions: []
        },
        use_coords: false,
        use_order: true,
        legacy_uc: false
      },
      v4_negative_prompt: {
        caption: {
          base_caption: 'lowres, bad anatomy',
          char_captions: []
        },
        use_coords: false,
        use_order: false,
        legacy_uc: false
      },
      uc: 'lowres, bad anatomy',
      version: 1
    })
  };
}

/**
 * Build raw RGBA pixels containing alpha-channel stealth metadata.
 */
function createAlphaStealthRawImage(payload: Record<string, unknown>): { raw: Buffer; width: number; height: number } {
  const signature = 'stealth_pngcomp';
  const compressedPayload = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
  const bits = [
    ...bufferToBits(Buffer.from(signature, 'ascii')),
    ...numberToBits(compressedPayload.length * 8, 32),
    ...bufferToBits(compressedPayload)
  ];

  const width = 256;
  const height = 256;
  const pixelCount = width * height;
  assert(bits.length <= pixelCount, 'Stealth payload does not fit in fixture dimensions');

  const raw = Buffer.alloc(pixelCount * 4);
  raw.fill(48);

  let bitIndex = 0;
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const base = (y * width + x) * 4;
      raw[base] = 120;
      raw[base + 1] = 180;
      raw[base + 2] = 240;
      raw[base + 3] = 254;

      if (bitIndex < bits.length) {
        raw[base + 3] = bits[bitIndex] ? 255 : 254;
        bitIndex += 1;
      }
    }
  }

  return { raw, width, height };
}

/**
 * Create a PNG fixture with ComfyUI workflow metadata.
 */
async function createComfyUiPngFixture(filePath: string): Promise<void> {
  const workflow = {
    '1': {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'cinematic portrait, 1girl' }
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'lowres, blurry' }
    },
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed: 4242,
        steps: 30,
        cfg: 6.5,
        sampler_name: 'dpmpp_2m',
        scheduler: 'karras',
        denoise: 1
      }
    },
    '4': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: 'dreamshaper.safetensors' }
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { width: 1024, height: 1536 }
    }
  };

  const basePng = await sharp({
    create: {
      width: 1024,
      height: 1536,
      channels: 3,
      background: { r: 80, g: 40, b: 180 }
    }
  }).png().toBuffer();

  fs.writeFileSync(filePath, insertTextChunk(basePng, 'prompt', JSON.stringify(workflow)));
}

/**
 * Create a PNG fixture with NovelAI stealth metadata in alpha-channel LSBs.
 */
async function createStealthPngFixture(filePath: string): Promise<void> {
  const stealthImage = createAlphaStealthRawImage(createNovelAiPayload());
  await sharp(stealthImage.raw, {
    raw: {
      width: stealthImage.width,
      height: stealthImage.height,
      channels: 4
    }
  }).png().toFile(filePath);
}

/**
 * Create a WebP fixture with NovelAI stealth metadata in alpha-channel LSBs.
 */
async function createStealthWebPFixture(filePath: string): Promise<void> {
  const stealthImage = createAlphaStealthRawImage(createNovelAiPayload());
  await sharp(stealthImage.raw, {
    raw: {
      width: stealthImage.width,
      height: stealthImage.height,
      channels: 4
    }
  }).webp({ lossless: true }).toFile(filePath);
}

/**
 * Ensure extracted metadata matches key expectations.
 */
function assertMatch(label: string, actual: any, expected: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(expected)) {
    assert.deepStrictEqual(actual[key], value, `${label}: expected ${key}=${JSON.stringify(value)} but got ${JSON.stringify(actual[key])}`);
  }
}

/**
 * Run metadata extraction validation against generated fixtures.
 */
async function main(): Promise<void> {
  const fixtureDir = path.resolve(process.cwd(), 'tmp', 'metadata-validation');
  fs.mkdirSync(fixtureDir, { recursive: true });

  const pngPath = path.join(fixtureDir, 'webui.png');
  const comfyUiPngPath = path.join(fixtureDir, 'comfyui.png');
  const stealthPngPath = path.join(fixtureDir, 'novelai-stealth.png');
  const jpegPath = path.join(fixtureDir, 'webui-exif.jpg');
  const stealthWebPPath = path.join(fixtureDir, 'novelai-stealth.webp');
  const standardPngPath = path.join(fixtureDir, 'standardized.png');
  const standardJpegPath = path.join(fixtureDir, 'standardized.jpg');
  const convertedWebPPath = path.join(fixtureDir, 'converted-xmp.webp');

  await createWebUiPngFixture(pngPath);
  await createComfyUiPngFixture(comfyUiPngPath);
  await createStealthPngFixture(stealthPngPath);
  await createExifJpegFixture(jpegPath);
  await createStealthWebPFixture(stealthWebPPath);

  const standardizedPng = await ImageMetadataWriteService.writeFileAsFormatBuffer(pngPath, {
    format: 'png',
    sourcePathForMetadata: pngPath,
    originalFileName: path.basename(pngPath),
    mimeType: 'image/png'
  });
  fs.writeFileSync(standardPngPath, standardizedPng.buffer);

  const standardizedJpeg = await ImageMetadataWriteService.writeFileAsFormatBuffer(pngPath, {
    format: 'jpeg',
    quality: 92,
    sourcePathForMetadata: pngPath,
    originalFileName: path.basename(pngPath),
    mimeType: 'image/png'
  });
  fs.writeFileSync(standardJpegPath, standardizedJpeg.buffer);

  const converted = await WebPConversionService.convertFileToWebPBuffer(pngPath, {
    quality: 90,
    sourcePathForMetadata: pngPath,
    originalFileName: path.basename(pngPath),
    mimeType: 'image/png'
  });
  fs.writeFileSync(convertedWebPPath, converted.buffer);

  const pngResult = await MetadataExtractor.extractMetadata(pngPath);
  const comfyUiPngResult = await MetadataExtractor.extractMetadata(comfyUiPngPath);
  const stealthPngResult = await MetadataExtractor.extractMetadata(stealthPngPath);
  const jpegResult = await MetadataExtractor.extractMetadata(jpegPath);
  const standardPngResult = await MetadataExtractor.extractMetadata(standardPngPath);
  const standardJpegResult = await MetadataExtractor.extractMetadata(standardJpegPath);
  const stealthWebPResult = await MetadataExtractor.extractMetadata(stealthWebPPath);
  const convertedWebPResult = await MetadataExtractor.extractMetadata(convertedWebPPath);

  assertMatch('PNG WebUI', pngResult.ai_info, {
    prompt: 'masterpiece, 1girl',
    negative_prompt: 'lowres, blurry',
    steps: 28,
    sampler: 'Euler a',
    model: 'animeModel'
  });

  assertMatch('ComfyUI PNG', comfyUiPngResult.ai_info, {
    ai_tool: 'ComfyUI',
    prompt: 'cinematic portrait, 1girl',
    negative_prompt: 'lowres, blurry',
    steps: 30,
    sampler: 'dpmpp_2m',
    scheduler: 'karras',
    cfg_scale: 6.5,
    seed: 4242,
    width: 1024,
    height: 1536,
    model: 'dreamshaper.safetensors'
  });

  assertMatch('NovelAI stealth PNG', stealthPngResult.ai_info, {
    ai_tool: 'NovelAI',
    prompt: '1girl, breakfast scene',
    negative_prompt: 'lowres, bad anatomy',
    steps: 26,
    sampler: 'k_euler_ancestral',
    seed: 1496421763,
    width: 1024,
    height: 1024,
    model: 'NovelAI Diffusion V4.5'
  });

  assertMatch('JPEG EXIF', jpegResult.ai_info, {
    prompt: 'masterpiece, 1girl',
    negative_prompt: 'lowres',
    steps: 20,
    sampler: 'Euler a'
  });

  assertMatch('PNG standard metadata', standardPngResult.ai_info, {
    prompt: 'masterpiece, 1girl',
    negative_prompt: 'lowres, blurry',
    steps: 28,
    sampler: 'Euler a',
    model: 'animeModel'
  });

  assertMatch('JPEG standard metadata', standardJpegResult.ai_info, {
    prompt: 'masterpiece, 1girl',
    negative_prompt: 'lowres, blurry',
    steps: 28,
    sampler: 'Euler a',
    model: 'animeModel'
  });

  assertMatch('WebP XMP', convertedWebPResult.ai_info, {
    prompt: 'masterpiece, 1girl',
    negative_prompt: 'lowres, blurry',
    steps: 28,
    sampler: 'Euler a',
    model: 'animeModel'
  });

  assertMatch('WebP stealth', stealthWebPResult.ai_info, {
    ai_tool: 'NovelAI',
    prompt: '1girl, breakfast scene',
    negative_prompt: 'lowres, bad anatomy',
    steps: 26,
    sampler: 'k_euler_ancestral',
    seed: 1496421763,
    width: 1024,
    height: 1024,
    model: 'NovelAI Diffusion V4.5'
  });

  console.log('✅ Metadata validation passed');
  console.log(`   PNG WebUI fixture: ${pngPath}`);
  console.log(`   PNG ComfyUI fixture: ${comfyUiPngPath}`);
  console.log(`   PNG stealth fixture: ${stealthPngPath}`);
  console.log(`   JPEG EXIF fixture: ${jpegPath}`);
  console.log(`   PNG standard-metadata fixture: ${standardPngPath}`);
  console.log(`   JPEG standard-metadata fixture: ${standardJpegPath}`);
  console.log(`   WebP XMP fixture: ${convertedWebPPath}`);
  console.log(`   WebP stealth fixture: ${stealthWebPPath}`);
}

main().catch((error) => {
  console.error('❌ Metadata validation failed');
  console.error(error);
  process.exit(1);
});
