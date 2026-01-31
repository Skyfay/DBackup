import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "DBackup",
  description: "Self-hosted database backup automation with encryption, compression, and retention policies",
  lang: 'en-US',
  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }]
  ],
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    logo: '/logo.svg',

    nav: [
      { text: 'Home', link: '/' },
      { text: 'User Guide', link: '/user-guide/getting-started' },
      { text: 'Developer Guide', link: '/developer-guide/' },
      {
        text: 'Resources',
        items: [
          { text: 'GitHub', link: 'https://github.com/Skyfay/dbackup' },
          { text: 'GitLab', link: 'https://gitlab.com/Skyfay/dbackup' },
          { text: 'Changelog', link: '/changelog' },
          { text: 'Roadmap', link: '/roadmap' }
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
            { text: 'System Backup', link: '/user-guide/features/system-backup' }
          ]
        },
        {
          text: 'Administration',
          collapsed: true,
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
            { text: 'Runner Pipeline', link: '/developer-guide/core/runner' }
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
            { text: 'Retention System', link: '/developer-guide/advanced/retention' },
            { text: 'Encryption Pipeline', link: '/developer-guide/advanced/encryption' },
            { text: 'Permission System (RBAC)', link: '/developer-guide/advanced/permissions' }
          ]
        },
        {
          text: 'Reference',
          collapsed: true,
          items: [
            { text: 'Database Schema', link: '/developer-guide/reference/schema' },
            { text: 'Supported Versions', link: '/developer-guide/reference/versions' },
            { text: 'Testing Guide', link: '/developer-guide/reference/testing' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Skyfay/dbackup' },
      { icon: 'gitlab', link: 'https://gitlab.com/Skyfay/dbackup' }
    ],

    footer: {
      message: 'Released under the GNU General Public License.',
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
