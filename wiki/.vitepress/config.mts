import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "DBackup",
  description: "Self-hosted database backup automation with encryption, compression, and retention policies",
  lang: 'en-US',
  cleanUrls: true, // Remove .html from URLs for better SEO
  lastUpdated: true, // Show last updated timestamp (uses git commit timestamps)
  sitemap: {
    hostname: 'https://dbackup.app'
  },
  ignoreDeadLinks: [
    /localhost/
  ],
  head: [
    // Favicons - Multiple sizes for best compatibility
    ['link', { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon/favicon-16x16.png' }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon/favicon-32x32.png' }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '64x64', href: '/favicon/favicon-64x64.png' }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '128x128', href: '/favicon/favicon-128x128.png' }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '256x256', href: '/favicon/favicon-256x256.png' }],
    ['link', { rel: 'apple-touch-icon', sizes: '180x180', href: '/favicon/favicon-256x256.png' }], // iOS uses closest size
    // SEO Meta Tags
    ['meta', { name: 'keywords', content: 'database backup, mysql backup, postgresql backup, mongodb backup, automated backup, encryption, compression, self-hosted, docker' }],
    ['meta', { name: 'author', content: 'Skyfay' }],
    ['meta', { name: 'robots', content: 'index, follow' }],
    // Open Graph / Facebook
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:url', content: 'https://dbackup.app' }],
    ['meta', { property: 'og:title', content: 'DBackup - Database Backup Automation' }],
    ['meta', { property: 'og:description', content: 'Self-hosted database backup automation with encryption, compression, and retention policies for MySQL, PostgreSQL, MongoDB, and more.' }],
    ['meta', { property: 'og:image', content: 'https://dbackup.app/logo.svg' }], // TODO: Create a proper og-image.png (1200x630)
    // Twitter Card
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:url', content: 'https://dbackup.app' }],
    ['meta', { name: 'twitter:title', content: 'DBackup - Database Backup Automation' }],
    ['meta', { name: 'twitter:description', content: 'Self-hosted database backup automation with encryption, compression, and retention policies.' }],
    // Structured Data (JSON-LD)
    ['script', { type: 'application/ld+json' }, JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      'name': 'DBackup',
      'description': 'Self-hosted database backup automation with encryption, compression, and retention policies',
      'applicationCategory': 'DeveloperApplication',
      'operatingSystem': 'Docker, Linux',
      'offers': {
        '@type': 'Offer',
        'price': '0',
        'priceCurrency': 'USD'
      },
      'aggregateRating': {
        '@type': 'AggregateRating',
        'ratingValue': '5',
        'ratingCount': '1'
      }
    })]
  ],
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    logo: '/logo.svg',

    // Format last updated date in European format (DD.MM.YYYY HH:MM)
    // Uses de-CH locale for date formatting while site remains en-US
    lastUpdated: {
      text: 'Last updated',
      formatOptions: {
        dateStyle: 'short',
        timeStyle: 'short'
      }
    },

    nav: [
      { text: 'Home', link: '/' },
      { text: 'User Guide', link: '/user-guide/getting-started' },
      { text: 'Developer Guide', link: '/developer-guide/' },
      {
        text: 'Resources',
        items: [
          { text: 'Screenshots', link: '/screenshots' },
          { text: 'Changelog', link: '/changelog' },
          { text: 'Roadmap', link: '/roadmap' },
          { text: 'GitHub', link: 'https://github.com/Skyfay/dbackup' },
          { text: 'GitLab', link: 'https://gitlab.com/Skyfay/dbackup' }
        ]
      }
    ],

    sidebar: {
      '/user-guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Introduction', link: '/user-guide/getting-started' },
            { text: 'Installation', link: '/user-guide/installation' },
            { text: 'First Backup', link: '/user-guide/first-backup' }
          ]
        },
        {
          text: 'Database Sources',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/user-guide/sources/' },
            { text: 'MySQL / MariaDB', link: '/user-guide/sources/mysql' },
            { text: 'PostgreSQL', link: '/user-guide/sources/postgresql' },
            { text: 'MongoDB', link: '/user-guide/sources/mongodb' },
            { text: 'Redis', link: '/user-guide/sources/redis' },
            { text: 'SQLite', link: '/user-guide/sources/sqlite' },
            { text: 'Microsoft SQL Server', link: '/user-guide/sources/mssql' }
          ]
        },
        {
          text: 'Storage Destinations',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/user-guide/destinations/' },
            { text: 'Local Filesystem', link: '/user-guide/destinations/local' },
            { text: 'Amazon S3', link: '/user-guide/destinations/s3-aws' },
            { text: 'S3 Compatible', link: '/user-guide/destinations/s3-generic' },
            { text: 'Cloudflare R2', link: '/user-guide/destinations/s3-r2' },
            { text: 'Hetzner Object Storage', link: '/user-guide/destinations/s3-hetzner' },
            { text: 'SFTP', link: '/user-guide/destinations/sftp' }
          ]
        },
        {
          text: 'Backup Jobs',
          collapsed: false,
          items: [
            { text: 'Creating Jobs', link: '/user-guide/jobs/' },
            { text: 'Scheduling', link: '/user-guide/jobs/scheduling' },
            { text: 'Retention Policies', link: '/user-guide/jobs/retention' }
          ]
        },
        {
          text: 'Security',
          collapsed: false,
          items: [
            { text: 'Encryption Vault', link: '/user-guide/security/encryption' },
            { text: 'Compression', link: '/user-guide/security/compression' },
            { text: 'Recovery Kit', link: '/user-guide/security/recovery-kit' }
          ]
        },
        {
          text: 'Features',
          collapsed: false,
          items: [
            { text: 'Storage Explorer', link: '/user-guide/features/storage-explorer' },
            { text: 'Restore', link: '/user-guide/features/restore' },
            { text: 'Notifications', link: '/user-guide/features/notifications' },
            { text: 'System Backup', link: '/user-guide/features/system-backup' },
            { text: 'Profile & Settings', link: '/user-guide/features/profile-settings' }
          ]
        },
        {
          text: 'Administration',
          collapsed: false,
          items: [
            { text: 'User Management', link: '/user-guide/admin/users' },
            { text: 'Groups & Permissions', link: '/user-guide/admin/permissions' },
            { text: 'SSO / OIDC', link: '/user-guide/admin/sso' }
          ]
        }
      ],
      '/developer-guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'Overview', link: '/developer-guide/' },
            { text: 'Architecture', link: '/developer-guide/architecture' },
            { text: 'Project Setup', link: '/developer-guide/setup' }
          ]
        },
        {
          text: 'Core Concepts',
          collapsed: false,
          items: [
            { text: 'Service Layer', link: '/developer-guide/core/services' },
            { text: 'Adapter System', link: '/developer-guide/core/adapters' },
            { text: 'Runner Pipeline', link: '/developer-guide/core/runner' },
            { text: 'Logging System', link: '/developer-guide/core/logging' },
            { text: 'Download Tokens', link: '/developer-guide/core/download-tokens' },
            { text: 'Update Service', link: '/developer-guide/core/updates' }
          ]
        },
        {
          text: 'Adapter Development',
          collapsed: false,
          items: [
            { text: 'Database Adapters', link: '/developer-guide/adapters/database' },
            { text: 'Storage Adapters', link: '/developer-guide/adapters/storage' },
            { text: 'Notification Adapters', link: '/developer-guide/adapters/notification' }
          ]
        },
        {
          text: 'Advanced Topics',
          collapsed: false,
          items: [
            { text: 'Authentication', link: '/developer-guide/advanced/auth' },
            { text: 'SSO / OIDC', link: '/developer-guide/advanced/sso' },
            { text: 'Permission System (RBAC)', link: '/developer-guide/advanced/permissions' },
            { text: 'Audit Logging', link: '/developer-guide/advanced/audit' },
            { text: 'Encryption Pipeline', link: '/developer-guide/advanced/encryption' },
            { text: 'Retention System', link: '/developer-guide/advanced/retention' },
            { text: 'Healthcheck System', link: '/developer-guide/advanced/healthcheck' },
            { text: 'Config Backup (Meta)', link: '/developer-guide/advanced/config-backup' }
          ]
        },
        {
          text: 'Reference',
          collapsed: true,
          items: [
            { text: 'Environment Variables', link: '/developer-guide/reference/environment' },
            { text: 'Database Schema', link: '/developer-guide/reference/schema' },
            { text: 'Supported Versions', link: '/developer-guide/reference/versions' },
            { text: 'Testing Guide', link: '/developer-guide/reference/testing' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Skyfay/dbackup' },
      { icon: 'gitlab', link: 'https://gitlab.com/Skyfay/dbackup' },
      { icon: 'discord', link: 'https://dc.skyfay.ch' }
    ],

    footer: {
      message: 'Released under the GNU General Public License. | <a href="https://skyfay.ch/privacy" target="_blank" rel="noopener noreferrer">Privacy</a> · <a href="https://skyfay.ch/legal" target="_blank" rel="noopener noreferrer">Legal Notice</a>',
      copyright: 'Copyright © 2026 DBackup'
    },

    search: {
      provider: 'local'
    },

    editLink: {
      pattern: 'https://gitlab.com/Skyfay/dbackup/-/edit/main/wiki/:path',
      text: 'Edit this page on GitLab'
    }
  }
})
