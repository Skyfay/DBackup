import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "DBackup",
  description: "Documentation and guides for DBackup",
  lang: 'en-US',
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/getting-started' }
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Getting Started', link: '/getting-started' },
          { text: 'Installation', link: '/installation' }
        ]
      },
      {
        text: 'Configuration',
        items: [
          { text: 'Databases', link: '/configuration/databases' },
          { text: 'Destinations', link: '/configuration/destinations' },
          { text: 'Notifications', link: '/configuration/notifications' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/database-backup-manager/database-backup-manager' }
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 DBackup'
    }
  }
})
