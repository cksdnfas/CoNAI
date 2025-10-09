#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🚀 ComfyUI Image Manager 설정을 시작합니다...\n');

// 필요한 디렉토리 생성
const directories = [
  './uploads',
  './database',
  './backend/logs',
  './backend/temp'
];

console.log('📁 필요한 디렉토리를 생성합니다...');
directories.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`  ✅ ${dir} 생성 완료`);
  } else {
    console.log(`  ⚠️  ${dir} 이미 존재함`);
  }
});

// .env 파일 생성
console.log('\n🔧 환경 설정 파일을 생성합니다...');

const envFiles = [
  {
    source: './backend/.env.example',
    target: './backend/.env',
    name: 'Backend .env'
  },
  {
    source: './frontend/.env.example',
    target: './frontend/.env',
    name: 'Frontend .env'
  }
];

envFiles.forEach(({ source, target, name }) => {
  if (!fs.existsSync(target)) {
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, target);
      console.log(`  ✅ ${name} 파일 생성 완료`);
    } else {
      console.log(`  ❌ ${source} 파일을 찾을 수 없습니다`);
    }
  } else {
    console.log(`  ⚠️  ${name} 파일이 이미 존재합니다`);
  }
});

console.log('\n📦 의존성 설치 가이드:');
console.log('  1. 루트 디렉토리에서: npm install');
console.log('  2. 전체 의존성 설치: npm run install:all');
console.log('\n🚀 개발 서버 실행:');
console.log('  - 전체 실행: npm run dev');
console.log('  - 프론트엔드만: npm run dev:frontend');
console.log('  - 백엔드만: npm run dev:backend');

console.log('\n✨ 설정이 완료되었습니다!');
console.log('💡 .env 파일에서 필요한 설정을 수정해주세요.');