# Changelog

All notable changes to DBackup are documented here.

## v0.9.9-beta - MSSQL SSH Testing & Quick Setup Improvements
*Release: In Progress*

This release adds SSH connection testing for MSSQL file transfer mode with backup path read/write verification, a pre-restore version compatibility matrix that warns about version mismatches before starting the restore, and fixes adapter selection issues in the Quick Setup wizard.

### ✨ New Features

#### � Backup Compatibility Matrix in Restore Dialog
- **Pre-Restore Version Check** — When selecting a target database source in the Restore dialog, the backup's engine version is now compared against the target server's version immediately — before clicking "Start Restore"
- **Version Mismatch Warning** — If the backup was created on a newer database version than the target server, an orange warning banner appears: "Backup was created on version X, but the target server runs Y"
- **MSSQL Edition Guard** — Incompatible MSSQL editions (Azure SQL Edge ↔ SQL Server) are detected and shown as a red error banner, blocking the restore button entirely
- **Compatibility Confirmation** — When versions are compatible, a green "Version compatible" indicator confirms the match (e.g., "Backup 8.0.32 → Target 8.0.35")
- **Engine Edition in File Details** — The backup file details badge now also displays the engine edition (e.g., "MSSQL 15.0.4405.4 (Azure SQL Edge)") when available
- **Non-Blocking for Warnings** — Version mismatch warnings do not block the restore — users can still proceed at their own risk. Only hard incompatibilities (edition mismatch) disable the button

#### �🔗 MSSQL SSH File Transfer Testing
- **Dedicated SSH Test Button** — New "Test SSH Connection" button in the File Transfer tab when SSH mode is selected
- **Connection Verification** — Tests SSH connectivity to the configured `sshHost` and `sshPort`
- **Backup Path Access Check** — Verifies the configured backup path is accessible and has read/write permissions
- **Write Capability Test** — Creates a temporary probe file, verifies it exists, then cleans it up — confirms the user has write access at the backup location
- **Detailed Error Messages** — Differentiates between connection failures, path not found, read-only, and successful conditions:
  - SSH connection failed → SSH authentication/network error
  - Backup path is not accessible → Directory doesn't exist or permission denied on read
  - Backup path is read-only → Can read but cannot write (insufficient permissions)
  - Backup path is readable and writable → All checks passed ✓
- **Non-Blocking** — Test button doesn't block the form; you can continue configuring even after a failed test

#### 📧 Notification Email Template Redesign (Shadcn/UI Style)
- **Modern Card Layout** — Email notifications now use a clean card-based design with subtle zinc borders and proper spacing, following Shadcn/UI design system
- **Color-Coded Status Badge** — Status indicator shown as a pill badge (✓ Success / ✕ Failed / ℹ Info) in the top-right corner instead of a colored header bar
- **Improved Typography** — Consistent font hierarchy with 18px title, 14px body text, and 12px footer using system font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI"`, etc.)
- **Enhanced Fields Table** — Individual database info rows with left-aligned category labels on subtle gray background and white value cells for better readability
- **Zinc Color Palette** — Uses Shadcn/UI's zinc neutral colors (#09090b foreground, #f4f4f5 subtle backgrounds, #e4e4e7 borders) with status-specific variations (green/red/blue/purple)
- **Clickable Footer Link** — "Sent by DBackup" now links to https://dbackup.app for better branding

#### 📊 Restore Notifications Enhanced with Rich Context
- **Database Type** — Shows the database adapter type (MYSQL, POSTGRES, MONGODB, MSSQL, SQLITE, REDIS)
- **Storage Name** — Displays the storage destination name for better tracking of where backups are stored
- **Backup File** — Shows the backup file name for reference
- **Complete Source Info** — Uses actual adapter names instead of internal IDs, making notifications much more readable
- **Duration Tracking** — Includes total restore duration (in seconds) for performance monitoring
- **Failure Details** — Enhanced error messages provide full error context for easier troubleshooting

#### ⚡ Selective TAR Extraction for Multi-Database Restores
- **Performance Optimization**: Implemented `extractSelectedDatabases()` function in `src/lib/adapters/database/common/tar-utils.ts` — only extracts database dump files matching selected databases instead of extracting all entries from the TAR archive
- **Manifest-First Approach**: Reads manifest first to build a lookup set of selected filenames, skips unselected entries via `stream.resume()` without I/O
- **Applies to All Adapters**: MySQL, PostgreSQL, MongoDB, and MSSQL restore operations now use selective extraction
- **MSSQL Filtering**: MSSQL's `extractTarArchive()` function enhanced to filter `.bak` files by database name (derived from filename)
- **Backward Compatible**: Empty selection list extracts all databases — maintains fallback behavior
- **Benefits**: Significantly reduces disk I/O and temporary storage requirements when restoring only 1 of many databases from a large multi-DB backup (e.g., 100 MB extracted instead of 50 GB)
- **New Unit Tests**: Four comprehensive tests in `tests/unit/adapters/database/common/tar-utils.test.ts` covering single/multiple selective extraction, full extraction fallback, and error handling

#### 🎨 Dedicated Restore Page & Enhanced UI
- **Full-Page Restore Experience** — Moved restore workflow from a modal dialog to a dedicated page at `/dashboard/storage/restore` with unlimited space and better visual hierarchy
- **2-Column Grid Layout** — Left column (2/3 width) shows file details, target database selection, and database mapping table; right column (1/3 width) displays existing databases on target, warnings, and action buttons
- **File Details Card** — Shows backup filename, size, creation date, database type, engine version, edition, compression method, and encryption status with icon-coded badges
- **Target Database Selection** — Dropdown to select which database source to restore to, with automatic version compatibility checking and conflict detection
- **Database Mapping Table** — For multi-database backups, shows a table with Source DB name, target name input, and status badges (Overwrite for existing DBs, New for new DBs) with checkboxes to select which databases to restore
- **Privileged Auth Support** — After failed restore due to insufficient permissions, shows inline form to enter elevated credentials (root/admin user) and retry with higher privileges
- **Existing Databases Sidebar** — Collapsible section on the right showing all databases currently on the target server with sizes and count badges. Databases marked in red if they will be overwritten by the restore
- **Compatibility Checks Live** — When target is selected, fetches server version and runs compatibility checks. Hard incompatibilities (MSSQL edition mismatch) disable the button immediately. Soft warnings (version mismatch) show as orange alert but still allow proceeding
- **URL Parameter State** — FileInfo and destination ID are passed via base64-encoded URL parameters (`?file=...&destinationId=...`) for easy bookmarking and returning to the same restore session
- **System Config Restore** — If restoring a system configuration backup, shows checkboxes for which components to restore (Settings, Adapters, Jobs, Users, SSO, Encryption Profiles)
- **Redis Fallback** — Redis restores (which use a specialized wizard) show a helpful message directing users to use the Storage Explorer button instead
- **Optimized Spacing** — Refined padding and margins throughout for better visual balance — warning alert centered between top and separator, reduced gaps between existing databases header and table

#### 📊 Storage Explorer Tabs & Dedicated History Page
- **Tab Navigation** — Storage Explorer now features three tabs (Explorer, History, Settings) that appear once a destination is selected — enabling quick switching between browsing backups, viewing analytics, and configuring alerts
- **Dedicated History Tab** — Full-page storage history with two side-by-side charts: an area chart for storage size over time and a bar chart for backup count over time — replacing the small modal dialog
- **Stats Overview Cards** — Three summary cards above the charts: Current Size (with delta vs. start of period), Backup Count (with change indicator), and Average Size (across all snapshots in the period)
- **Time Range Selector** — Choose from 7 days, 14 days, 30 days, 90 days, 180 days, or 1 year — same as the existing modal but now with more space for the charts
- **Shadcn/UI Charts** — Uses `ChartContainer`, `ChartTooltip`, `ChartTooltipContent` from `@/components/ui/chart` with `recharts` AreaChart and BarChart — proper CSS variable theming for dark/light mode
- **Trend Indicators** — Stats cards show colored up/down arrows (TrendingUp/TrendingDown) with size or count deltas compared to the oldest data point in the selected range
- **Settings Tab (Coming Soon)** — Placeholder tab with planned features: Usage Spike Alerts, Storage Limit Warnings, Missing Backup Alerts, and Anomaly Detection (sudden size increases/decreases) — all marked with "Coming Soon" badges
- **Context-Aware Controls** — "Show System Configs" toggle only visible when the Explorer tab is active — hides when viewing History or Settings
- **Restore Back Navigation** — Returning from the restore page now preserves the previously selected storage destination via `?destination=` URL parameter

#### 🔔 Storage Alert System (Notification Integration)
- **Per-Destination Alert Configuration** — Each storage destination now has its own alert settings in the Settings tab, with individual toggles and thresholds for three alert types
- **Usage Spike Alert** — Detects when total storage size increases or decreases by more than a configurable percentage (default: 50%) between refresh cycles. Compares the latest two storage snapshots
- **Storage Limit Warning** — Alerts when storage usage reaches 90% of a user-configured size limit (e.g., 10 GB). Configurable in MB, GB, or TB with a dropdown unit selector
- **Missing Backup Alert** — Triggers when no new backup files appear within a configurable time window (default: 48 hours, max: 8760h / 1 year). Tracks backup count changes across storage snapshots
- **System Notification Integration** — All three storage alert types are registered as system notification events under a new "Storage" category in Settings > Notifications. Events can be enabled/disabled per channel, and test notifications can be sent for each event type
- **Automatic Alert Checking** — Storage alerts are evaluated automatically during each storage stats refresh cycle (triggered by the "Refresh Storage Statistics" system task and after backups). No additional scheduler or cron job required
- **Notification Templates** — Rich notification payloads with storage name, size values, percentage changes, and timestamps. Compatible with all notification adapters (Email, Discord, Gotify, etc.)
- **Alert Config Persistence** — Per-destination settings stored in `SystemSetting` table with keys like `storage.alerts.<configId>`. Defaults provided for new destinations (all alerts disabled by default)
- **Info Card** — The Settings tab includes a "Notification Delivery" info card explaining that alerts are routed through the global notification channels configured in Settings > Notifications

#### ⏱️ Configurable Data Retention for Storage Snapshots
- **Extended Storage Management** — Storage snapshots are now automatically cleaned up based on a configurable retention policy, complementing the existing audit log retention
- **Granular Retention Options** — Choose from 7 days to 5 years (1825 days) per data type — separate configurable retention periods for Audit Logs and Storage Snapshots
- **Unified Data Retention UI** — New "Data Retention" card in Settings → General with a Popover containing two FormFields (one for Audit Logs, one for Storage Snapshots) with icons for visual clarity
- **Cleanup Automation** — Extended "Clean Old Data" system task runs daily at midnight, automatically removing both old audit logs and outdated storage snapshots based on their configured retention values
- **Human-Readable Display** — Retention values are shown in friendly format: 1–364 days as "Xd", while year-aligned values like 730 days display as "2y", 1095 as "3y", etc. (e.g., button shows "90d / 2y" for 90-day logs and 2-year snapshots)
- **Dynamic Configuration** — Retention periods are stored in the database as SystemSettings and can be updated anytime without restarting — cleanup logic reads current values on each execution
- **Non-Blocking Cleanup** — Each data type (audit logs, snapshots) is cleaned independently with separate error handling, so a failure in one cleanup type doesn't prevent the other from running

#### 📋 Notification Log History
- **Full Notification Audit Trail** — Every notification sent (per-job and system-wide) is now permanently logged in a dedicated `NotificationLog` table with event type, adapter, channel, status, and timestamp
- **History Page Tabs** — The History page now features two tabs: "Activity Logs" (existing execution history) and "Notification Logs" — enabling quick switching between backup activity and notification delivery records
- **Adapter-Specific Previews** — Each log entry can be previewed in a dialog that renders the notification as it would appear on the target platform:
  - **Discord** — Dark-themed embed card with color bar, title, fields grid, and timestamp
  - **Email** — Full HTML render in an isolated iframe using `srcDoc`
  - **Slack** — Block Kit styled preview with header, sections, fields, and context blocks
  - **Telegram** — Chat bubble style with parsed HTML formatting and bot identity
  - **Microsoft Teams** — Adaptive Card preview with FactSet fields, color header, and team styling
  - **Generic** — Plain text fallback for webhook, Gotify, ntfy, SMS adapters showing title, message, and fields
- **Preview Tabs** — Each notification preview dialog includes inner tabs: "Preview" (visual render), "Plain Text" (title + message + fields), and "Raw Payload" (full JSON payload as sent to the adapter)
- **Filterable & Searchable** — Notification log table supports filtering by adapter type, event type (backup success/failure, restore, system events), and status (success/error)
- **Data Retention Integration** — Notification logs are included in the Data Retention system with a configurable retention period (7 days to 5 years, default 90 days). A new "Notification Logs" field with Bell icon appears in the Data Retention popover alongside Audit Logs and Storage Snapshots
- **API Endpoints** — Two new API routes: `GET /api/notification-logs` (paginated list with filters) and `GET /api/notification-logs/[id]` (single entry with full payload)
- **Automatic Logging** — Logging happens transparently in both dispatch points (runner pipeline step 04-completion and system notification service) without requiring adapter changes

### 🐛 Bug Fixes
- **Quick Setup Adapter Selection** — Fixed "Please select an adapter type first" error when clicking "Test Connection" in Quick Setup wizard (Database Source, Storage Destination, Notification steps). The hook now correctly falls back to the `adapterId` prop when the form doesn't include that field
- **Test Connection in Setup** — Test Connection button now works properly in all Quick Setup adapter configuration steps, not just the regular adapter management dialogs

