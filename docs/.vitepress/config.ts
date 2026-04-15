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
    nav: [],
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
          { text: 'MCP 가이드', link: '/GUIDE/MCP_GUIDE' },
        ],
      },
      {
        text: '릴리즈 노트',
        items: [
          { text: '최신 릴리즈 · 26.4.15', link: '/RELEASE-MD/RELEASE_26.4.15' },
          { text: '이전 릴리즈 · 26.4.13', link: '/RELEASE-MD/RELEASE_26.4.13' },
          { text: '전전 릴리즈 · 26.4.8', link: '/RELEASE-MD/RELEASE_26.4.8' },
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
