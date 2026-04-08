const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'CoNAI'
const base = process.env.GITHUB_ACTIONS ? `/${repoName}/` : '/'

export default {
  lang: 'ko-KR',
  title: 'CoNAI Docs',
  description: 'CoNAI 핵심 기능 문서',
  base,
  lastUpdated: true,
  cleanUrls: true,
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: '기능 맵', link: '/#library-search' },
      { text: 'GitHub', link: 'https://github.com/cksdnfas/CoNAI' },
    ],
    sidebar: [
      {
        text: '핵심 기능',
        items: [
          { text: '라이브러리 탐색과 검색', link: '/#library-search' },
          { text: '컬렉션 정리', link: '/#collections' },
          { text: '이미지 분석과 자동 분류', link: '/#analysis' },
          { text: 'AI 생성과 워크플로우', link: '/#generation' },
          { text: '자동 수집과 자동화', link: '/#automation' },
          { text: '저장과 내보내기', link: '/#export' },
          { text: '사용자 커스텀', link: '/#customization' },
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
