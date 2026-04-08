const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'CoNAI'
const base = process.env.GITHUB_ACTIONS ? `/${repoName}/` : '/'

export default {
  lang: 'ko-KR',
  title: 'CoNAI Docs',
  description: 'CoNAI 기능 구조 문서',
  base,
  lastUpdated: true,
  cleanUrls: true,
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: '기능 맵', link: '/#search-browse' },
      { text: 'GitHub', link: 'https://github.com/cksdnfas/CoNAI' },
    ],
    sidebar: [
      {
        text: '기능별 보기',
        items: [
          { text: '검색과 탐색', link: '/#search-browse' },
          { text: '그룹과 분류', link: '/#grouping-curation' },
          { text: '생성과 워크플로우', link: '/#generation-workflow' },
          { text: '업로드와 추출', link: '/#upload-extract' },
          { text: '메타데이터와 파일 관리', link: '/#metadata-files' },
          { text: '라이브러리 수집과 폴더 연결', link: '/#library-folders' },
          { text: '운영 설정', link: '/#operations-settings' },
          { text: '자동화와 외부 연동', link: '/#automation-integration' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/cksdnfas/CoNAI' },
    ],
    search: {
      provider: 'local',
    },
    outline: false,
  },
}
