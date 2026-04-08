const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'CoNAI'
const base = process.env.GITHUB_ACTIONS ? `/${repoName}/` : '/'

export default {
  lang: 'ko-KR',
  title: 'CoNAI Docs',
  description: 'CoNAI 화면 구조와 숨은 핵심 시스템 문서',
  base,
  lastUpdated: true,
  cleanUrls: true,
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: '시스템', link: '/#core-systems' },
      { text: '페이지', link: '/#page-map' },
      { text: 'GitHub', link: 'https://github.com/cksdnfas/CoNAI' },
    ],
    sidebar: [
      {
        text: '숨은 핵심 시스템',
        items: [
          { text: '미디어 메타데이터 엔진', link: '/#system-media-metadata' },
          { text: '감시폴더 등록과 스캔', link: '/#system-folder-watch' },
          { text: '생성 저장 파이프라인', link: '/#system-generation-pipeline' },
          { text: '워크플로우 실행 엔진', link: '/#system-workflow-engine' },
          { text: 'MCP와 자동화 인터페이스', link: '/#system-mcp-automation' },
        ],
      },
      {
        text: '실제 페이지',
        items: [
          { text: 'Home', link: '/#page-home' },
          { text: 'Groups', link: '/#page-groups' },
          { text: 'Prompts', link: '/#page-prompts' },
          { text: 'Image Generation', link: '/#page-generation' },
          { text: 'Upload', link: '/#page-upload' },
          { text: 'Settings', link: '/#page-settings' },
          { text: 'Image Detail', link: '/#page-image-detail' },
          { text: 'Metadata Edit', link: '/#page-metadata-edit' },
          { text: 'Login / Not Found', link: '/#page-system-pages' },
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
