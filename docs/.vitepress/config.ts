const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'CoNAI'
const base = process.env.GITHUB_ACTIONS ? `/${repoName}/` : '/'

export default {
  lang: 'ko-KR',
  title: 'CoNAI Docs',
  description: 'CoNAI 핵심 기능 문서',
  base,
  lastUpdated: true,
  cleanUrls: true,
  srcExclude: ['english-only-preprocess-report.md'],
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: '가이드', link: '/GUIDE/' },
      { text: '릴리즈 노트', link: '/RELEASE-MD/' },
    ],
    sidebar: [
      {
        text: '기능 맵',
        items: [
          { text: '기능 맵 보기', link: '/' },
        ],
      },
      {
        text: '가이드',
        items: [
          { text: '전체 가이드 보기', link: '/GUIDE/' },
          { text: '처음 시작하기', link: '/GUIDE/START_HERE' },
          { text: '설치와 실행', link: '/GUIDE/INSTALLATION' },
          { text: '초기 설정', link: '/GUIDE/INITIAL_SETUP' },
          { text: '데이터 경로와 백업', link: '/GUIDE/DATA_PATHS_AND_BACKUP' },
          { text: '감시 폴더와 백업 소스', link: '/GUIDE/WATCHED_FOLDERS' },
          { text: '홈/이미지 보기', link: '/GUIDE/MEDIA_LIBRARY_BASICS' },
          { text: '업로드와 메타데이터 추출', link: '/GUIDE/UPLOAD_AND_METADATA_EXTRACT' },
          { text: '이미지 상세와 유사도 검사', link: '/GUIDE/IMAGE_DETAIL_AND_SIMILARITY' },
          { text: '이미지 메타데이터 편집', link: '/GUIDE/EDIT_IMAGE_METADATA' },
          { text: '그룹 관리', link: '/GUIDE/GROUPS_GUIDE' },
          { text: '프롬프트 관리', link: '/GUIDE/PROMPTS_GUIDE' },
          { text: '이미지 생성 개요', link: '/GUIDE/GENERATION_OVERVIEW' },
          { text: 'NAI 생성', link: '/GUIDE/NAI_GENERATION' },
          { text: 'Codex 생성', link: '/GUIDE/CODEX_GENERATION' },
          { text: 'ComfyUI 생성', link: '/GUIDE/COMFYUI_GENERATION' },
          { text: '워크플로우 편집', link: '/GUIDE/WORKFLOW_EDITOR' },
          { text: '설정 전체 지도', link: '/GUIDE/SETTINGS_OVERVIEW' },
          { text: '보안과 권한', link: '/GUIDE/SECURITY_AND_PERMISSIONS' },
          { text: 'MCP 가이드', link: '/GUIDE/MCP_GUIDE' },
          { text: '문제 해결', link: '/GUIDE/TROUBLESHOOTING' },
        ],
      },
      {
        text: '릴리즈 노트',
        items: [
          { text: '26.6.8 작업 노트', link: '/RELEASE-MD/RELEASE_26.6.8' },
          { text: '최신 안정 릴리즈 · 26.6.3', link: '/RELEASE-MD/RELEASE_26.6.3' },
          { text: '이전 릴리즈 · 26.05.23', link: '/RELEASE-MD/RELEASE_26.05.23' },
          { text: '전체 릴리즈 보기', link: '/RELEASE-MD/' },
        ],
      },
    ],
    socialLinks: [],
    search: {
      provider: 'local',
    },
    outline: false,
  },
}