### 🔧 Technical Changes
- Updated `src/app/dashboard/storage/columns.tsx` — Added `engineEdition?: string` to `FileInfo` type for MSSQL edition display in restore dialog
- Updated `src/services/storage-service.ts` — Added `engineEdition` to `RichFileInfo` type and passes it through from `.meta.json` sidecar metadata
- Updated `src/app/api/adapters/database-stats/route.ts` — Extended response with `serverVersion` and `serverEdition` fields by calling `adapter.test()` alongside database stats retrieval
- Updated `src/components/dashboard/storage/restore-dialog.tsx` — Added `targetServerVersion`, `targetServerEdition`, and `compatibilityIssues` state; runs `compareVersions()` and edition checks after target source selection; renders green/orange/red compatibility banners; blocks restore button on hard incompatibilities (edition mismatch)
- New `src/app/api/adapters/test-ssh/route.ts` — SSH connection test endpoint with backup path verification
- New `MssqlSshTransfer.testBackupPath()` method in `src/lib/adapters/database/mssql/ssh-transfer.ts` — Tests directory access, read/write capabilities via SFTP
- Updated `src/components/adapter/use-adapter-connection.tsx` — Fixed `testConnection()` to use `adapterId` prop as fallback when form field is missing (for Quick Setup compatibility)
- Added `Loader2` icon import to `src/components/adapter/form-sections.tsx` — Loading state indicator for SSH test button
- Updated `src/components/adapter/form-sections.tsx` — New `SshConfigSection` component with integrated SSH test button; SSH fields moved from inline to dedicated component for better organization
- Updated `toast` import in `src/components/adapter/form-sections.tsx` — Added to enable SSH test notifications
- Redesigned `src/components/email/system-notification-template.tsx` — Complete visual overhaul using Shadcn/UI design tokens (zinc palette), table-based layout for HTML email compatibility, status badges, and responsive card styling
- Extended `RestoreResultData` interface in `src/lib/notifications/types.ts` — Added `databaseType`, `backupFile`, `storageName`, and `size` fields for richer restore notifications
- Updated restore success/failure templates in `src/lib/notifications/templates.ts` — Enhanced templates to include database type, storage name, backup filename, and file size in notification fields
- Updated `src/services/restore-service.ts` — Restore notification calls now pass resolved adapter names and additional metadata (database type, storage name, backup file, file size, duration) instead of just IDs
- Updated unit tests in `tests/unit/lib/notifications/email-template.test.tsx` — Fixed email template tests to account for new table-based layout structure
- Updated unit tests in `tests/unit/adapters/notification/email.test.ts` — Fixed email footer assertions to check for component parts instead of exact concatenation
- Updated `src/app/dashboard/storage/storage-client.tsx` — Added Shadcn `Tabs` (Explorer, History, Settings) with conditional rendering; "Show System Configs" toggle only visible in Explorer tab; added `useSearchParams` for `?destination=` pre-selection when returning from restore page
- Updated `src/app/dashboard/storage/page.tsx` — Wrapped `StorageClient` in `<Suspense>` boundary (required for `useSearchParams` in Next.js App Router)
- New `src/components/dashboard/storage/storage-history-tab.tsx` — Full-page storage history with stats cards (Current Size, Backup Count, Average Size), side-by-side AreaChart (storage size) and BarChart (backup count) using Shadcn/UI Chart components, time range selector (7d–1y), trend indicators
- New `src/components/dashboard/storage/storage-settings-tab.tsx` — Coming Soon placeholder with Storage Alerts (Usage Spike, Storage Limit, Missing Backup) and Anomaly Detection (Sudden Size Increase/Decrease) — all disabled with opacity overlay and "Coming Soon" badges
- New `src/app/dashboard/storage/restore/page.tsx` — Server component for the dedicated restore page, checks `PERMISSIONS.STORAGE.RESTORE` and redirects to `/dashboard/storage` if denied
- New `src/app/dashboard/storage/restore/restore-client.tsx` — Full-page client component (~850 lines) with 2-column grid layout: left column for file details/target selection/database mapping, right column for existing databases sidebar and action buttons. Handles FileInfo parsing from base64 URL params, version compatibility checks, multi-database mapping with selective extraction flags, privileged auth retry flow, system config restore options, and Redis fallback messaging
- Updated `src/app/dashboard/storage/storage-client.tsx` — Removed `RestoreDialog` import and usage; changed restore button to navigate via `router.push()` with base64-encoded FileInfo and destination ID in URL params instead of opening modal; removed database sources state and API fetch since restore page handles fetching

## v0.9.8-beta - Notification Adapters Expansion & Quick Setup Wizard
*Released: February 20, 2026*

This release adds seven new notification adapters: Slack, Microsoft Teams, Gotify, ntfy, Generic Webhook, Telegram, and SMS (Twilio). All nine channels (Discord, Slack, Teams, Telegram, Gotify, ntfy, SMS, Generic Webhook, Email) are now available for both per-job and system-wide notifications. The notification documentation has been restructured into dedicated per-channel pages with detailed setup guides.

### ✨ New Features

#### 🔔 Slack Notification Adapter
- **Incoming Webhooks** — Send notifications to Slack channels via [Incoming Webhooks](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/)
- **Block Kit Formatting** — Rich messages with Header, Section, Fields, and Context blocks
- **Color-Coded Attachments** — Status bar colors (green for success, red for failure)
- **Channel Override** — Optionally route messages to a different channel than the webhook default
- **Custom Bot Identity** — Configurable display name and icon emoji (e.g., `:shield:`)

#### 🔔 Microsoft Teams Notification Adapter
- **Power Automate Workflows** — Send notifications via [Teams Incoming Webhooks](https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook) (Adaptive Cards)
- **Adaptive Cards v1.4** — Structured content with title, message body, and FactSet key-value pairs
- **Color Mapping** — Hex colors mapped to Adaptive Card named colors (Good, Attention, Warning, Accent)
- **Enterprise Ready** — Native Microsoft 365 integration for corporate environments

#### 🔔 Generic Webhook Notification Adapter
- **Universal HTTP** — Send JSON payloads to any HTTP endpoint via POST, PUT, or PATCH
- **Custom Payload Templates** — Define your own JSON structure with `{{variable}}` placeholders (title, message, success, color, timestamp, eventType, fields)
- **Authentication** — Authorization header support for Bearer tokens, API keys, and Basic auth
- **Custom Headers** — Add arbitrary headers in `Key: Value` format (one per line)
- **Flexible Content-Type** — Configurable Content-Type header (default: `application/json`)
- **Compatible Services** — Works with PagerDuty, Uptime Kuma, and any custom HTTP receiver

