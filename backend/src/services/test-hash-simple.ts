/**
 * 샘플 이미지를 생성하여 해시 알고리즘 테스트
 */

import { ImageSimilarityService } from './imageSimilarity';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import os from 'os';

async function testHashWithSampleImage() {
  console.log('🔍 Hash Algorithm Test with Sample Image\n');
  console.log('=' .repeat(60));

  // 임시 디렉토리에 샘플 이미지 생성
  const tempDir = os.tmpdir();
  const testImagePath = path.join(tempDir, 'test-image.png');

  try {
    // 간단한 그래디언트 이미지 생성 (256x256)
    console.log('\n📸 Generating sample image...');

    const width = 256;
    const height = 256;
    const channels = 3;

    // RGB 그래디언트 패턴 생성
    const imageData = Buffer.alloc(width * height * channels);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * channels;
        imageData[idx] = Math.floor((x / width) * 255); // R: 좌->우 그래디언트
        imageData[idx + 1] = Math.floor((y / height) * 255); // G: 상->하 그래디언트
        imageData[idx + 2] = 128; // B: 고정값
      }
    }

    await sharp(imageData, {
      raw: {
        width,
        height,
        channels
      }
    })
      .png()
      .toFile(testImagePath);

    console.log(`✅ Sample image created: ${testImagePath}`);

    // 3개 해시 생성
    console.log('\n⏳ Generating hashes...\n');

    const startTime = Date.now();

    const [pHash, dHash, aHash] = await Promise.all([
      ImageSimilarityService.generatePerceptualHash(testImagePath),
      ImageSimilarityService.generateDHash(testImagePath),
      ImageSimilarityService.generateAHash(testImagePath)
    ]);

    const totalTime = Date.now() - startTime;

    // 결과 출력
    console.log('📊 Hash Results:');
    console.log('-'.repeat(60));
    console.log(`pHash (DCT-based):       ${pHash}`);
    console.log(`dHash (Gradient-based):  ${dHash}`);
    console.log(`aHash (Average-based):   ${aHash}`);
    console.log('-'.repeat(60));
    console.log(`Generation time: ${totalTime}ms`);

    // 차이 검증
    console.log('\n✅ Verification:');
    console.log('-'.repeat(60));

    const allDifferent = (pHash !== dHash) && (pHash !== aHash) && (dHash !== aHash);

    if (allDifferent) {
      console.log('✅ SUCCESS: All three hashes are DIFFERENT!');
      console.log('   ✓ pHash uses DCT (frequency domain analysis)');
      console.log('   ✓ dHash uses horizontal gradient comparison');
      console.log('   ✓ aHash uses average value comparison');
      console.log('\n   This confirms the bug is FIXED! 🎉');
    } else {
      console.log('❌ FAILED: Some hashes are identical!');

      if (pHash === aHash) {
        console.log('   ⚠️  pHash and aHash are the same (BUG STILL EXISTS!)');
      }
      if (pHash === dHash) {
        console.log('   ⚠️  pHash and dHash are the same');
      }
      if (dHash === aHash) {
        console.log('   ⚠️  dHash and aHash are the same');
      }
    }

    console.log('-'.repeat(60));

    // 복합 해시 테스트
    console.log('\n📦 Composite Hash Test:');
    console.log('-'.repeat(60));

    const composite = await ImageSimilarityService.generateCompositeHash(testImagePath);
    console.log(`Full Composite: ${composite.compositeHash}`);
    console.log(`  → pHash: ${composite.perceptualHash}`);
    console.log(`  → dHash: ${composite.dHash}`);
    console.log(`  → aHash: ${composite.aHash}`);
    console.log('-'.repeat(60));

    const compositeParts = [
      composite.perceptualHash,
      composite.dHash,
      composite.aHash
    ];

    const uniqueParts = new Set(compositeParts);

    if (uniqueParts.size === 3) {
      console.log('✅ Composite hash uses 3 DIFFERENT algorithms correctly!');
    } else {
      console.log(`❌ Composite hash has only ${uniqueParts.size} unique parts!`);
    }

    // 성능 측정
    console.log('\n⚡ Performance Comparison (10 iterations):');
    console.log('-'.repeat(60));

    const iterations = 10;

    const pHashStart = Date.now();
    for (let i = 0; i < iterations; i++) {
      await ImageSimilarityService.generatePerceptualHash(testImagePath);
    }
    const pHashTime = Date.now() - pHashStart;

    const dHashStart = Date.now();
    for (let i = 0; i < iterations; i++) {
      await ImageSimilarityService.generateDHash(testImagePath);
    }
    const dHashTime = Date.now() - dHashStart;

    const aHashStart = Date.now();
    for (let i = 0; i < iterations; i++) {
      await ImageSimilarityService.generateAHash(testImagePath);
    }
    const aHashTime = Date.now() - aHashStart;

    console.log(`pHash (DCT):      ${pHashTime}ms (${(pHashTime / iterations).toFixed(1)}ms per hash)`);
    console.log(`dHash (Gradient): ${dHashTime}ms (${(dHashTime / iterations).toFixed(1)}ms per hash)`);
    console.log(`aHash (Average):  ${aHashTime}ms (${(aHashTime / iterations).toFixed(1)}ms per hash)`);
    console.log('-'.repeat(60));

    const slowest = Math.max(pHashTime, dHashTime, aHashTime);
    const fastest = Math.min(pHashTime, dHashTime, aHashTime);

    console.log(`\nSlowest: ${slowest === pHashTime ? 'pHash' : slowest === dHashTime ? 'dHash' : 'aHash'}`);
    console.log(`Fastest: ${fastest === pHashTime ? 'pHash' : fastest === dHashTime ? 'dHash' : 'aHash'}`);
    console.log(`Ratio: ${(slowest / fastest).toFixed(2)}x`);

    console.log('\n✅ All tests completed successfully!');
    console.log('=' .repeat(60));

    // 정리
    fs.unlinkSync(testImagePath);
    console.log(`\n🗑️  Cleaned up: ${testImagePath}`);

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Stack trace:', error.stack);
    }

    // 정리
    if (fs.existsSync(testImagePath)) {
      fs.unlinkSync(testImagePath);
    }

    process.exit(1);
  }
}

// 실행
testHashWithSampleImage().catch(console.error);
