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
        text: '문서',
        items: [
          { text: '기능 맵', link: '/' },
          { text: '가이드', link: '/GUIDE/' },
          { text: '릴리즈 노트', link: '/RELEASE-MD/' },
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