#### 🔔 Gotify Notification Adapter
- **Self-Hosted Push** — Send notifications to your [Gotify](https://gotify.net/) server via REST API
- **Priority Levels** — Configurable default priority (0–10) with automatic escalation on failures
- **Markdown Formatting** — Rich message content with structured fields
- **App Token Auth** — Simple authentication via Gotify application tokens

#### 🔔 ntfy Notification Adapter
- **Topic-Based Delivery** — Send push notifications via [ntfy](https://ntfy.sh/) to any subscribed device
- **Public or Self-Hosted** — Works with the free `ntfy.sh` service or your own ntfy server
- **Priority & Tags** — Automatic priority escalation and emoji tags based on event type
- **Access Token Auth** — Optional Bearer token for protected topics
- **Multi-Platform** — Android, iOS, and web clients with real-time push

#### 🔔 Telegram Notification Adapter
- **Bot API Integration** — Send notifications via [Telegram Bot API](https://core.telegram.org/bots/api) to any chat, group, or channel
- **HTML Formatting** — Rich messages with bold text, structured fields, and status emoji (✅/❌)
- **Flexible Targets** — Private chats, groups, supergroups, and channels
- **Silent Mode** — Optional silent delivery with no notification sound
- **Configurable Parse Mode** — HTML (default), MarkdownV2, or classic Markdown

#### 🔔 SMS (Twilio) Notification Adapter
- **SMS Delivery** — Send text message alerts to any mobile phone worldwide via [Twilio](https://www.twilio.com/)
- **Concise Formatting** — Status emoji, title, and up to 4 key fields optimized for SMS length
- **E.164 Phone Numbers** — International phone number format support
- **Critical Alerts** — Perfect for high-priority failure notifications and on-call escalation

#### 🎨 Brand Icons for New Adapters
- **Slack** — Multi-colored SVG Logos icon (`logos/slack-icon`)
- **Microsoft Teams** — Multi-colored SVG Logos icon (`logos/microsoft-teams`)
- **Generic Webhook** — Material Design Icons webhook icon (`mdi/webhook`)
- **Gotify** — Material Design Icons bell icon (`mdi/bell-ring`)
- **ntfy** — Material Design Icons message icon (`mdi/message-text`)
- **Telegram** — Multi-colored SVG Logos icon (`logos/telegram`)
- **SMS (Twilio)** — Material Design Icons cellphone message icon (`mdi/cellphone-message`)

### 📚 Documentation

#### Notification Channel Pages
- **New Sidebar Section** — "Notification Channels" with dedicated Overview page and per-adapter pages
- **Discord** — Dedicated page with setup guide, message format, and troubleshooting
- **Slack** — Dedicated page with Slack App setup, Block Kit format, channel override, and emoji icons
- **Microsoft Teams** — Dedicated page with Power Automate Workflows setup, Adaptive Card format, and color mapping
- **Generic Webhook** — Dedicated page with payload format, template examples (PagerDuty), and authentication guide
- **Gotify** — Dedicated page with Gotify server setup, App Token creation, priority levels, and troubleshooting
- **ntfy** — Dedicated page with public/self-hosted guide, topic subscriptions, priority & tags, and authentication
- **Telegram** — Dedicated page with @BotFather setup, Chat ID retrieval, HTML formatting, and troubleshooting
- **SMS (Twilio)** — Dedicated page with account setup, phone number purchase, E.164 format, cost considerations, and troubleshooting
- **Email (SMTP)** — Dedicated page with SMTP configurations (Gmail, SendGrid, Mailgun, Amazon SES, Mailtrap), per-user notifications, and security settings
- **Notifications Feature Page** — Restructured to link to individual channel pages instead of inline setup guides

#### 🚀 Quick Setup Wizard
- **Guided First-Run Experience** — New step-by-step setup wizard at `/dashboard/setup` guiding new users through creating their first backup — from database source to running the first job
- **7 Steps** — Welcome → Database Source → Storage Destination → Vault Key (optional) → Notification (optional) → Backup Job → Complete
- **Inline Adapter Forms** — Each step embeds the full adapter picker and configuration form directly in the wizard — no dialogs, no page navigation
- **Connection Testing** — Database source and storage destination steps include "Test Connection" before saving to catch misconfigurations early
- **Vault Key Creation** — Optional step to create an encryption profile for encrypted backups — skippable if not needed or no permission
- **Notification Setup** — Optional step to configure a notification channel (Discord, Slack, Email, etc.) — skippable
- **Job Configuration** — Pre-fills the job form with the source, destination, vault, and notifications created in previous steps. Includes cron schedule presets (Daily, Weekly, Hourly, Every 6 Hours) and compression toggle
- **Run First Backup** — Complete step with a "Run First Backup Now" button that triggers the job immediately and redirects to the History page
- **Conditional Sidebar Visibility** — Quick Setup appears in the sidebar only when no database sources exist in the system, automatically hiding once the first source is created
- **Settings Override** — "Always Show Quick Setup" toggle in Settings → General to force-show the wizard in the sidebar even when sources already exist
- **Permission-Aware** — Requires Sources, Destinations, and Jobs write permissions. Vault and Notification steps are shown based on their respective write permissions
- **Back Navigation** — "← Change Type" button in adapter forms (wizard and standard dialogs) allows going back to the adapter picker without losing the dialog state

### 🎨 UI Improvements

#### 🗂️ Grouped Sidebar Navigation
- **Section Labels** — Sidebar navigation is now organized into four labeled sections for better discoverability: **General** (Overview, Quick Setup), **Backup** (Sources, Destinations, Jobs, Notifications), **Explorer** (Storage Explorer, Database Explorer, History), and **Administration** (Vault, Users & Groups, Settings)
- **Cleaner Layout** — Groups are visually separated with `space-y-6` spacing and subtle uppercase section headings
- **Automatic Group Hiding** — Groups with no visible items (due to missing permissions) are automatically hidden entirely

#### 📊 Dashboard Stats Labels Clarification
- **Backups Widget Subtitle** — Changed from "Total successful backups" to "Across all destinations" to clarify that the widget displays currently existing backup files on storage destinations, not cumulative successful execution records. This improves consistency with the "Total Storage" widget subtitle

### 🐛 Bug Fixes
- **Config Backup Scheduler Not Refreshing**: Enabling or disabling Automated Configuration Backup in Settings now takes effect immediately without requiring a server restart — `scheduler.refresh()` is called after saving the settings
- **Storage History Button Visible Without Permission**: The Storage History action button in the Destinations table was always shown for all users, even when they lacked `storage:read` permission — it now only renders if the user has `storage:read`
- **Health History Popover Visible Without Permission**: The health status badge in Sources/Destinations tables was always clickable and opened the health history popover, regardless of permissions — users without `sources:read` (Sources) or `destinations:read` (Destinations) now see a non-interactive status badge only
- **Health History API Rejected Destination Users**: `GET /api/adapters/[id]/health-history` only accepted `sources:read`, causing users with `destinations:read` (but not `sources:read`) to receive a 403 error when hovering over a destination status badge — the API now accepts either `sources:read` or `destinations:read`

### 🔧 Technical Changes
- Updated `src/app/actions/config-backup-settings.ts` — Added `scheduler.refresh()` call after saving config backup settings to immediately apply enabled/disabled state to the cron scheduler
- New `src/app/dashboard/setup/page.tsx` — Server Component entry point for the Quick Setup wizard with permission checks
- New `src/components/dashboard/setup/setup-wizard.tsx` — Main wizard container with step navigation, sidebar progress indicator, and `WizardData` context tracking created resource IDs
- New `src/components/dashboard/setup/steps/welcome-step.tsx` — Welcome overview with dynamic step list based on permissions
- New `src/components/dashboard/setup/steps/source-step.tsx` — Database source creation with adapter picker, form, and connection test
- New `src/components/dashboard/setup/steps/destination-step.tsx` — Storage destination creation with adapter picker, form, and connection test
- New `src/components/dashboard/setup/steps/vault-step.tsx` — Optional encryption profile creation step
- New `src/components/dashboard/setup/steps/notification-step.tsx` — Optional notification channel creation step
- New `src/components/dashboard/setup/steps/job-step.tsx` — Backup job creation with cron presets, auto-filled references to previously created resources
- New `src/components/dashboard/setup/steps/complete-step.tsx` — Summary and "Run First Backup Now" button
- Updated `src/components/layout/sidebar.tsx` — Refactored flat `sidebarItems` array into grouped `sidebarGroups: SidebarGroup[]` structure with four sections (General, Backup, Explorer, Administration). Each group renders its own section label; groups with no visible items are skipped entirely
- Updated `src/components/layout/sidebar.tsx` — Added Quick Setup entry with `Rocket` icon and `showQuickSetup` prop for conditional visibility
- Updated `src/app/dashboard/layout.tsx` — Queries source count and `general.showQuickSetup` SystemSetting to determine sidebar visibility
- Updated `src/components/adapter/adapter-form.tsx` — Added `onBack` prop and "← Change Type" button in footer for returning to the adapter picker
- Updated `src/components/adapter/adapter-manager.tsx` — Wired `onBack` callback to navigate from form back to picker dialog
- Updated `src/app/actions/settings.ts` — Added `showQuickSetup` field to the settings schema and upsert logic (`general.showQuickSetup` SystemSetting key)
- Updated `src/app/dashboard/settings/page.tsx` — Loads `general.showQuickSetup` setting and passes to `SystemSettingsForm`
- Updated `src/components/settings/system-settings-form.tsx` — New "Quick Setup Wizard" card with "Always Show Quick Setup" switch in the General tab
- Updated `src/components/adapter/types.ts` — Added `permissions?: string[]` prop to `AdapterManagerProps`
- Updated `src/components/adapter/adapter-manager.tsx` — Accepts `permissions` prop; Storage History button is now gated behind `PERMISSIONS.STORAGE.READ`; `HealthStatusBadge` receives `interactive={false}` when user lacks the required permission (`sources:read` for database adapters, `destinations:read` for storage adapters)
- Updated `src/components/ui/health-status-badge.tsx` — Added `interactive?: boolean` prop (default `true`); when `false`, renders a plain non-clickable badge without the popover
- Updated `src/app/dashboard/destinations/page.tsx`, `src/app/dashboard/sources/page.tsx`, `src/app/dashboard/notifications/page.tsx` — Pass `permissions` array to `AdapterManager`
- Updated `src/app/api/adapters/[id]/health-history/route.ts` — Replaced single `checkPermissionWithContext(ctx, PERMISSIONS.SOURCES.READ)` with an explicit check accepting either `sources:read` or `destinations:read`

### 🔄 Changes
- Updated README and documentation to list all 7 notification channels as supported
- Notification adapter picker now shows Slack, Microsoft Teams, and Generic Webhook alongside Discord and Email

## v0.9.7-beta - API Keys, Webhook Triggers, Adapter Picker & Brand Icons
*Released: February 20, 2026*

This release introduces API key authentication for programmatic access, webhook triggers for starting backup jobs via REST API, and a visual adapter picker for creating new sources, destinations, and notifications. The picker displays all available adapters as cards with brand icons, grouped by category with tabs for quick navigation. A comprehensive API reference documentation covers all 43 endpoints.

### ✨ New Features

#### 🎯 Visual Adapter Picker
- **Two-Step Create Flow**: Clicking "Add New" now opens a visual picker dialog first, then transitions to the configuration form with the selected type pre-filled
- **Card Grid Layout**: All available adapters are displayed as clickable cards with icons in a responsive 3–4 column grid
- **Search Bar**: Type to filter adapters by name — shown automatically when more than 6 adapters are available. When searching with tabs active, results collapse into a flat filtered grid
- **Category Tabs**: Storage destinations are organized into tabs (All, Local, Cloud Storage (S3), Cloud Drives, Network) for quick filtering
- **Flat Grid Fallback**: Database sources and notification channels (which have no groups) display as a simple flat grid without tabs
- **Read-Only Type Badge**: After selecting an adapter in the picker, the form shows the type as a non-editable badge instead of a dropdown
- **Edit Flow Unchanged**: Editing existing configurations still opens the form directly with the full type dropdown

#### 🎨 Brand Icons for Adapters
- **Iconify Integration**: Replaced `@icons-pack/react-simple-icons` with [Iconify](https://iconify.design/) for richer, multi-colored brand icons — bundled offline (no API calls) for self-hosted deployments
- **SVG Logos (Primary)**: MySQL, MariaDB, PostgreSQL, MongoDB, SQLite, Redis, AWS S3, Cloudflare R2, Google Drive, Dropbox, OneDrive, Discord — all with original multi-colored brand artwork
- **Simple Icons (Fallback)**: MSSQL, Hetzner, MinIO — monochrome icons with brand colors for brands not available in SVG Logos
- **Material Design Icons (Protocols)**: SSH (SFTP), swap-vertical (FTP), cloud-upload (WebDAV), folder-network (SMB), folder-sync (Rsync), harddisk (Local) — descriptive protocol-specific icons instead of generic shapes
- **Lucide (Fallback)**: Mail (Email), Disc (unknown adapters) — for remaining generic icons
- **Proper Brand Icons**: OneDrive and Amazon S3 now display their actual brand logos instead of generic Cloud icons
- **AdapterIcon Component**: New `<AdapterIcon>` component handles icon rendering, color mapping, and pack selection automatically
- **Icon System Docs**: New [Icon System](/developer-guide/core/icons) developer guide documenting architecture, icon packs, and how to add icons for new adapters

#### 🗂️ Grouped Destination Type Selector
- **Categorized Adapter List**: The destination type dropdown now groups storage adapters into logical categories for better discoverability
- **Four Groups**: Local, Cloud Storage (S3), Cloud Drives, and Network — each displayed as a labeled section with a heading
- **Wider Popover**: The dropdown is now wider when groups are present to accommodate category headings
- **Adapter Reordering**: Storage adapters are reordered to match their category grouping (e.g., all S3 variants together, all network protocols together)
- **Backward Compatible**: Database and notification adapters without groups continue to display as a flat list

#### 📡 MSSQL SSH File Transfer
- **Remote Server Support**: MSSQL backups now support SSH/SFTP file transfer for accessing `.bak` files on remote SQL Server hosts — no shared filesystem (Docker volume) required
- **Two Transfer Modes**: Choose between **Local** (shared volume / Docker mount) and **SSH** (SFTP download/upload) in the new **File Transfer** tab
- **Backup Flow**: SQL Server writes `.bak` to `backupPath` on the server → DBackup downloads via SFTP → processes (compress/encrypt) → uploads to storage destination
- **Restore Flow**: DBackup downloads backup from storage → uploads `.bak` to server via SFTP → SQL Server restores from `backupPath` → cleanup
- **Three Auth Methods**: Password, SSH Private Key (PEM), and SSH Agent authentication
- **Automatic Cleanup**: Remote `.bak` files are deleted after successful transfer in both backup and restore operations
- **Multi-Database Support**: Works with TAR-archived multi-database backups — individual `.bak` files are transferred per database

#### 🔒 MSSQL Connection Security
- **Encrypt Toggle**: Encryption setting (`encrypt`) now exposed in the UI Configuration tab — enable for Azure SQL or production environments
- **Trust Server Certificate**: Self-signed certificate toggle (`trustServerCertificate`) now accessible in the UI — resolves "Certificate error" when connecting to development/internal SQL Servers

#### � Database Stats in Restore Dialog
- **Existing Databases Overview**: After selecting a target source in the Restore dialog, a collapsible section "Existing Databases on Target" appears showing all user databases on that server
- **Size & Table Count**: Each database displays its total size (data + index) and number of tables/collections
- **Conflict Detection**: Databases that would be overwritten by the restore are highlighted in red with a ⚠️ warning tooltip
- **Total Summary**: Footer row shows total database count and combined size across all databases
- **Async Loading**: Stats are fetched in the background with skeleton loading states — non-blocking for the restore workflow

#### 🔌 New `getDatabasesWithStats()` Adapter Method
- **New Interface**: `DatabaseInfo` type with `name`, `sizeInBytes?`, and `tableCount?` fields added to `BaseAdapter`
- **MySQL/MariaDB**: Queries `information_schema.schemata` + `information_schema.tables` for size (data_length + index_length) and table count
- **PostgreSQL**: Uses `pg_database_size()` function + `information_schema.tables` count
- **MongoDB**: Now leverages the native `sizeOnDisk` from `listDatabases` command (previously discarded) + `listCollections()` for collection count
- **MSSQL**: Queries `sys.master_files` for file sizes + `INFORMATION_SCHEMA.TABLES` for table count
- **Graceful Fallback**: If `getDatabasesWithStats()` is not implemented, falls back to `getDatabases()` (names only)

#### 🔍 Database Explorer Page
- **Standalone Page**: New dedicated page at `/dashboard/explorer` for browsing databases on any configured source — accessible from the sidebar
- **Searchable Source Selector**: Combobox with type-ahead filtering to quickly find sources by name or adapter type
- **Server Overview Cards**: Three summary widgets showing server type + version, database count, and total storage size
- **Database Table**: Sortable table with database name, size, table/collection count, and a visual size distribution bar
- **Deep Link from Sources**: New inspect button (🔍) on each database source in the Sources table — navigates directly to the Database Explorer with the source pre-selected
- **URL Parameter Support**: Accepts `?sourceId=...` query parameter for direct linking — auto-selects and loads the specified source on page load

#### 🔢 Port Placeholders
- **MSSQL**: Default port `1433` shown as placeholder
- **Redis**: Default port `6379` shown as placeholder
- **MariaDB**: Default port `3306` shown as placeholder

#### ✅ Environment Variable Validation
- **Startup Check**: All required and optional environment variables are validated at application startup using Zod schemas
- **Clear Error Messages**: Missing `ENCRYPTION_KEY` or `BETTER_AUTH_SECRET` produces a formatted error box with generation instructions and a link to the installation docs
- **Graceful Warnings**: Invalid optional variables (e.g., malformed `BETTER_AUTH_URL`) are logged as warnings without blocking startup
- **Default Values**: Optional variables like `LOG_LEVEL`, `TZ`, `PORT`, and `DATABASE_URL` have documented defaults applied automatically

#### 🔑 API Key Management
- **Programmatic Access**: Create API keys with fine-grained permissions to authenticate against the REST API using `Authorization: Bearer dbackup_xxx` headers
- **Scoped Permissions**: Each API key has individually assigned permissions — SuperAdmin privileges are never inherited, only explicitly granted permissions apply
- **Key Lifecycle**: Full CRUD management — create, view, toggle (enable/disable), rotate (regenerate), and delete API keys
- **Secure Storage**: Only the first 16 characters (`dbackup_` prefix) are stored in the database. The full key is shown exactly once upon creation and cannot be retrieved afterward
- **Expiration Dates**: Optional expiry date with Shadcn Calendar date picker — expired keys are automatically rejected during authentication
- **Audit Trail**: API key creation, rotation, toggle, and deletion are logged in the audit trail with the key name and prefix
- **One-Time Reveal Dialog**: After creation, a dedicated dialog displays the full API key with a copy button and a warning that it won't be shown again
- **Users Page Integration**: New "API Keys" tab on the Access Management page (requires `api-keys:read` or `api-keys:write` permission)

#### 🔗 Webhook Triggers (API-Based Job Execution)
- **Trigger Backups via API**: Start any backup job remotely by sending a `POST /api/jobs/:id/run` request with a valid API key
- **Execution Polling**: Poll job progress via `GET /api/executions/:id` with optional `?includeLogs=true` for real-time status updates
- **API Trigger Dialog**: New "API Trigger" button (🔗) on each backup job showing ready-to-use code examples in three tabs:
  - **cURL**: Simple one-liner for quick terminal usage
  - **Bash**: Full script with polling loop, status checks, and exit codes
  - **Ansible**: Complete playbook with `uri` module and async polling via `until` loop
- **Clipboard Copy**: Each code example has a one-click copy button
- **Queue Integration**: API-triggered jobs go through the same FIFO queue as scheduled/manual jobs — respects `maxConcurrentJobs` concurrency limit
- **Audit Logging**: API-triggered executions record `trigger: "api"` and the API key ID in the audit log

#### 🔐 Unified Authentication System
- **Dual Auth Support**: All API routes now support both session-based (browser cookie) and API key (Bearer token) authentication via a unified `getAuthContext()` function
- **Auth Context**: New `AuthContext` type carries `userId`, `permissions[]`, and `authMethod` ("session" or "apikey") — used consistently across all route handlers
- **Middleware Rate Limiting**: API key requests are subject to the existing rate limiter (100 GET/min, 20 POST/min per IP)
- **Route Migration**: All 17+ API route handlers migrated from `auth.api.getSession()` to `getAuthContext()` for consistent auth handling

#### 📋 Execution Polling Endpoint
- **New Endpoint**: `GET /api/executions/:id` returns execution status, progress percentage, current stage, timing, file size, and error details
- **Optional Logs**: Pass `?includeLogs=true` to include full execution log entries
- **Permission Check**: Requires `history:read` permission

#### 🧩 Reusable Permission Picker
- **Extracted Component**: Permission selection UI extracted from the Groups form into a standalone `<PermissionPicker>` component
- **Dual Usage**: Used in both the Group edit form (`onPermissionChange` mode) and the API Key create dialog (`react-hook-form` mode)
- **Grouped Layout**: Permissions are displayed in categorized groups (Jobs, Storage, Sources, etc.) with "Select All" / "Deselect All" per group

#### 🐳 Docker Health Check
- **Built-in HEALTHCHECK**: Dockerfile now includes a `HEALTHCHECK` directive that polls `/api/health` every 30 seconds
- **Health Endpoint**: New `GET /api/health` API route (unauthenticated) returning app status, database connectivity, uptime, memory usage, and response time
- **Docker Status Integration**: `docker ps` now shows `healthy` / `unhealthy` status, and orchestrators (Docker Compose, Kubernetes) can use it for automated restarts
- **503 on Failure**: Returns HTTP 503 with `"status": "unhealthy"` when the database is unreachable

#### ⚡ Configurable Rate Limits
- **Per-Category Limits**: Configure separate rate limits for Authentication (login attempts), API Read (GET requests), and API Write (POST/PUT/DELETE mutations) — all adjustable from the Settings page
- **Auto-Save UI**: New "Rate Limits" tab in Settings with three cards showing Max Requests and Time Window inputs per category — changes auto-save with 800ms debounce, matching the existing settings UX
- **Reset to Defaults**: One-click reset button restores all rate limits to their default values (Auth: 5/60s, API: 100/60s, Mutation: 20/60s)
- **Persistent Configuration**: Rate limit values are stored in the `SystemSetting` database table and survive server restarts
- **Edge Runtime Architecture**: Middleware fetches rate limit config from an internal API endpoint (`/api/internal/rate-limit-config`) with a 30-second TTL cache — avoids the Edge Runtime limitation where Prisma cannot be used directly
- **Immediate Enforcement**: After saving new rate limits, the middleware picks up the updated config within 30 seconds (or immediately on next cache expiry)

#### 🛑 Graceful Shutdown
- **SIGTERM/SIGINT Handling**: The application now catches shutdown signals and performs a clean shutdown sequence instead of hard-killing running processes
- **Wait for Running Backups**: On shutdown, the app waits **indefinitely** for all running backup/restore executions to complete — no arbitrary timeout that could kill a long-running backup
- **Queue Freeze**: The queue manager immediately stops picking up new jobs when a shutdown signal is received
- **Scheduler Stop**: All cron-scheduled jobs are stopped immediately to prevent new triggers during shutdown
- **Pending Job Cleanup**: Any pending (not yet started) jobs in the queue are marked as `Failed` since they won't be picked up after shutdown
- **Database Cleanup**: Prisma client is gracefully disconnected before process exit
- **Force Exit**: Sending a second signal (e.g., Ctrl+C twice) forces immediate exit for emergency situations

#### ⚙️ Configurable Rate Limits (Technical)
- **Internal API Endpoint**: New `GET /api/internal/rate-limit-config` endpoint serving current rate limit config from DB — consumed by Edge Runtime middleware via `fetch()` with 30s TTL cache
- **Edge-Safe Architecture**: Middleware never imports Prisma — fetches config via HTTP from the Node.js runtime, avoiding the `PrismaClient is not configured to run in Edge Runtime` error
- **Three Rate Limit Categories**: Authentication (login), API Read (GET/HEAD), API Write (POST/PUT/DELETE) — each with configurable `points` (max requests) and `duration` (window in seconds)

### 🐛 Bug Fixes
- **Mouse Wheel Scrolling**: Fixed mouse wheel scrolling not working in command list dropdowns (type selector, comboboxes). The `cmdk` library was intercepting scroll events — added a manual `onWheel` handler to `CommandList` to ensure native scroll behavior
- **Conditional Form Fields**: Fixed fields appearing before their controlling dropdown is selected (e.g., SSH password shown before auth method is chosen, local backup path shown before transfer mode is selected). Applied to both MSSQL File Transfer and SQLite SSH Connection forms

### 📚 Documentation
- **API Reference**: New comprehensive [API Reference](/user-guide/features/api-reference) documentation covering all 43 REST API endpoints — organized by resource group with authentication, permissions, request/response schemas, and usage examples
- **API Key User Guide**: New [API Keys](/user-guide/features/api-keys) guide covering key creation, permission assignment, rotation, and security best practices
- **Webhook Triggers Guide**: New [Webhook Triggers](/user-guide/features/webhook-triggers) guide with step-by-step instructions, cURL/Bash/Ansible examples, and a polling flow diagram
- **Rate Limits User Guide**: New [Rate Limits](/user-guide/features/rate-limits) guide covering rate limit categories, configuration, and enforcement behavior
- **Rate Limiting Developer Guide**: New [Rate Limiting](/developer-guide/core/rate-limiting) developer documentation covering the Edge/Node architecture, config flow, database storage, and how to add new categories
- **Supported Destinations Table**: Added a comprehensive table listing all 13 supported storage destinations with details to both the wiki landing page and README
- **Supported Notifications Table**: Added a table listing all supported notification channels (Discord, Email) to both the wiki landing page and README
- **Reduced Duplication**: Shortened feature descriptions in the hero section and README features list to avoid repeating information already shown in the new tables
- **MSSQL User Guide**: Rewritten to cover both Local (shared volume) and SSH file transfer modes with separate setup instructions
- **MSSQL Developer Guide**: Updated schema documentation and added SSH transfer architecture section

### 🔧 Technical Changes
- New `ApiKey` model in `prisma/schema.prisma` — Stores API key prefix (first 16 chars of `dbackup_xxx`), SHA-256 hashed key, name, permissions JSON array, optional expiration date, enabled flag, usage counter, and last-used timestamp
- New `src/services/api-key-service.ts` — Full API key service with `create()`, `validate()`, `list()`, `toggle()`, `rotate()`, `delete()`, and `updateUsage()`. Key generation: `dbackup_` prefix + 30 random bytes (40 hex chars). Only hashed keys stored in DB
- New `src/lib/access-control.ts` — Unified `getAuthContext(headers)` function: tries session cookie first, falls back to Bearer token API key validation. Returns `AuthContext` with `userId`, `permissions`, `authMethod`
- New `src/app/api/executions/[id]/route.ts` — Execution polling endpoint with optional log inclusion
- New `src/app/actions/api-key.ts` — Server actions for API key CRUD (create, list, toggle, rotate, delete) with permission checks and audit logging
- New `src/components/api-keys/create-api-key-dialog.tsx` — Create dialog with name, expiration (Shadcn Calendar + DateDisplay), and permission picker
- New `src/components/api-keys/api-key-table.tsx` — DataTable with columns for name, prefix, permissions badge count, status toggle, last used, expiry, and actions (rotate/delete)
- New `src/components/api-keys/api-key-reveal-dialog.tsx` — One-time key reveal dialog with full key display and copy button
- New `src/components/dashboard/jobs/api-trigger-dialog.tsx` — Webhook trigger dialog with cURL, Bash, and Ansible code tabs, copy buttons, and permission requirements
- New `src/components/permission-picker.tsx` — Extracted reusable permission picker with grouped layout, select-all/deselect-all per group, and both callback and react-hook-form modes
- Updated `src/lib/permissions.ts` — Added `API_KEYS.READ` and `API_KEYS.WRITE` permissions
- Updated `src/lib/errors.ts` — Added `ApiKeyError` class for API key-specific errors
- Updated `src/types.ts` — Added `api-key.create`, `api-key.rotate`, `api-key.toggle`, `api-key.delete` audit event types
- Updated `src/middleware.ts` — API key Bearer tokens pass through rate limiter and are forwarded to route handlers
- Updated `src/components/layout/sidebar.tsx` — Access Management menu item permission check supports array (any-of logic) for `users:read`, `groups:read`, `api-keys:read`
- Updated `src/app/dashboard/users/page.tsx` — Added "API Keys" tab with conditional rendering based on `api-keys:read`/`api-keys:write` permissions
- Updated 17+ API route files — Migrated from `auth.api.getSession()` to `getAuthContext()` for unified session + API key authentication
- New `wiki/user-guide/features/api-keys.md` — User guide for API key management
- New `wiki/user-guide/features/webhook-triggers.md` — User guide for webhook triggers with cURL/Bash/Ansible examples
- New `wiki/user-guide/features/api-reference.md` — Comprehensive API reference covering all 43 endpoints with auth, permissions, request/response schemas, and examples
- Updated `wiki/.vitepress/config.mts` — Added API Keys, Webhook Triggers, and API Reference to sidebar navigation
- New `src/components/adapter/adapter-picker.tsx` — Visual adapter picker component with card grid, search bar, category tabs, brand icons, and icon color support
- Updated `src/components/adapter/utils.ts` — Replaced generic Lucide-only icon resolution with bundled Iconify icon data. `ADAPTER_ICON_MAP` maps adapter IDs to `IconifyIcon` objects from `@iconify-icons/logos` (SVG Logos), `@iconify-icons/simple-icons`, and `@iconify-icons/mdi` (Material Design Icons). Added `getAdapterColor()` for monochrome Simple Icons brand colors
- New `src/components/adapter/adapter-icon.tsx` — `<AdapterIcon>` component rendering Iconify `<Icon>` with automatic color handling based on icon pack
- Updated `src/components/adapter/adapter-manager.tsx` — Two-step create flow: picker dialog → form dialog. Picker opens on "Add New", passes selected adapter to form
- Updated `src/components/adapter/adapter-form.tsx` — Shows read-only type badge when single adapter is pre-selected, retains combobox for edit/multi-adapter scenarios
- Updated `src/lib/adapters/definitions.ts` — Added optional `group` field to `AdapterDefinition` type, assigned groups to all 13 storage adapters. Extended `MSSQLSchema` with `fileTransferMode`, `sshHost`, `sshPort`, `sshUsername`, `sshAuthType`, `sshPassword`, `sshPrivateKey`, `sshPassphrase` fields
- Updated `src/components/ui/command.tsx` — Added `onWheel` handler to `CommandList` for manual scroll support, bypassing `cmdk`'s event interception
- Updated `wiki/index.md` — Added "Supported Destinations" and "Supported Notifications" sections, shortened hero feature texts
- Updated `README.md` — Added "Supported Destinations" and "Supported Notifications" sections, shortened feature bullet points
- Replaced `@icons-pack/react-simple-icons` with `@iconify/react`, `@iconify-icons/logos`, `@iconify-icons/simple-icons`, and `@iconify-icons/mdi` for bundled offline brand and protocol icons
- New `wiki/developer-guide/core/icons.md` — Icon System documentation covering architecture, icon packs, adding new icons, and current mapping table
- New `src/lib/adapters/database/mssql/ssh-transfer.ts` — `MssqlSshTransfer` class for SSH/SFTP file transfer with `connect()`, `download()`, `upload()`, `deleteRemote()`, `exists()`, `end()` methods. Includes `isSSHTransferEnabled()` helper
- Updated `src/lib/adapters/database/mssql/dump.ts` — Refactored to support both local and SSH transfer modes for downloading `.bak` files from remote servers
- Updated `src/lib/adapters/database/mssql/restore.ts` — Refactored to support both local and SSH transfer modes for uploading `.bak` files to remote servers
- Updated `src/components/adapter/form-sections.tsx` — Added third "File Transfer" tab for MSSQL with conditional SSH/local field rendering. Fixed conditional visibility for SQLite SSH fields
- Updated `src/components/adapter/schema-field.tsx` — Added readable labels for all new MSSQL/SSH fields (`trustServerCertificate`, `fileTransferMode`, `sshHost`, etc.)
- Updated `src/components/adapter/form-constants.ts` — Added port placeholders (MSSQL 1433, Redis 6379, MariaDB 3306), backup path defaults, and SSH field placeholders
- New `DatabaseInfo` interface in `src/lib/core/interfaces.ts` — `{ name: string; sizeInBytes?: number; tableCount?: number }`
- New optional `getDatabasesWithStats()` method on `BaseAdapter` interface in `src/lib/core/interfaces.ts`
- Updated `src/lib/adapters/database/mysql/connection.ts` — Added `getDatabasesWithStats()` using `information_schema` queries
- Updated `src/lib/adapters/database/postgres/connection.ts` — Added `getDatabasesWithStats()` using `pg_database_size()`
- Updated `src/lib/adapters/database/mongodb/connection.ts` — Added `getDatabasesWithStats()` leveraging native `sizeOnDisk` + `listCollections()`
- Updated `src/lib/adapters/database/mssql/connection.ts` — Added `getDatabasesWithStats()` using `sys.master_files` + `INFORMATION_SCHEMA.TABLES`
- Updated all database adapter index files (`mysql`, `postgres`, `mongodb`, `mssql`, `mariadb`) to register `getDatabasesWithStats`
- New `src/app/api/adapters/database-stats/route.ts` — API endpoint accepting `sourceId` or `adapterId` + `config`, with RBAC check (`SOURCES.READ`)
- Updated `src/components/dashboard/storage/restore-dialog.tsx` — Added collapsible target database overview with conflict detection, skeleton loading, and size summary
- New `src/app/dashboard/explorer/page.tsx` — Server page for Database Explorer, fetches database-type AdapterConfigs from Prisma
- New `src/components/dashboard/explorer/database-explorer.tsx` — Client component with searchable source combobox (Popover + Command), server info cards, database stats table with size distribution progress bars, URL search param support for deep linking
- Updated `src/components/adapter/adapter-manager.tsx` — Added inspect button (`SearchCode` icon) for database-type adapters linking to `/dashboard/explorer?sourceId=...`
- Updated `src/components/layout/sidebar.tsx` — Added "Database Explorer" entry with `SearchCode` icon and `PERMISSIONS.SOURCES.READ` permission
- New `src/lib/env-validation.ts` — Zod-based environment variable validation with required/optional schema, formatted error output, and default values
- New `src/app/api/health/route.ts` — Unauthenticated health check endpoint returning app status, DB connectivity, uptime, memory usage, and response time
- New `src/lib/shutdown.ts` — Graceful shutdown handler with SIGTERM/SIGINT listeners, indefinite wait for running executions, pending job cleanup, scheduler stop, and Prisma disconnect
- Updated `src/instrumentation.ts` — Added `validateEnvironment()` call before scheduler init, and `registerShutdownHandlers()` after
- Updated `src/lib/queue-manager.ts` — Added `isShutdownRequested()` check to skip queue processing during shutdown
- Updated `Dockerfile` — Added `curl` package and `HEALTHCHECK` directive (`/api/health`, 30s interval, 10s timeout, 30s start period)
- New `src/lib/rate-limit.ts` — Configurable rate limiting module with `RateLimiterMemory` instances per category, `applyExternalConfig()` for Edge Runtime, `reloadRateLimits()` for server-side DB reads, and `getRateLimitConfig()` for UI display
- New `src/app/api/internal/rate-limit-config/route.ts` — Internal unauthenticated endpoint serving current rate limit config as JSON (consumed by middleware)
- New `src/app/actions/rate-limit-settings.ts` — Server actions for saving (`updateRateLimitSettings`) and resetting (`resetRateLimitSettings`) rate limit config with RBAC and Zod validation
- New `src/components/settings/rate-limit-settings.tsx` — Auto-save settings form with three cards (Auth, API Read, API Write), 800ms debounce, and reset-to-defaults button
- Updated `src/middleware.ts` — Rate limit config fetched via `fetch()` from internal API with 30s TTL cache instead of direct Prisma access. Added `api/internal` to matcher exclusion
- Updated `src/app/dashboard/settings/page.tsx` — Added "Rate Limits" tab loading config via `getRateLimitConfig()`
- Updated `src/instrumentation.ts` — Calls `reloadRateLimits()` on app startup to populate server-side rate limiters from DB
- New `wiki/user-guide/features/rate-limits.md` — User guide for configuring rate limits
- New `wiki/developer-guide/core/rate-limiting.md` — Developer guide covering Edge/Node architecture, config flow, and extension guide
- Updated `wiki/.vitepress/config.mts` — Added Rate Limits and Rate Limiting to sidebar navigation

## v0.9.6-beta - Rsync, Google Drive, Dropbox & OneDrive Storage Destinations & New Notification System
*Released: February 15, 2026*

This release adds Rsync as a new storage destination for efficient incremental file transfers over SSH, and Google Drive, Dropbox, and Microsoft OneDrive as cloud providers with full OAuth 2.0 authorization flow.

### ✨ New Features

#### 🔔 System Notifications
- **System-Wide Event Alerts**: New notification framework for events beyond individual backup jobs — user logins, account creation, restore results, configuration backups, and system errors
- **Settings UI**: New **Notifications** tab in Settings with global channel selection, per-event toggles, channel overrides, and test buttons
- **Event Categories**: Six configurable system events across four categories (Authentication, Restore, System) — each with independent enable/disable and channel assignment
- **Global & Per-Event Channels**: Set default notification channels globally, then optionally override channels for specific events (e.g., Discord for logins, Email for errors)
- **Notify User Directly**: For login and account creation events, optionally send a direct email to the affected user — three modes: Disabled (admin only), Admin & User, or User only
- **Unified Template System**: All notifications (per-job and system) now use the same `renderTemplate()` pipeline with adapter-agnostic payloads, ensuring consistent formatting across Discord embeds and HTML emails
- **Single Email Template**: Replaced the legacy backup-only email template with a unified `SystemNotificationEmail` React component used for all notification types
- **No Duplicate Notifications**: Backup success/failure events are intentionally excluded from system notifications (configured per-job only) to prevent double alerts
- **Fire-and-Forget**: System notifications never block the calling operation — all errors are logged but never thrown

#### 📧 Multi-Recipient Email Notifications
- **Multiple Recipients**: Email notification channels now support multiple recipients — add as many email addresses as needed per channel
- **Tag Input UI**: New chip/tag-style input field for the "To" field — type an email address and press Enter, Tab, comma, or Space to add it as a tag
- **Remove Recipients**: Click the X button on any tag to remove a recipient
- **Paste Support**: Paste comma- or semicolon-separated email lists and they are automatically split into individual tags
- **Backward Compatible**: Existing single-email configurations continue to work without changes

#### 🧹 Notification Table Cleanup
- **Removed Status Column**: The health check status column ("Pending") is no longer shown for notification adapters, as connection health monitoring is not applicable to notification channels (Discord webhooks, SMTP)

#### ☁️ Google Drive Storage Destination
- **New Cloud Adapter**: Store backups directly in Google Drive — the first cloud provider in DBackup with native OAuth 2.0 authentication
- **OAuth 2.0 Flow**: One-click authorization in the UI — redirects to Google's consent screen, automatically stores refresh token (encrypted at rest)
- **Automatic Token Refresh**: Uses refresh tokens with auto-renewal — no manual re-authorization required
- **Folder Management**: Optional target folder ID or automatic root-level storage — creates subfolder hierarchies as needed
- **Visual Folder Browser**: Browse and select target folders directly from Google Drive — navigable dialog with breadcrumbs, single-click select, double-click navigate
- **Full Lifecycle**: Upload, download, list, delete, and read operations for complete backup management including retention policies
- **Progress Tracking**: Real-time upload/download progress with resumable media uploads for large backup files
- **Connection Testing**: Verifies OAuth tokens, Drive API access, and folder permissions before creating jobs

#### ☁️ Dropbox Storage Destination
- **New Cloud Adapter**: Store backups directly in Dropbox with native OAuth 2.0 authentication
- **OAuth 2.0 Flow**: One-click authorization in the UI — redirects to Dropbox's consent screen, automatically stores refresh token (encrypted at rest)
- **Automatic Token Refresh**: Dropbox SDK handles token renewal automatically — no manual re-authorization required
- **Folder Path**: Optional target folder path (e.g. `/backups`) — creates subfolder hierarchies as needed
- **Visual Folder Browser**: Browse and select target folders directly from Dropbox — navigable dialog with breadcrumbs
- **Large File Support**: Chunked session uploads for files > 150 MB (up to 350 GB per file)
- **Full Lifecycle**: Upload, download, list, delete, and read operations for complete backup management including retention policies
- **Connection Testing**: Verifies OAuth tokens, account access, and write/delete permissions before creating jobs

#### ☁️ Microsoft OneDrive Storage Destination
- **New Cloud Adapter**: Store backups directly in Microsoft OneDrive via OAuth 2.0 using the Microsoft Graph API
- **OAuth 2.0 Flow**: One-click authorization in the UI — redirects to Microsoft's consent screen, automatically stores refresh token (encrypted at rest)
- **Personal & Organizational Accounts**: Works with both personal Microsoft accounts (Outlook, Hotmail) and Microsoft 365 / Azure AD organizational accounts
- **Automatic Token Refresh**: Uses refresh tokens with auto-renewal — no manual re-authorization required
- **Folder Path**: Optional target folder path (e.g., `/DBackup`) — creates subfolder hierarchies as needed
- **Visual Folder Browser**: Browse and select target folders directly from OneDrive — navigable dialog with breadcrumbs
- **Smart Upload Strategy**: Simple PUT for files ≤ 4 MB, chunked upload sessions with 10 MB chunks for larger files
- **Full Lifecycle**: Upload, download, list, delete, and read operations for complete backup management including retention policies
- **Connection Testing**: Verifies OAuth tokens, OneDrive access, folder permissions, and write/delete operations before creating jobs

#### 📡 Rsync (SSH) Storage Destination
- **New Storage Adapter**: Store backups on any remote server using rsync over SSH — leverages rsync's delta-transfer algorithm for efficient incremental syncs
- **Three Auth Methods**: Password (via `sshpass`), SSH Private Key (PEM format), and SSH Agent authentication — matching SFTP's auth options
- **Delta Transfer**: Only changed blocks are transferred, significantly reducing bandwidth for recurring backups to the same destination
- **Compression**: Built-in transfer compression (`-z` flag) reduces network usage during upload and download
- **Custom Options**: Optional field for additional rsync flags (e.g., `--bwlimit`, `--timeout`, `--exclude`)
- **Full Lifecycle**: Upload, download, list, delete, and read operations for complete backup management including retention policies
- **Connection Testing**: Write/delete verification test ensures proper permissions before creating jobs

### 🔒 Security
- **OAuth Refresh Token Encryption**: Refresh tokens and client secrets are encrypted at rest using `ENCRYPTION_KEY` (added to `SENSITIVE_KEYS`)
- **No Token Exposure**: Access tokens are never stored — generated on-the-fly from encrypted refresh tokens
- **Scoped Access**: Uses `drive.file` scope for backup operations (only access files DBackup created) and `drive.readonly` for folder browsing (navigate existing folders to select a target)
- **No Plaintext Passwords**: Rsync passwords are never passed as command-line arguments — uses `SSHPASS` environment variable exclusively
- **Sanitized Error Messages**: All error output is sanitized to strip commands, credentials, and SSH warnings before displaying to users
- **SSH Options Hardening**: Password auth disables public key authentication to prevent SSH agent interference (`PreferredAuthentications=password`, `PubkeyAuthentication=no`)

### ⚡ Performance
- **Cached Storage Statistics**: Dashboard no longer queries cloud storage APIs (Dropbox, Google Drive, S3, etc.) on every page load — storage volume data is cached in the database and served instantly
- **New System Task "Refresh Storage Statistics"**: Periodically refreshes storage file counts and sizes from all destinations (default: every hour). Configurable in Settings → System Tasks
- **Auto-Refresh After Changes**: Storage cache is automatically updated after each successful backup, retention cleanup, and manual file deletion in the Storage Explorer
- **Parallel Adapter Queries**: Storage statistics refresh now queries all adapters in parallel instead of sequentially — significantly faster with multiple destinations
- **Eliminated Duplicate Calls**: Fixed `getStorageVolume()` being called twice per dashboard page load (once directly, once via `getDashboardStats()`)

### 📊 Storage Usage History
- **Historical Storage Charts**: Click any storage destination on the dashboard to open a detailed usage history chart — shows how storage size has changed over days, weeks, or months
- **Configurable Time Range**: Select from 7 days to 1 year to analyze storage growth trends
- **Area Chart Visualization**: Smooth area chart with gradient fill showing storage size over time
- **Storage Delta**: Displays the change in storage size compared to the start of the selected period (e.g., "+1.2 GB vs 30d ago")
- **Automatic Data Collection**: Storage snapshots are recorded at each scheduled stats refresh (default: hourly) — no additional configuration needed
- **Snapshot Retention**: Old snapshots are automatically cleaned up after 90 days to prevent database bloat

### 🐛 Bug Fixes
- **Dashboard Layout**: Fixed Job Status chart stretching to match Storage Usage card height when many destinations are configured
- **Adapter Details Column**: Fixed missing details display for OneDrive (`folderPath`), MariaDB, and MSSQL (`user@host:port`) in the Sources and Destinations tables

### 🔧 Technical Changes
- New `src/lib/notifications/types.ts` — Type definitions, event constants (`NOTIFICATION_EVENTS`), `NotifyUserMode`, `SystemNotificationConfig`, and typed event data interfaces
- New `src/lib/notifications/events.ts` — Event registry with metadata (category, default state, `supportsNotifyUser` flag)
- New `src/lib/notifications/templates.ts` — Template functions generating adapter-agnostic `NotificationPayload` objects for all 8 event types
- New `src/lib/notifications/index.ts` — Barrel exports
- New `src/services/system-notification-service.ts` — Core dispatch service with `notify()`, `getNotificationConfig()`, `saveNotificationConfig()`, user-targeted email routing
- New `src/app/actions/notification-settings.ts` — Server actions for loading/saving notification config and sending test notifications
- New `src/components/settings/notification-settings.tsx` — Settings UI component with global channel selector, per-event cards, notify-user dropdown
- New `src/components/email/system-notification-template.tsx` — Unified React email template with colored header bar and fields table
- Updated `src/lib/core/interfaces.ts` — Extended `NotificationContext` with `eventType`, `title`, `fields`, `color` properties
- Updated `src/lib/adapters/notification/discord.ts` — Simplified to single rendering path using `NotificationContext` fields for embeds
- Updated `src/lib/adapters/notification/email.tsx` — Migrated to `SystemNotificationEmail` template, removed legacy `NotificationEmail` branch
- Updated `src/lib/runner/steps/04-completion.ts` — Per-job notifications now use `renderTemplate()` with `BACKUP_SUCCESS`/`BACKUP_FAILURE` events
- Updated `src/lib/auth.ts` — Added `databaseHooks.session.create.after` hook firing `USER_LOGIN` notification
- Updated `src/app/actions/user.ts` — `createUser()` fires `USER_CREATED` notification
- Updated `src/services/restore-service.ts` — Fires `RESTORE_COMPLETE`/`RESTORE_FAILURE` notifications
- Updated `src/lib/runner/config-runner.ts` — Fires `CONFIG_BACKUP` notification after config backup
- Updated `src/app/dashboard/settings/page.tsx` — Added Notifications tab to settings
- Updated `src/components/adapter/adapter-manager.tsx` — Health status column conditionally hidden for notification adapters
- Deleted `src/components/email/notification-template.tsx` — Legacy backup-only email template replaced by unified system template
- Updated `wiki/user-guide/features/notifications.md` — Complete rewrite covering both per-job and system notifications
- Updated `wiki/developer-guide/adapters/notification.md` — Complete rewrite with architecture overview, dispatch flow, and guides for adding new events/adapters
- New `src/components/ui/tag-input.tsx` — Reusable tag/chip input component with Enter/Tab/comma/Space triggers, Backspace removal, paste support, and validation callback
- New `src/components/adapter/email-tag-field.tsx` — Email-specific tag field wrapper for react-hook-form with string-to-array normalization
- Updated `src/lib/adapters/definitions.ts` — `EmailSchema.to` changed from `z.string().email()` to `z.union([string, array])` for multi-recipient support
- Updated `src/lib/adapters/notification/email.tsx` — `sendMail()` now joins array recipients to comma-separated string for nodemailer
- Updated `src/components/adapter/form-sections.tsx` — `NotificationFormContent` renders `to` field as `EmailTagField` instead of generic text input
- Updated `src/components/adapter/adapter-manager.tsx` — Email adapter summary truncates long recipient lists (e.g., "a@x.com, b@x.com +1")
- New `src/lib/adapters/storage/google-drive.ts` — Google Drive storage adapter using `googleapis` npm package
- New `src/app/api/adapters/google-drive/auth/route.ts` — OAuth authorization URL generation endpoint
- New `src/app/api/adapters/google-drive/callback/route.ts` — OAuth callback handler with token exchange
- New `src/components/adapter/google-drive-oauth-button.tsx` — OAuth authorization button with status indicator
- New `src/components/adapter/oauth-toast-handler.tsx` — OAuth redirect toast notifications
- New `src/components/adapter/google-drive-folder-browser.tsx` — Visual folder browser dialog for Google Drive
- New `src/app/api/system/filesystem/google-drive/route.ts` — Google Drive folder browsing API endpoint
- New `src/lib/adapters/storage/rsync.ts` — Rsync storage adapter using `rsync` npm package (CLI wrapper)
- New `src/types/rsync.d.ts` — TypeScript type declarations for the untyped `rsync` npm module
- Updated `src/lib/adapters/definitions.ts` — Added `GoogleDriveSchema`, `GoogleDriveConfig` type, `RsyncSchema`, `RsyncConfig` type, updated `StorageConfig` union and `ADAPTER_DEFINITIONS`
- Updated `src/lib/adapters/index.ts` — Registered `GoogleDriveAdapter` and `RsyncAdapter`
- Updated `src/lib/crypto.ts` — Added `clientSecret` and `refreshToken` to `SENSITIVE_KEYS`
- Updated `src/components/adapter/form-constants.ts` — Added form field mappings and placeholders for Google Drive and Rsync
- Updated `src/components/adapter/form-sections.tsx` — Special rendering for Google Drive OAuth flow and Rsync auth type
- Updated `src/components/adapter/utils.ts` — Added icon mappings for Google Drive (Cloud) and Rsync (Network)
- Updated `src/components/adapter/adapter-manager.tsx` — Added summary display cases for Google Drive and Rsync
- Updated `src/app/api/adapters/test-connection/route.ts` — Added `google-drive` and `rsync` to storage permission regex
- Updated `src/app/api/adapters/access-check/route.ts` — Added `google-drive` and `rsync` to storage permission regex
- Updated `src/app/dashboard/destinations/page.tsx` — Added OAuth toast handler for redirect notifications
- New `src/lib/adapters/storage/dropbox.ts` — Dropbox storage adapter using `dropbox` npm package with OAuth 2.0
- New `src/app/api/adapters/dropbox/auth/route.ts` — Dropbox OAuth authorization URL generation endpoint
- New `src/app/api/adapters/dropbox/callback/route.ts` — Dropbox OAuth callback handler with token exchange
- New `src/components/adapter/dropbox-oauth-button.tsx` — Dropbox OAuth authorization button with status indicator
- New `src/components/adapter/dropbox-folder-browser.tsx` — Visual folder browser dialog for Dropbox
- New `src/app/api/system/filesystem/dropbox/route.ts` — Dropbox folder browsing API endpoint
- Updated `src/lib/adapters/definitions.ts` — Added `DropboxSchema`, `DropboxConfig` type, updated `StorageConfig` union
- Updated `src/lib/adapters/index.ts` — Registered `DropboxAdapter`
- Updated `src/components/adapter/form-sections.tsx` — Special rendering for Dropbox OAuth flow and folder browser
- Updated `src/components/adapter/form-constants.ts` — Added form field mappings and placeholders for Dropbox
- Updated `src/components/adapter/utils.ts` — Added icon mapping for Dropbox (Cloud)
- Updated `src/components/adapter/adapter-manager.tsx` — Added summary display case for Dropbox
- Updated `src/app/api/adapters/test-connection/route.ts` — Added `dropbox` to storage permission regex
- Updated `src/app/api/adapters/access-check/route.ts` — Added `dropbox` to storage permission regex
- New `src/lib/adapters/storage/onedrive.ts` — OneDrive storage adapter using `@microsoft/microsoft-graph-client` npm package with OAuth 2.0
- New `src/app/api/adapters/onedrive/auth/route.ts` — Microsoft OAuth authorization URL generation endpoint
- New `src/app/api/adapters/onedrive/callback/route.ts` — Microsoft OAuth callback handler with token exchange
- New `src/components/adapter/onedrive-oauth-button.tsx` — OneDrive OAuth authorization button with status indicator
- New `src/components/adapter/onedrive-folder-browser.tsx` — Visual folder browser dialog for OneDrive
- New `src/app/api/system/filesystem/onedrive/route.ts` — OneDrive folder browsing API endpoint
- Updated `src/lib/adapters/definitions.ts` — Added `OneDriveSchema`, `OneDriveConfig` type, updated `StorageConfig` union
- Updated `src/lib/adapters/index.ts` — Registered `OneDriveAdapter`
- Updated `src/components/adapter/form-sections.tsx` — Special rendering for OneDrive OAuth flow and folder browser
- Updated `src/components/adapter/form-constants.ts` — Added form field mappings and placeholders for OneDrive
- Updated `src/components/adapter/utils.ts` — Added icon mapping for OneDrive (Cloud)
- Updated `src/app/api/adapters/test-connection/route.ts` — Added `onedrive` to storage permission regex
- Updated `src/app/api/adapters/access-check/route.ts` — Added `onedrive` to storage permission regex
- Updated `wiki/` — Added OneDrive user guide, updated developer guide, destinations index, sidebar navigation, and changelog
- Updated `src/services/dashboard-service.ts` — Replaced live cloud API calls with DB-cached `getStorageVolume()`, added `refreshStorageStatsCache()`, `getStorageVolumeCacheAge()`, `saveStorageSnapshots()`, `getStorageHistory()`, and `cleanupOldSnapshots()`
- Updated `src/services/system-task-service.ts` — Added `REFRESH_STORAGE_STATS` system task with hourly default schedule
- Updated `src/lib/runner/steps/04-completion.ts` — Triggers non-blocking storage stats cache refresh after successful backups
- Updated `src/lib/runner/steps/05-retention.ts` — Triggers non-blocking storage stats cache refresh after retention deletes files
- Updated `src/app/api/storage/[id]/files/route.ts` — Triggers non-blocking storage stats cache refresh after manual file deletion
- Updated `src/components/dashboard/widgets/storage-volume-chart.tsx` — Added "Updated" timestamp with tooltip, clickable storage entries opening history modal
- New `src/components/dashboard/widgets/storage-history-modal.tsx` — Storage usage history modal with area chart, time range selector, and delta display
- New `src/app/api/storage/[id]/history/route.ts` — GET endpoint returning historical storage usage snapshots
- New `prisma/migrations/*_add_storage_snapshot/` — Database migration for `StorageSnapshot` model
- Updated `src/app/dashboard/page.tsx` — Passes cache timestamp to StorageVolumeChart, fixed layout from `grid-rows-2` to `flex flex-col`
- Updated `Dockerfile` — Added `rsync`, `sshpass`, and `openssh-client` Alpine packages
- Updated `scripts/setup-dev-macos.sh` — Added `brew install rsync` and `brew install hudochenkov/sshpass/sshpass`

## v0.9.5-beta - Dashboard Overhaul, Checksums & Visual Analytics
*Released: February 13, 2026*

This release introduces a completely redesigned dashboard with interactive charts, real-time statistics, and auto-refresh capabilities. It also adds SHA-256 checksum verification throughout the backup lifecycle for end-to-end data integrity. The dashboard now provides a comprehensive at-a-glance overview of backup health, job activity, and storage usage. Sources, Destinations, and Notifications pages now feature smart type filters for quick navigation.

### ✨ New Features

#### 🔒 SHA-256 Checksum Verification
- **Backup Pipeline Integration**: Every backup now calculates a SHA-256 checksum of the final file (after compression/encryption) and stores it in the `.meta.json` sidecar file
- **Post-Upload Verification (Local Storage)**: For local filesystem storage, the backup is re-downloaded and its checksum verified after upload. Remote storage (S3, SFTP, etc.) relies on transport-level integrity checks to avoid costly re-downloads of large files
- **Restore Verification**: Before decryption/decompression, the downloaded backup file's checksum is verified against the stored value — aborts restore if mismatch detected
- **Integrity Check System Task**: New periodic system task (`system.integrity_check`) that verifies all backups across all storage destinations. Runs weekly (Sunday 4 AM), disabled by default
- **IntegrityService**: New service that iterates all storage configs, downloads each backup, and verifies checksums — reports total files, verified, passed, failed, and skipped counts

#### 🔍 Smart Type Filters
- **Sources Page**: Faceted filter to narrow sources by database type (MySQL, PostgreSQL, MongoDB, Redis, etc.)
- **Destinations Page**: Faceted filter to narrow destinations by storage type (Local, S3, SFTP, etc.)
- **Notifications Page**: Faceted filter to narrow notifications by adapter type
- **Dynamic Options**: Filter only shows types that have at least one entry — no empty options cluttering the UI
- **Auto-Hide**: Filter button is hidden entirely when all entries are the same type or only one entry exists

#### 📊 Interactive Dashboard Charts
- **Activity Chart**: New stacked bar chart showing backup and restore executions over the last 14 days, grouped by status (Completed, Failed, Running, Pending)
- **Job Status Distribution**: Donut chart visualizing the status distribution of all executions in the last 30 days, with success rate percentage displayed in the center
- **Recharts Integration**: Added Recharts via the official shadcn/ui Chart component for consistent, accessible chart rendering

#### 📈 Expanded Stats Cards
- **7 KPI Cards**: Dashboard now shows Total Jobs, Active Schedules, Backups, Total Storage, Success Rate, 24h Successful, and 24h Failed at a glance
- **Visual Indicators**: Each card includes an icon and descriptive subtitle for quick orientation

#### 🗂️ Latest Jobs Widget
- **Live Activity Feed**: New widget showing recent backup and restore executions with status badges and relative timestamps
- **Type Filter**: Dropdown filter to show All, Backup-only, or Restore-only executions
- **Source Icons**: Database type icons (MySQL, PostgreSQL, MongoDB, etc.) displayed alongside job names

#### 🔄 Auto-Refresh
- **Smart Polling**: Dashboard automatically refreshes every 3 seconds while backup or restore jobs are running
- **Auto-Stop**: Polling stops automatically when all jobs complete, with one final refresh to update the view
- **Zero Config**: No user interaction needed — refresh activates and deactivates based on job state

#### 💾 Storage Overview
- **Per-Destination Breakdown**: Storage widget lists each configured storage destination with backup count and total size
- **Live File Scanning**: Storage sizes are calculated from actual files via storage adapters (not just database records)
- **Total Summary**: Aggregated total row shown when multiple storage destinations are configured

#### 🌐 WebDAV Storage Destination
- **New Storage Adapter**: Store backups on any WebDAV-compatible server — Nextcloud, ownCloud, Synology WebDAV, Apache (mod_dav), Nginx, or any other WebDAV endpoint
- **HTTPS Support**: Encrypted file transfers over standard HTTP/HTTPS — no special ports or protocols needed
- **No CLI Dependency**: Uses the `webdav` npm package directly — no system-level tools required (unlike SMB)
- **Path Prefix**: Optional subdirectory for organized backup storage
- **Full Lifecycle**: Upload, download, list, delete, and read operations for complete backup management including retention policies
- **Connection Testing**: Write/delete verification test ensures proper permissions before creating jobs

#### 📂 SMB / Samba Storage Destination
- **New Storage Adapter**: Store backups on SMB/CIFS network shares — Windows file servers, NAS devices (Synology, QNAP, TrueNAS), and Linux Samba servers
- **Protocol Support**: Configurable SMB protocol version (SMB3, SMB2, NT1) with SMB3 as default for encryption support
- **Domain Authentication**: Supports workgroup and Active Directory domain authentication
- **Path Prefix**: Optional subdirectory on the share for organized backup storage
- **Full Lifecycle**: Upload, download, list, delete, and read operations for complete backup management including retention policies
- **Connection Testing**: Write/delete verification test ensures proper permissions before creating jobs

#### 📡 FTP / FTPS Storage Destination
- **New Storage Adapter**: Store backups on any FTP server with optional TLS encryption — shared hosting, legacy infrastructure, and classic file servers
- **Explicit FTPS Support**: Optional TLS encryption (AUTH TLS on port 21) for secure file transfers — plain FTP available but not recommended for production
- **Universal Compatibility**: Works with virtually any hosting provider without CLI dependencies — uses the `basic-ftp` npm package directly
- **Anonymous & Authenticated Access**: Supports both anonymous FTP and username/password authentication
- **Path Prefix**: Optional remote directory for organized backup storage
- **Full Lifecycle**: Upload, download, list, delete, and read operations for complete backup management including retention policies
- **Connection Testing**: Write/delete verification test ensures proper permissions before creating jobs

### 🐛 Bug Fixes
- **Accurate Backup Sizes**: Fixed backup file size tracking to reflect the actual compressed and encrypted file size instead of the raw database dump size
- **DateDisplay Crash**: Fixed a crash when using relative date formatting by switching to `formatDistanceToNow` from date-fns

### 🧹 Code Cleanup
- Removed unused `getDialect` import from MongoDB restore adapter
- Removed outdated ESLint disable directive from core interfaces

### 🔧 Technical Changes
- New `src/lib/adapters/storage/webdav.ts` — WebDAV storage adapter using `webdav` npm package
- New `src/lib/adapters/storage/smb.ts` — SMB/CIFS storage adapter using `samba-client` npm package (wraps `smbclient` CLI)
- New `src/lib/adapters/storage/ftp.ts` — FTP/FTPS storage adapter using `basic-ftp` npm package
- Updated `src/lib/adapters/definitions.ts` — Added `WebDAVSchema`, `WebDAVConfig`, `SMBSchema`, `SMBConfig`, `FTPSchema`, `FTPConfig` types, and adapter definitions
- Updated `src/lib/adapters/index.ts` — Registered `WebDAVAdapter`, `SMBAdapter`, and `FTPAdapter` (renamed from `WebDAVStorageAdapter`, `SMBStorageAdapter`, `SFTPStorageAdapter` for consistency)
- Updated `src/components/adapter/form-constants.ts` — Added form field mappings and placeholders for WebDAV, SMB, and FTP
- Updated `src/components/adapter/utils.ts` — Added icon mappings for new storage adapters
- Updated `src/components/adapter/adapter-manager.tsx` — Added summary display cases for WebDAV, SMB, and FTP
- Updated `src/components/adapter/schema-field.tsx` — Added label override for `tls` field to display as "Encryption"
- Updated `Dockerfile` — Added `samba-client` Alpine package for `smbclient` CLI
- Updated `scripts/setup-dev-macos.sh` — Added `brew install samba` for local development
- New `src/lib/checksum.ts` — SHA-256 checksum utility with `calculateFileChecksum()`, `calculateChecksum()`, and `verifyFileChecksum()`
- New `src/services/integrity-service.ts` — Periodic integrity check service for all backups across all storage destinations
- New `tests/unit/lib/checksum.test.ts` — 12 unit tests covering checksum calculation, file hashing, and verification
- New `src/services/dashboard-service.ts` — Centralized server-side service for all dashboard data fetching
- New `src/components/dashboard/widgets/activity-chart.tsx` — Stacked bar chart (Client Component)
- New `src/components/dashboard/widgets/job-status-chart.tsx` — Donut chart with success rate (Client Component)
- New `src/components/dashboard/widgets/storage-volume-chart.tsx` — Storage list per destination
- New `src/components/dashboard/widgets/latest-jobs.tsx` — Filterable recent executions feed (Client Component)
- New `src/components/dashboard/widgets/dashboard-refresh.tsx` — Auto-refresh wrapper with smart polling
- Updated `src/lib/runner/steps/03-upload.ts` — File size now measured after compression/encryption pipeline; SHA-256 checksum calculated and stored in metadata; post-upload checksum verification added
- Updated `src/lib/core/interfaces.ts` — Added `checksum?: string` field to `BackupMetadata` interface
- Updated `src/services/restore-service.ts` — Pre-restore checksum verification of downloaded backup files
- Updated `src/services/system-task-service.ts` — Added `system.integrity_check` system task (weekly, disabled by default)

## v0.9.4-beta - Universal Download Links & Logging System
*Released: February 6, 2026*

This release extends the token-based download link feature (introduced for Redis restore) to all backup downloads in Storage Explorer. Additionally, it introduces a centralized logging and error handling system for better maintainability and debugging.

### ✨ New Features

#### 🔗 wget/curl Download Links for All Backups
The temporary download link feature is now available for all backup files:
- **Universal Access**: Click the Download button on any backup file and select "wget / curl Link"
- **Download Format Selection**: Choose between encrypted (.enc) or decrypted download for encrypted backups
- **Live Countdown Timer**: See exactly how much time remains before the link expires
- **Reusable Modal**: New `DownloadLinkModal` component can be integrated anywhere in the app
- **Ready-to-Use Commands**: Pre-formatted wget and curl commands with one-click copy

#### 🎯 Improved Download UX
- All files now show a dropdown menu on the Download button (not just encrypted files)
- Consistent download experience across all backup types
- wget/curl option always available regardless of encryption status

#### 📝 Centralized Logging System
Introduced a unified logging infrastructure to replace scattered `console.log` calls:
- **System Logger**: New `logger` utility (`src/lib/logger.ts`) with level-based logging (debug, info, warn, error)
- **Child Loggers**: Context-aware logging with `logger.child({ service: "ServiceName" })` for better traceability
- **Environment Control**: Configure log level via `LOG_LEVEL` environment variable
- **Output Formats**: Human-readable colored output in development, JSON format in production
- **Custom Error Classes**: New error hierarchy (`src/lib/errors.ts`) with specialized errors for adapters, services, encryption, etc.
- **Error Utilities**: `wrapError()`, `getErrorMessage()`, `isDBackupError()` for consistent error handling

#### 🌐 API Request & Security Logging
Added comprehensive logging in the Next.js middleware:
- **Request Logging**: All API requests are logged with method, path, duration, and anonymized IP
- **Rate Limit Events**: Warnings logged when clients exceed rate limits (for security monitoring)
- **IP Anonymization**: IPs are anonymized in logs for GDPR compliance (e.g., `192.168.x.x`)
- **Silent Paths**: High-frequency endpoints (`/api/health`, `/api/auth/get-session`) excluded to reduce noise

#### 🛡️ Type-Safe Error Handling
New custom error classes for better error categorization:
- `DBackupError` (base class)
- `AdapterError`, `ConnectionError`, `ConfigurationError`
- `ServiceError`, `NotFoundError`, `ValidationError`
- `PermissionError`, `AuthenticationError`
- `BackupError`, `RestoreError`, `EncryptionError`, `QueueError`

### 📚 Documentation
- Added comprehensive developer documentation for Download Tokens system
- Updated Storage Explorer user guide with wget/curl download section
- **New**: Added Logging System documentation in Developer Guide (System Logger, Custom Errors, Best Practices)

### 🧹 Code Cleanup
Removed legacy code that became obsolete after the v0.9.1 TAR architecture migration:
- **PostgreSQL Dialects**: Removed unused `pg_dumpall` branch from `getDumpArgs()` and simplified `getRestoreArgs()` to stub (restore uses `pg_restore` directly)
- **MySQL Dialects**: Removed unused multi-database branch (`--databases ...`) and `--all-databases` fallback from `getDumpArgs()`
- **MongoDB Dialects**: Simplified `getRestoreArgs()` to stub (restore builds args directly in `restore.ts`)
- **Roadmap**: Moved "PostgreSQL Restore Improvements" to completed (handled by TAR architecture)

### 🔧 Technical Changes
- New `src/lib/logger.ts` - Centralized logging utility
- New `src/lib/errors.ts` - Custom error class hierarchy
- New `src/lib/types/service-result.ts` - Type-safe service return type
- Migrated core services and adapters to use the new logging system
- Added lint-guard tests to detect `console.*` usage in source files

### 🍃 MongoDB Docker Compatibility
Replaced `mongosh` CLI dependency with native `mongodb` npm package for connection testing:
- **No CLI Dependency**: Connection test and database listing now use the native MongoDB driver instead of `mongosh`
- **Docker Compatible**: The `mongosh` shell is not available in Alpine-based Docker images, but the npm package works everywhere
- **Backup/Restore Unchanged**: `mongodump` and `mongorestore` (from `mongodb-tools`) are still used for actual backup operations
- **Cleaner Code**: Removed shell command parsing in favor of proper MongoDB client API calls

### 🔧 Type-Safe Adapter Configs
Exported TypeScript types from Zod schemas for better developer experience:
- **Inferred Types**: All adapter configs now have exported TypeScript types (e.g., `MySQLConfig`, `PostgresConfig`, `MongoDBConfig`)
- **100% Type-Safe**: All adapter functions (`dump()`, `restore()`, `test()`, `getDatabases()`) now use properly typed configs instead of `config: any`
- **Lint Guard Enforced**: New lint-guard test ensures `config: any` cannot be introduced in adapter files
- **Union Types**: Added `DatabaseConfig`, `StorageConfig`, `NotificationConfig`, `AnyDatabaseConfig` union types for generic handling
- **Extended Types**: Dump/restore functions use extended types with runtime fields (e.g., `MySQLDumpConfig`, `PostgresRestoreConfig`)
- **Better DX**: IDE autocomplete and compile-time error checking for adapter configurations

### 🎯 Interface Type Improvements
Further type safety improvements in the core interfaces:
- **AdapterConfigSchema**: `input` field now uses `z.ZodObject<z.ZodRawShape>` instead of `z.ZodObject<any>`
- **BackupMetadata**: Made extensible with index signature `[key: string]: unknown` for adapter-specific properties
- **BackupResult.metadata**: Changed to `Partial<BackupMetadata>` since adapters often return partial metadata
- **NotificationContext**: New typed interface for notification adapter context with fields like `success`, `duration`, `size`, `status`, `logs`, etc.
- **Documentation**: Added JSDoc comments explaining the type design decisions

## v0.9.3-beta - Redis Support, Restore UX & Smart File Extensions
*Released: February 2, 2026*

This release adds Redis as a new supported database type, introduces a guided restore wizard for Redis, and implements adapter-specific backup file extensions for better file identification.

### ✨ New Features

#### 🗄️ Redis Database Support
- **New Adapter**: Added Redis adapter for backing up Redis databases via RDB snapshots
- **Standalone & Sentinel Mode**: Support for standalone Redis servers and Sentinel high-availability setups
- **Redis 6, 7 & 8**: Full support and test coverage for all current Redis versions
- **ACL Support**: Optional username/password authentication for Redis 6+ Access Control Lists
- **TLS Support**: Secure connections via `--tls` flag
- **Database Selection**: Support for Redis database indices (0-15)

#### 🧙 Redis Restore Wizard
Since Redis cannot restore RDB files remotely, we've built a dedicated step-by-step wizard:
- **Guided Process**: 6-step wizard walks users through the manual restore process
- **Secure Download Links**: Generate temporary, single-use download URLs (5-minute expiry) for wget/curl
- **Copy-to-Clipboard**: All commands have one-click copy buttons
- **Platform-Specific**: Separate instructions for Systemd (Linux) and Docker deployments
- **Progress Tracking**: Visual step completion indicators

#### ⚠️ warning Redis Restore Limitations
- **Restore requires server access**: Redis RDB restore cannot be performed remotely. The backup file must be copied to the server's data directory and Redis must be restarted
- **Full server backup only**: RDB snapshots contain all databases (0-15), not individual databases
- **Cluster mode not yet supported**: Only standalone and Sentinel modes are available

#### 📁 Smart Backup File Extensions
Backup files now use appropriate extensions based on the database type:

| Database | Extension | Example |
|----------|-----------|---------|
| MySQL | `.sql` | `backup_2026-02-02.sql.gz.enc` |
| MariaDB | `.sql` | `backup_2026-02-02.sql.gz.enc` |
| PostgreSQL | `.sql` | `backup_2026-02-02.sql.gz.enc` |
| MSSQL | `.bak` | `backup_2026-02-02.bak.gz.enc` |
| MongoDB | `.archive` | `backup_2026-02-02.archive.gz.enc` |
| Redis | `.rdb` | `backup_2026-02-02.rdb.gz.enc` |
| SQLite | `.db` | `backup_2026-02-02.db.gz.enc` |

#### 🔗 Token-Based Public Downloads
- **Temporary Tokens**: Generate secure, single-use download links for backup files
- **No Auth Required**: Links work with wget/curl without session cookies
- **5-Minute Expiry**: Tokens automatically expire for security
- **Audit Trail**: Token generation is tied to authenticated users

#### ⚙️ User Preferences
- **New Preferences Tab**: Added a dedicated "Preferences" tab in the user profile settings
- **Auto-Redirect Setting**: Users can now disable automatic redirection to History page when starting backup/restore jobs
- **Instant Save**: Preference toggles save immediately without requiring a save button
- **Default Enabled**: Auto-redirect is enabled by default for new users

#### 🐳 Docker Deployment Enhancements
- **Docker Hub**: Images are now available on Docker Hub at [`skyfay/dbackup`](https://hub.docker.com/r/skyfay/dbackup) in addition to GitLab Registry. Docker Hub is now the default in all documentation
- **DATABASE_URL Default**: The Dockerfile now includes a sensible default (`file:/app/db/dbackup.db`), eliminating the need to configure this variable for standard deployments
- **TZ Variable**: Added timezone support via `TZ` environment variable (defaults to `UTC`)
- **TMPDIR Support**: New centralized `getTempDir()` utility respects the `TMPDIR` environment variable for custom temp directories (useful for tmpfs mounts)

#### 🔐 Authentication Improvements
- **Port Mapping Fix**: Fixed authentication issues when using Docker port mappings like `3001:3000`. The auth client now correctly uses the browser's current origin instead of a hardcoded URL
- **TRUSTED_ORIGINS**: New environment variable to allow multiple access URLs (e.g., both IP and domain). Accepts comma-separated list of additional trusted origins
- **Removed NEXT_PUBLIC_APP_URL**: This variable was removed as Next.js public variables are build-time only and don't work at runtime in Docker

### 📚 Documentation
- **Consolidated Installation Docs**: Docker Compose and Docker Run commands are now in a single location ([installation.md](/user-guide/installation)) with a tab switcher, eliminating duplication across pages
- **Environment Variables Audit**: Cleaned up documentation to only include actually implemented variables. Removed references to non-existent SMTP_*, LOG_*, and other placeholder variables
- **Improved Quick Start**: Streamlined the landing page and getting started guide to focus on concepts, with clear links to the installation guide for commands

#### 📅 Wiki Date Timestamps
- **Git History Fix**: VitePress build now fetches full git history on Cloudflare Pages, ensuring "Last updated" timestamps reflect actual commit dates instead of build time
- **European Date Format**: Changed date display format to DD/MM/YYYY for better international compatibility

### 🔧 Technical Changes
- Added `redis` package to Docker image for `redis-cli`
- New adapter at `src/lib/adapters/database/redis/`
- Test containers for Redis 6, 7 and 8 in `docker-compose.test.yml`
- New `backup-extensions.ts` utility for adapter-specific file extensions
- New `download-tokens.ts` for temporary public download URLs
- New `public-download` API endpoint for token-based downloads
- New `RedisRestoreWizard` component with step-by-step guidance
- Centralized temp directory handling in `src/lib/temp-dir.ts`
- New `autoRedirectOnJobStart` field in User model for redirect preference
- New `/api/user/preferences` endpoint for fetching user preferences
- New `useUserPreferences` hook for client-side preference access
- Auto-save preference toggles in profile settings (no save button needed)
- Updated all files using `os.tmpdir()` to use the new `getTempDir()` utility
- Auth client `baseURL` changed to empty string for proper origin detection
- Integration tests now skip adapters with missing CLI tools automatically

## v0.9.2-beta - Branding & Documentation
*Released: February 1, 2026*

This release focuses on improving the visual identity and accessibility of the project.

### ✨ New Features

#### 🎨 Visual Identity
- **Official Logo**: Introduced the first official DBackup logo (database with cloud and backup symbol)
- **Favicon**: Multi-resolution favicon support (16x16 to 512x512) for all browsers and devices
- **Brand Integration**: Logo now appears in the application (login page, sidebar header, browser tab)

#### 📚 Documentation & Community
- **Documentation Portal**: Launched official documentation at [https://dbackup.app](https://dbackup.app)
- **In-App Link**: Added quick access to documentation from the user menu in the sidebar
- **Discord Community**: Linked Discord server in the documentation for community support
- **SEO Optimization**: Added comprehensive meta tags, Open Graph, Twitter Cards, and structured data for better discoverability

## v0.9.1-beta - Unified Multi-DB TAR Architecture
*Released: February 1, 2026*

This release introduces a unified TAR-based backup format for multi-database backups across all database adapters. This brings consistency, reliability, and new features like selective restore.

### ⚠️ BREAKING CHANGE: Multi-DB Backup Format Changed

The backup format for **multi-database backups** has fundamentally changed from inline SQL/dump streams to TAR archives.

- **Affected**: Multi-DB backups created with MySQL, PostgreSQL, or MongoDB in versions prior to v0.9.1
- **Not Affected**: Single-database backups remain compatible
- **Action Required**: Old multi-DB backups cannot be restored with v0.9.1+. Keep a copy of v0.9.0 if you need to restore legacy backups, or re-create backups after upgrading

**Why this change?**
- Enables selective restore (choose specific databases)
- Enables database renaming during restore
- Consistent format across all database types
- Eliminates complex stream parsing that was error-prone

### ✨ New Features

#### 📦 Unified TAR Multi-DB Format
- **Consistent Architecture**: All database adapters (MySQL, PostgreSQL, MongoDB, MSSQL) now use the same TAR archive format for multi-database backups
- **Manifest File**: Each TAR archive includes a `manifest.json` with metadata about contained databases, sizes, and formats
- **Selective Restore**: Choose which databases to restore from a multi-DB backup
- **Database Renaming**: Restore databases to different names (e.g., `production` → `staging_copy`)

#### 🐘 PostgreSQL Improvements
- **Custom Format**: Multi-DB backups now use `pg_dump -Fc` (custom format) per database instead of `pg_dumpall`
- **Parallel-Ready**: Individual database dumps enable future parallel backup support
- **Smaller Backups**: Custom format includes built-in compression

#### 🍃 MongoDB Multi-DB
- **True Multi-DB Support**: MongoDB adapter now supports backing up multiple selected databases (previously only "all or one")
- **Database Renaming**: Uses `--nsFrom/--nsTo` for restoring to different database names

### 🔧 Improvements
- **Code Reduction**: PostgreSQL restore logic reduced by 53% (592 → 279 LOC) by removing complex Transform streams
- **Shared Utilities**: New `tar-utils.ts` with 18 unit tests for TAR operations
- **Cleaner Adapters**: Removed legacy multi-DB parsing code from all adapters

### 🧪 Testing & Quality
- **Multi-DB Integration Tests**: New test suites for TAR-based multi-database backup and restore
- **MSSQL Test Setup**: Automatic `testdb` database creation for MSSQL containers via `setup-mssql-testdb.sh`
- **Azure SQL Edge Skip**: Tests gracefully skip Azure SQL Edge on ARM64 Macs (limited functionality)
- **84 Integration Tests**: Full coverage across MySQL, MariaDB, PostgreSQL, MongoDB, and MSSQL

### 📚 Documentation
- **Developer Guide**: Updated database adapter documentation with TAR format details
- **User Guide**: Added Multi-DB restore workflow documentation
- **Naming Consistency**: Standardized "Microsoft SQL Server" / "MSSQL" naming throughout docs

## v0.9.0-beta - Microsoft SQL Server & Self-Service Security
*Released: January 31, 2026*

This release introduces full support for Microsoft SQL Server (MSSQL), bringing the Database Backup Manager to enterprise Windows environments. We have also added a dedicated Self-Service Password Change flow for users and hardened the application with new stress-testing tools.

### ✨ New Features

#### 🏢 Microsoft SQL Server (MSSQL) Support
- **Native Adapter**: Added a fully featured adapter for Microsoft SQL Server
- **Smart Detection**: The adapter automatically detects the SQL Server Edition (e.g., Express, Enterprise) and Version to enforce feature compatibility
- **Multi-DB Support**: Supports backing up multiple MSSQL databases in a single job by bundling them into a TAR archive
- **Server-Side Backups**: Optimized to handle local backup paths on the SQL Server host with built-in compression support
- **Security**: Implemented parameterized queries and strict timeout handling to ensure robust and secure connections

#### 👤 User Self-Service
- **Password Change UI**: Users can now securely change their own passwords directly from their profile settings
- **Audit Integration**: The audit log system has been updated to recognize and correctly tag "self-service" actions performed by users on their own accounts

### 🧪 Testing & Infrastructure
- **Stress Testing**: Introduced a new stress test data generator and npm scripts to simulate heavy load and large datasets
- **Isolation**: Refactored the testing suite to use a dedicated `testdb` container instead of shared resources, preventing flaky tests
- **Cleanup**: Improved temporary file handling (`/tmp`) for MSSQL test backups to prevent disk bloat during CI runs

### 📚 Documentation
- **MSSQL Guide**: Added comprehensive documentation covering MSSQL Editions, server-side backup permissions, and deployment strategies
- **Meta-Backup**: Finalized documentation and TODO items regarding the internal configuration backup system

## v0.8.3-beta - Meta-Backups & System Task Control
*Released: January 30, 2026*

This release introduces "Meta-Backups"—the ability for the Database Backup Manager to backup its own configuration, users, and state. This ensures that your backup infrastructure is just as resilient as the databases it protects.

### ✨ New Features

#### 🛡️ Configuration "Meta-Backups"
- **Self-Backup**: The application can now create backups of its own internal configuration, including Users, Jobs, and Settings
- **Storage Integration**: Configuration backups can be routed to your existing storage adapters, with specific filtering options
- **Disaster Recovery**: Added a full "System Config Restore" flow that allows you to rebuild the application state from a storage file
- **Sanitization**: User accounts and sensitive data are carefully sanitized and handled during the export/import process to ensure security

#### 🔑 Smart Encryption Recovery
- **Profile Portability**: You can now explicitly export and import Encryption Profile secret keys. This is critical for migrating your setup to a new server
- **Smart Detection**: The restore logic now includes "Smart Recovery" which detects if a required Encryption Profile is missing during a restore attempt and prompts/handles the situation accordingly
- **Nested Metadata**: Improved parsing logic to handle complex, nested encryption metadata structures

#### ⚙️ System Task Management
- **Task Control**: Administrators can now manually Enable or Disable specific background system tasks (e.g., Update Checks, Config Backups)
- **Unified Scheduling**: The configuration backup schedule has been moved into the standard System Task scheduler for consistent management
- **Auto-Save**: Added auto-save functionality to the Configuration Backup settings page for a smoother UX

### 🐛 Fixes & Quality of Life
- Added comprehensive documentation for exporting/importing secrets and disaster recovery procedures
- Fixed issues with metadata key consistency and folder structures (`config-backups`)
- Added new tests regarding AI transparency, scheduler logic, and config service edge-cases
- Removed the manual backup trigger from the UI in favor of the standardized system task controls

## v0.8.2-beta - Keycloak, Encryption Imports & Database Reset
*Released: January 29, 2026*

This release introduces native support for Keycloak OIDC, enhances the security of authentication flows, and adds critical functionality for importing Encryption Profiles.

### ⚠️ BREAKING CHANGE: Database Reset Required

We have consolidated the entire database schema history into a single, clean initialization migration to ensure long-term stability.

- **Action Required**: You must delete your existing `dev.db` file and allow the application to re-initialize on startup
- **Data Loss**: Existing data cannot be migrated automatically. Please ensure you have offloaded any critical backups before upgrading

### ✨ New Features

#### 🔐 Keycloak & OIDC Security
- **Keycloak Adapter**: Added a dedicated OIDC adapter and icon specifically for Keycloak integrations
- **Security Hardening**: The OIDC client now enforces HTTPS for Keycloak providers and strictly rejects mixed-content endpoints to prevent insecurity
- **Discovery Headers**: Added necessary headers to Keycloak OIDC discovery fetches to ensure reliable connection

#### 🔑 Encryption & Recovery
- **Profile Import**: You can now import Encryption Profiles directly into the system. This is critical for disaster recovery if you need to restore backups on a fresh instance using backed-up keys
- **Smart Restore**: Added logic to handle restored profiles intelligently during the import process
- **Documentation**: Enhanced the encryption documentation and recovery logs to better explain key management

#### 👤 Authentication UX
- **2-Step Login**: Refactored the login experience to use an email-first 2-step flow. This improves user experience and prepares the UI for more advanced auth methods
- **SSO Configuration**: The SSO Provider form has been split into tabs for better organization, and error handling has been significantly improved

### 🐛 Fixes & Improvements
- "Edit" buttons are now ghost-styled, and footers are right-aligned for consistency
- Fixed an issue where page count could be undefined unless manual pagination was triggered
- Added new tests for profile imports and smart recovery logic

## v0.8.1-beta - SQLite Support & Remote File Browsing
*Released: January 26, 2026*

This update introduces full support for SQLite databases, including a powerful feature to backup remote SQLite files via SSH tunneling.

### ✨ New Features

#### 🗄️ SQLite Support (Local & SSH)
- **Native SQLite Adapter**: You can now add SQLite databases as backup sources
- **Remote SSH Support**: Uniquely, this adapter supports backing up SQLite files located on remote servers by streaming them through an SSH tunnel
- **Safe Restore**: The restore logic automatically handles the cleanup of the old database file before restoring the new one to ensure a clean state

#### 📂 Remote File Browser
- **File Picker Dialog**: Added a new modal dialog that allows you to browse the filesystem directly from the UI
- **SSH Integration**: The browser works for both the local server filesystem and connected remote SSH targets
- **Smart Inputs**: Integrated the file browser into adapter forms (e.g., for selecting database paths or SSH private keys)

### ⚡ Improvements
- **SFTP Authentication**: Added a specific `authType` selector to the SFTP storage form to clearly distinguish between Password and Private Key authentication
- **Docker Compose**: Updated the example `docker-compose.yml` to use the new `beta` image tag by default

### 📚 Documentation
- Added comprehensive documentation and deployment guides for the new SQLite adapter
- Refactored and reorganized the project documentation structure for better navigability

## v0.8.0-beta - The First Beta: SSO, Audit Logs & Cloud Storage
*Released: January 25, 2026*

This release marks the first official Beta of the Database Backup Manager! 🚀 We have made a massive leap in functionality and stability. This update introduces enterprise-ready features including OIDC/SSO Authentication, S3 & SFTP Storage, a comprehensive Audit Log System, and intelligent Database Dialect Detection.

### ✨ Key New Features

#### 🔐 SSO & Identity Management
- **OIDC Support**: Full support for OpenID Connect providers (tested with Authentik, PocketID, and Generic providers)
- **Account Linking**: Existing users can link SSO providers to their accounts
- **Auto-Provisioning**: Optional automatic user creation upon successful SSO login
- **Management UI**: Dedicated admin interface to configure providers, domains, and discovery endpoints
- **Security**: Added strict rate limiting, domain verification, and 2FA administration controls

#### ☁️ Expanded Storage Options
- **S3 Support**: Native support for AWS S3 and compatible providers (MinIO, R2, etc.) using the AWS SDK
- **SFTP Support**: Securely offload backups to remote servers via SFTP
- **Connection Testing**: Added a "Test Connection" button to storage adapters to verify credentials immediately
- **Smart Cleanup**: Automatically deletes associated metadata sidecar files when a backup is removed

#### 🛡️ Audit & Compliance
- **Comprehensive Audit Logs**: Tracks all key actions (User, Group, System, Adapter changes)
- **Detailed Tracking**: Logs include User IP, User Agent, and specific diffs of changes made
- **Retention Policy**: Configurable retention settings for audit logs to manage database size
- **DataTables**: New standardized table view with faceted filtering and search for audit history

#### 💾 Database Engine Improvements
- **Dialect Detection**: Adapters now automatically detect the specific version and dialect (e.g., MySQL 5.7 vs 8.0)
- **MariaDB Support**: Added a dedicated adapter and dialect handling for MariaDB
- **PostgreSQL**: Improved restore logic to skip system databases and handle version mismatches gracefully
- **Security**: Switched MySQL adapter to use `MYSQL_PWD` environment variable for safer password handling

#### ⚙️ System & Core
- **Update Checker**: Built-in service to check for new application versions and notify admins
- **System Tasks**: Added "Run on Startup" options for maintenance tasks (e.g., permissions sync)
- **Health Checks**: Visual health history grid and badges for all adapters
- **Settings**: Implemented auto-save for system settings and improved UI layouts

### 🧪 Testing & Stability
- Massive test coverage with comprehensive Unit and Integration tests for Backup & Restore Pipelines, Storage Services, Notification Logic & Scheduler
- Enforced strict TypeScript matching in restore services and removed legacy `any` types
- Improved Docker composition for spinning up multi-database test environments

### 🐛 Bug Fixes & Refactoring
- Optimized log rendering with structured log entries and stage grouping
- Migrated all major lists (Jobs, Users, History) to the new `DataTable` component
- Resolved session handling errors during heavy load
- Fixed clipboard copying error handling
- Fixed filename handling after decryption
- Corrected "Trusted Providers" mutation issue in auth requests

## v0.5.0-dev - RBAC System, Encryption Vault & Core Overhaul
*Released: January 24, 2026*

This release represents a massive milestone for the Database Backup Manager. We have introduced a full-featured Role-Based Access Control (RBAC) system, significantly enhanced security with Recovery Kits and Rate Limiting, and completely refactored the core execution engine into a modular pipeline architecture.

### ✨ New Features

#### 🛡️ Granular RBAC System
- Introduced User Groups & Permissions
- Added full management UI for Users and Groups
- Implemented strict protection for the `SuperAdmin` group (cannot be deleted or modified)
- Added granular permission checks for API endpoints and Dashboard pages

#### 🔐 Enhanced Security & Encryption
- **Recovery Kits**: Added ability to generate and download offline recovery kits for emergency decryption
- **Master Key Reveal**: New secured UI dialog to reveal and export the master key
- **Rate Limiting**: Implemented rate limiting on API and Authentication endpoints to prevent abuse
- **MySQL Security**: Updated adapter to use `MYSQL_PWD` for safer password handling
- **2FA Administration**: Admins can now reset 2FA for users if locked out

#### 🗜️ Compression Support
- Added native support for backup compression (integration into UI and Pipelines)
- Added compression status columns to Jobs and Storage tables

#### 📊 Live Progress Tracking
- Real-time progress updates for backup and restore operations
- Visual feedback for steps, including "indeterminate" progress bars for streams where size is unknown

### ⚡ Architecture & Refactoring
- **Pipeline Pattern**: Refactored the job runner into a modular pipeline pattern with distinct steps
- **Service Layer**: Extracted business logic (Backup, Restore, User Actions) into a dedicated Service Layer for better testability and separation of concerns
- **Job Queue**: Implemented a limit of 10 max concurrent jobs to prevent system overload
- **BigInt Support**: Migrated `Execution.size` to BigInt to support massive backup files
- **Streaming**: Optimized MySQL and Postgres adapters for better streaming performance during dump and restore
- **Testing**: Added Vitest setup and unit tests for Storage Service and Adapters

### 🎨 UI/UX Improvements
- DataTables everywhere: Migrated Jobs, Configs, Logs, and Dashboard lists to a standardized `DataTable` component with faceted filtering and sorting
- Added loading skeletons for smoother page transitions
- Renamed "Users" to "Users & Groups" and improved sidebar organization
- Replaced standard Selects with Command-based Popovers for better UX
- Refactored UI to use standard Tailwind utility classes
- Revamped the "Recovery Kit" card UI in encryption profiles

### 🐛 Bug Fixes
- Fixed downloaded filenames after decryption
- Fixed session error handling and middleware logic
- Fixed clipboard copy error handling
- Resolved various TypeScript type issues throughout the codebase
- Improved Postgres adapter robustness and database selection logic

### 📚 Documentation & Misc
- Added GNU General Public License
- Updated README with new gallery and feature lists
- Added developer documentation for Core Systems and Database Adapters
- Added project coding standards and instruction guidelines
