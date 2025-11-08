/**
 * 경로 정규화 함수 테스트 스크립트
 */

import { normalizeWindowsDriveLetter } from '../src/utils/pathResolver';

const testCases = [
  { input: 'd:\\_Dev\\test.png', expected: 'D:\\_Dev\\test.png' },
  { input: 'D:\\_Dev\\test.png', expected: 'D:\\_Dev\\test.png' },
  { input: 'c:/windows/path.jpg', expected: 'C:/windows/path.jpg' },
  { input: 'C:/windows/path.jpg', expected: 'C:/windows/path.jpg' },
  { input: '/unix/path/test.png', expected: '/unix/path/test.png' },
  { input: '\\\\network\\share\\file.png', expected: '\\\\network\\share\\file.png' },
];

console.log('=== Path Normalization Tests ===\n');

let passedCount = 0;
let failedCount = 0;

for (const testCase of testCases) {
  const result = normalizeWindowsDriveLetter(testCase.input);
  const passed = result === testCase.expected;

  if (passed) {
    passedCount++;
    console.log(`✅ PASS: "${testCase.input}" → "${result}"`);
  } else {
    failedCount++;
    console.log(`❌ FAIL: "${testCase.input}"`);
    console.log(`   Expected: "${testCase.expected}"`);
    console.log(`   Got:      "${result}"`);
  }
}

console.log(`\n=== Results ===`);
console.log(`Passed: ${passedCount}/${testCases.length}`);
console.log(`Failed: ${failedCount}/${testCases.length}`);

process.exit(failedCount > 0 ? 1 : 0);
