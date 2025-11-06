/**
 * pHash, aHash, dHash 차이 검증 테스트
 * 동일한 이미지에서 3개 해시가 서로 다른 값을 생성하는지 확인
 */

import { ImageSimilarityService } from '../../src/services/imageSimilarity';
import path from 'path';
import fs from 'fs';

async function testHashDifferences() {
  console.log('🔍 Hash Algorithm Difference Test\n');
  console.log('=' .repeat(60));

  // 테스트 이미지 경로 (업로드된 이미지 중 하나 사용)
  const uploadsDir = path.join(__dirname, '../../../uploads');

  // 첫 번째 이미지 찾기
  let testImagePath: string | null = null;

  if (fs.existsSync(uploadsDir)) {
    const dateDirs = fs.readdirSync(uploadsDir);

    for (const dateDir of dateDirs) {
      const datePath = path.join(uploadsDir, dateDir);
      if (fs.statSync(datePath).isDirectory()) {
        const files = fs.readdirSync(datePath).filter(f =>
          f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png')
        );

        if (files.length > 0) {
          testImagePath = path.join(datePath, files[0]);
          break;
        }
      }
    }
  }

  if (!testImagePath || !fs.existsSync(testImagePath)) {
    console.error('❌ No test image found in uploads directory');
    console.log('\nPlease upload at least one image to test the hash algorithms.');
    return;
  }

  console.log(`\n📁 Test Image: ${path.basename(testImagePath)}`);
  console.log('=' .repeat(60));

  try {
    // 3개 해시 생성
    console.log('\n⏳ Generating hashes...\n');

    const [pHash, dHash, aHash] = await Promise.all([
      ImageSimilarityService.generatePerceptualHash(testImagePath),
      ImageSimilarityService.generateDHash(testImagePath),
      ImageSimilarityService.generateAHash(testImagePath)
    ]);

    // 결과 출력
    console.log('📊 Hash Results:');
    console.log('-'.repeat(60));
    console.log(`pHash (DCT-based):       ${pHash}`);
    console.log(`dHash (Gradient-based):  ${dHash}`);
    console.log(`aHash (Average-based):   ${aHash}`);
    console.log('-'.repeat(60));

    // 차이 검증
    console.log('\n✅ Verification:');
    console.log('-'.repeat(60));

    const allDifferent = (pHash !== dHash) && (pHash !== aHash) && (dHash !== aHash);

    if (allDifferent) {
      console.log('✅ SUCCESS: All three hashes are different!');
      console.log('   → pHash uses DCT (frequency domain)');
      console.log('   → dHash uses gradient comparison');
      console.log('   → aHash uses average comparison');
    } else {
      console.log('❌ FAILED: Some hashes are identical!');

      if (pHash === aHash) {
        console.log('   ⚠️  pHash and aHash are the same (BUG!)');
      }
      if (pHash === dHash) {
        console.log('   ⚠️  pHash and dHash are the same (Unusual)');
      }
      if (dHash === aHash) {
        console.log('   ⚠️  dHash and aHash are the same (Unusual)');
      }
    }

    console.log('-'.repeat(60));

    // 복합 해시 테스트
    console.log('\n📦 Composite Hash Test:');
    console.log('-'.repeat(60));

    const composite = await ImageSimilarityService.generateCompositeHash(testImagePath);
    console.log(`Composite: ${composite.compositeHash}`);
    console.log(`  pHash:   ${composite.perceptualHash}`);
    console.log(`  dHash:   ${composite.dHash}`);
    console.log(`  aHash:   ${composite.aHash}`);
    console.log('-'.repeat(60));

    // 성능 측정
    console.log('\n⚡ Performance Test (10 iterations):');
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

    console.log(`pHash: ${pHashTime}ms (${(pHashTime / iterations).toFixed(1)}ms/iter)`);
    console.log(`dHash: ${dHashTime}ms (${(dHashTime / iterations).toFixed(1)}ms/iter)`);
    console.log(`aHash: ${aHashTime}ms (${(aHashTime / iterations).toFixed(1)}ms/iter)`);
    console.log('-'.repeat(60));

    console.log('\n✅ Test completed successfully!');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message);
    }
  }
}

// 실행
testHashDifferences().catch(console.error);
