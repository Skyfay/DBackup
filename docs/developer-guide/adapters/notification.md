# Notification Adapters

Notification adapters send alerts about backup status, system events, and user activity to various channels.

## Architecture Overview

DBackup has **two notification layers** that share the same adapters:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Notification Adapters                            │
│  Discord · Slack · Teams · Telegram · Gotify · ntfy · SMS (Twilio) · Generic Webhook · Email     │
└────────────────────┬──────────────────────────────┬─────────────────────┘
                     │                              │
         ┌───────────┴──────┐            ┌──────────┴──────────┐
         │  Per-Job (Runner)│            │ System Notifications │
         │  04-completion   │            │ notify() service     │
         └──────────────────┘            └─────────────────────┘
```

| Layer | Trigger | Config Location |
| :--- | :--- | :--- |
| Per-Job | Runner pipeline step `04-completion.ts` | Job record (`notificationId`, `notifyCondition`) |
| System | `notify()` in `system-notification-service.ts` | `SystemSetting` (key: `notifications.config`) |

Both layers use `renderTemplate()` from `src/lib/notifications/templates/` to generate adapter-agnostic payloads.

## Available Adapters

| Adapter | ID | File | Description |
| :--- | :--- | :--- | :--- |
| Discord | `discord` | `src/lib/adapters/notification/discord.ts` | Discord webhook with rich embeds |
| Slack | `slack` | `src/lib/adapters/notification/slack.ts` | Slack Incoming Webhook with Block Kit |
| Microsoft Teams | `teams` | `src/lib/adapters/notification/teams.ts` | Teams webhook with Adaptive Cards |
| Gotify | `gotify` | `src/lib/adapters/notification/gotify.ts` | Self-hosted push via REST API |
| ntfy | `ntfy` | `src/lib/adapters/notification/ntfy.ts` | Topic-based push (public or self-hosted) |
| Generic Webhook | `generic-webhook` | `src/lib/adapters/notification/generic-webhook.ts` | Custom JSON payloads to any HTTP endpoint |
| Telegram | `telegram` | `src/lib/adapters/notification/telegram.ts` | Telegram Bot API push notifications |
| SMS (Twilio) | `twilio-sms` | `src/lib/adapters/notification/twilio-sms.ts` | SMS text messages via Twilio API |
| Email | `email` | `src/lib/adapters/notification/email.tsx` | SMTP email with React HTML template |

## Interface

```typescript
interface NotificationAdapter {
  id: string;
  type: "notification";
  name: string;
  configSchema: ZodSchema;  // Zod schema - UI form is auto-generated from this

  send(
    config: unknown,
    message: string,
    context?: NotificationContext
  ): Promise<boolean>;

  test?(config: unknown): Promise<TestResult>;
}
```

::: info No `inputs` array needed
Unlike what some older docs may show, notification adapters do **not** define an `inputs` array. The form fields in the UI are auto-generated from the Zod `configSchema`. Field labels come from the Zod key names, placeholders from `PLACEHOLDERS` in `form-constants.ts`, and descriptions from `.describe()` on the Zod field.
:::

The `NotificationContext` passed to `send()`:

```typescript
interface NotificationContext {
  success?: boolean;
  eventType?: string;      // e.g. "user_login", "backup_success"
  title?: string;          // Payload title for embeds/subjects
  fields?: Array<{         // Structured data for rich display
    name: string;
    value: string;
    inline?: boolean;
  }>;
  color?: string;          // Hex color for status indicators
}
```

## Discord Adapter

Sends rich embeds to Discord webhooks. The adapter builds embed objects from the `NotificationContext` fields:

```typescript
// Simplified core logic
async send(config, message, context) {
  const validated = DiscordSchema.parse(config);

  const embed: Record<string, unknown> = {
    title: context?.title ?? "Notification",
    description: message,
    color: parseInt((context?.color ?? "#6b7280").replace("#", ""), 16),
    timestamp: new Date().toISOString(),
  };

  if (context?.fields?.length) {
    embed.fields = context.fields.map((f) => ({
      name: f.name,
      value: f.value || "-",
      inline: f.inline ?? false,
    }));
  }

  await fetch(validated.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: validated.username,
      avatar_url: validated.avatarUrl || undefined,
      embeds: [embed],
    }),
  });
}
```

### Discord Schema

```typescript
const DiscordSchema = z.object({
  webhookUrl: z.string().url("Valid Webhook URL is required"),
  username: z.string().optional().default("Backup Manager"),
  avatarUrl: z.string().url().optional(),
});
```

## Email Adapter

Sends HTML emails via SMTP using `nodemailer`. The adapter hands the whole payload to `renderNotificationEmail()`, which returns the subject, the HTML and a plain text part:

```typescript
// Simplified core logic
async send(config, message, context) {
  const transporter = nodemailer.createTransport({ /* ... */ });
  const brand = context?.brand ?? await loadNotificationBrand();
  const mail = await renderNotificationEmail({ ...context, message }, brand);

  await transporter.sendMail({
    from: senderWithName(config.from, brand), // "DBackup · <Name>" for a bare address
    to: config.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
}
```

`test()` sends `smtpTestTemplate()` through the same renderer, so the test mail looks like every notification.

### Email Schema

```typescript
const EmailSchema = z.object({
  host: z.string().min(1, "SMTP Host is required"),
  port: z.coerce.number().default(587),
  secure: z.enum(["none", "ssl", "starttls"]).default("starttls"),
  user: z.string().optional(),
  password: z.string().optional(),
  from: z.string().min(1, "From email is required"),
  to: z.string().email("Valid To email is required"),
});
```

### Email Template

The mail lives in `src/components/email/`:

| File | What it holds |
| :--- | :--- |
| `render-email.tsx` | `renderNotificationEmail(payload, brand)`, the document with the preheader, the dark mode sheet and the plain text part |
| `notification-email.tsx` | The layout: the brand line, the banner, the card and the buttons |
| `email-parts.tsx` | The banner, the tiles, the problem, the destinations, the details and the buttons |
| `email-theme.ts` | The tokens of `globals.css` as hex, light inline and dark as classes for `prefers-color-scheme` |
| `email-icons.ts` | Every picture a mail shows, by its lucide icon or adapter logo |

The mail is tables and inline styles only, since mail clients drop most of CSS. Light colors sit inline on every element, the dark ones come from classes like `m-card` in a `prefers-color-scheme` sheet, and every picture has a dark twin the sheet swaps in.

A mail client draws no SVG and cannot load anything from an instance on a private network, so the icons are PNGs on the docs site under `docs/public/email/`. `pnpm email:icons` draws them from the lists in `email-icons.ts` with the lucide icons and adapter logos of the app. A new banner icon, button icon or destination adapter needs an entry there and one run of the script. `email-template.test.tsx` fails while one is missing.

The buttons link to the address in `BETTER_AUTH_URL`. `loadNotificationBrand()` in `src/lib/notifications/brand.ts` reads it with the name and the time zone of the instance, once per notification.

## Slack Adapter

Sends Block Kit formatted messages to Slack Incoming Webhooks. Uses `attachments` with a color bar for status indication and structured `blocks` for content:

- **Header block** - Notification title
- **Section block** - Message body (Markdown)
- **Fields section** - Structured key-value pairs from `context.fields`
- **Context block** - Timestamp
- Optional channel, username, and icon emoji overrides

### Slack Schema

```typescript
const SlackSchema = z.object({
  webhookUrl: z.string().url("Valid Webhook URL is required"),
  channel: z.string().optional().describe("Override channel (optional)"),
  username: z.string().optional().default("DBackup").describe("Bot display name"),
  iconEmoji: z.string().optional().describe("Bot icon emoji (e.g. :shield:)"),
});
```

## Microsoft Teams Adapter

Sends Adaptive Cards v1.4 to Microsoft Teams via Power Automate Workflows webhooks. The payload follows the Teams message wrapper format with an `attachments` array containing the card:

- **TextBlock** - Title and message body
- **FactSet** - Structured key-value fields
- Color mapping: hex → named Adaptive Card colors (`Good`, `Attention`, `Warning`, `Accent`, `Default`)

### Teams Schema

```typescript
const TeamsSchema = z.object({
  webhookUrl: z.string().url("Valid Webhook URL is required"),
});
```

## Gotify Adapter

Sends push notifications to self-hosted Gotify servers via REST API. Messages are formatted as Markdown with `client::display` extras:

- **Priority levels** 0–10 with automatic escalation (failures → 8, tests → 1)
- Authentication via `X-Gotify-Key` header with Application Token
- Markdown rendering with structured fields

### Gotify Schema

```typescript
const GotifySchema = z.object({
  serverUrl: z.string().url("Valid Gotify server URL is required"),
  appToken: z.string().min(1, "App Token is required").describe("Application token (from Gotify Apps)"),
  priority: z.coerce.number().min(0).max(10).default(5).describe("Default message priority (0-10)"),
});
```

## ntfy Adapter

Sends topic-based push notifications via ntfy (self-hosted or public `ntfy.sh`). Uses HTTP headers for metadata instead of JSON body:

- **Priority levels** 1–5 with automatic escalation (failures → 5, tests → 2)
- Emoji tags based on event status (✅ success, ❌ failure)
- Markdown support via `Markdown: yes` header
- Optional Bearer token authentication for protected topics

### ntfy Schema

```typescript
const NtfySchema = z.object({
  serverUrl: z.string().url("Valid ntfy server URL is required").default("https://ntfy.sh"),
  topic: z.string().min(1, "Topic is required").describe("Notification topic name"),
  accessToken: z.string().optional().describe("Access token (required for protected topics)"),
  priority: z.coerce.number().min(1).max(5).default(3).describe("Default message priority (1-5)"),
});
```

## Generic Webhook Adapter

Sends JSON payloads to any HTTP endpoint with customizable templates. The most flexible adapter - used for services without a dedicated adapter:

- Configurable HTTP method (POST, PUT, PATCH)
- `{{variable}}` placeholder system for custom payload templates
- Available variables: `title`, `message`, `success`, `color`, `timestamp`, `eventType`, `fields`
- Custom headers and Authorization header support

### Generic Webhook Schema

```typescript
const GenericWebhookSchema = z.object({
  webhookUrl: z.string().url("Valid URL is required"),
  method: z.enum(["POST", "PUT", "PATCH"]).default("POST").describe("HTTP method"),
  contentType: z.string().default("application/json").describe("Content-Type header"),
  authHeader: z.string().optional().describe("Authorization header value (e.g. Bearer token)"),
  customHeaders: z.string().optional().describe("Additional headers (one per line, Key: Value)"),
  payloadTemplate: z.string().optional().describe("Custom JSON payload template with {{variable}} placeholders"),
});
```

---

## Telegram Adapter

Sends push notifications to Telegram chats, groups, and channels via the Telegram Bot API. Messages are formatted as HTML:

- Status emoji (✅ success, ❌ failure) prepended automatically
- HTML formatting with `<b>` tags for structured fields
- HTML entity escaping for safe message content
- Configurable parse mode (HTML, MarkdownV2, Markdown)
- Silent delivery mode (no notification sound)

### Telegram Schema

```typescript
const TelegramSchema = z.object({
  botToken: z.string().min(1, "Bot Token is required").describe("Telegram Bot API token (from @BotFather)"),
  chatId: z.string().min(1, "Chat ID is required").describe("Chat, group, or channel ID"),
  parseMode: z.enum(["MarkdownV2", "HTML", "Markdown"]).default("HTML").describe("Message parse mode"),
  disableNotification: z.boolean().default(false).describe("Send silently (no notification sound)"),
});
```

## SMS (Twilio) Adapter

Sends SMS text messages via the Twilio REST API. Optimized for concise message delivery within SMS segment limits:

- Basic auth via Account SID and Auth Token
- URL-encoded form body (Twilio API convention)
- Status emoji (✅/❌) and title for quick scanning
- Field count limited to 4 to keep messages short
- Accepts both `200` and `201` as success responses

### Twilio SMS Schema

```typescript
const TwilioSmsSchema = z.object({
  accountSid: z.string().min(1, "Account SID is required").describe("Twilio Account SID"),
  authToken: z.string().min(1, "Auth Token is required").describe("Twilio Auth Token"),
  from: z.string().min(1, "From number is required").describe("Sender phone number (E.164 format)"),
  to: z.string().min(1, "To number is required").describe("Recipient phone number (E.164 format)"),
});
```

---

## System Notification Framework

The system notification framework handles events beyond individual backup jobs.

### File Structure

```
src/lib/notifications/
├── types.ts        # Type definitions, event constants, config shape
├── events.ts       # Event registry with metadata
├── templates.ts    # Template functions → adapter-agnostic payloads
└── index.ts        # Barrel exports

src/services/notifications/
├── system-notification-service.ts   # Core dispatch service
├── notification-settings-service.ts # Events, default channels and Send a test of the Settings page
└── notification-test-data.ts        # Example data of every event for Send a test

src/app/actions/settings/
└── notification-settings.ts         # Server actions for the Notifications part

src/components/dashboard/settings/
├── notifications-part.tsx           # The list of events with its bulk actions
├── notification-dialog.tsx          # Edit of one event
└── notification-bulk.tsx            # Send to of several events, the default channels
```

### Event Types

Defined in `src/lib/notifications/types.ts`:

```typescript
export const NOTIFICATION_EVENTS = {
  USER_LOGIN: "user_login",
  USER_CREATED: "user_created",
  BACKUP_SUCCESS: "backup_success",    // Used by runner only
  BACKUP_FAILURE: "backup_failure",    // Used by runner only
  RESTORE_COMPLETE: "restore_complete",
  RESTORE_FAILURE: "restore_failure",
  CONFIG_BACKUP: "config_backup",
  SYSTEM_ERROR: "system_error",
} as const;
```

::: info Backup events
`BACKUP_SUCCESS` and `BACKUP_FAILURE` have templates but are **not** registered in the system event list (`events.ts`). They are only used by the runner pipeline for per-job notifications, avoiding duplicate notifications.
:::

### Event Definitions

Each event is registered in `src/lib/notifications/events.ts` with metadata:

```typescript
interface NotificationEventDefinition {
  id: NotificationEventType;
  name: string;
  description: string;
  category: "auth" | "backup" | "restore" | "system";
  defaultEnabled: boolean;
  supportsNotifyUser?: boolean;  // Can send direct email to affected user
}
```

Currently registered system events:

| Event | Category | Default | Supports Notify User |
| :--- | :--- | :--- | :--- |
| `user_login` | auth | Disabled | ✅ |
| `user_created` | auth | Disabled | ✅ |
| `restore_complete` | restore | Enabled | ❌ |
| `restore_failure` | restore | Enabled | ❌ |
| `config_backup` | system | Disabled | ❌ |
| `system_error` | system | Enabled | ❌ |

### Template System

Templates in `src/lib/notifications/templates/` (one file per area: `backup.ts`, `restore.ts`, `storage.ts`, `system.ts`, `people.ts`) convert typed event data into adapter-agnostic `NotificationPayload` objects:

```typescript
interface NotificationPayload {
  title: string;           // Email subject, embed title. The thing first: "mysql-shop failed"
  message: string;         // One sentence under the title
  fields?: Array<{         // Structured data for the chat channels
    name: string;
    value: string;
    inline?: boolean;
  }>;
  color?: string;          // Hex color
  success: boolean;        // Success/failure flag

  // What a mail shows beyond the fields. Chat channels leave these out.
  tone?: "success" | "failure" | "warning" | "neutral";
  icon?: NotificationIcon;                        // Banner icon, a lucide name
  stats?: Array<{ label: string; value: string }>; // Up to four tiles
  problem?: { title: string; help?: string; raw: string; where?: string };
  destinations?: NotificationDestination[];        // One row per destination of a run
  usage?: { percent: number; label: string; aside: string };
  details?: Array<{ name: string; value: string }>; // The facts under the tiles
  note?: string;
  actions?: Array<{ label: string; href: string; icon: NotificationIcon }>; // App paths or full URLs
  preheader?: string;      // The line a mail client shows after the subject
  reason?: string;         // Set by the sender: why the reader gets it
  timestamp?: string;
}
```

The `renderTemplate(event, options)` dispatcher calls the matching function based on `event.eventType`. `options.timeZone` is the time zone of the instance, which every time in the text uses, and `options.audience: "user"` gives the words meant for the person a sign-in or a new account is about. A problem in plain words comes from `describeProblem()` in `src/services/history/known-problems.ts`, the same words the page of a run uses. The reason at the foot of a mail comes from `src/services/notifications/notification-reason.ts`.

### Configuration Storage

System notification config is stored as JSON in the `SystemSetting` table under key `notifications.config`:

```typescript
interface SystemNotificationConfig {
  globalChannels: string[];     // Default AdapterConfig IDs
  events: Record<string, {
    enabled: boolean;
    channels: string[] | null;  // null = use globalChannels, never an empty list
    notifyUser?: NotifyUserMode; // "none" | "also" | "only"
    reminderIntervalHours?: number | null; // null = defaultReminderHours of the event, 0 = off
  }>;
}
```

### Dispatch Flow (`notify()`)

The `notify()` function in `system-notification-service.ts` handles the full dispatch:

```
notify(event)
    │
    ├── Load config from SystemSetting
    ├── Check if event is enabled (config or default)
    ├── Resolve channels (event-level override or global)
    ├── renderTemplate(event) → NotificationPayload
    ├── registerAdapters() (ensure adapters are loaded)
    │
    ├── If notifyUser ≠ "only":
    │   └── For each admin channel:
    │       ├── Generate adapter-specific payload (embed, blocks, HTML)
    │       ├── adapter.send(config, message, options)
    │       └── recordNotificationLog(entry) ← success or error
    │
    └── If notifyUser = "also" or "only":
        ├── Filter channels to email-type adapters only
        ├── Extract user email from event data
        ├── Send via email adapter with overridden `to` field
        └── recordNotificationLog(entry)
```

Key design decisions:
- **Fire-and-forget**: `notify()` catches all errors and never throws. Callers are not blocked by notification failures.
- **User-targeted delivery**: For auth events (`user_login`, `user_created`), the service can send a direct email to the affected user by overriding the `to` field in the email adapter config.
- **Email-only for user notifications**: Only adapters matching `EMAIL_ADAPTER_IDS` (`["email"]`) support per-user delivery. Discord and other channels are excluded.

### Integration Points

System notifications are fired from:

| Location | Event |
| :--- | :--- |
| `src/lib/auth.ts` (`databaseHooks.session.create.after`) | `USER_LOGIN` |
| `src/app/actions/user.ts` (`createUser`) | `USER_CREATED` |
| `src/services/restore-service.ts` | `RESTORE_COMPLETE`, `RESTORE_FAILURE` |
| `src/lib/runner/config-runner.ts` | `CONFIG_BACKUP` |

Example integration:

```typescript
// src/lib/auth.ts – Login notification
databaseHooks: {
  session: {
    create: {
      after: async (session) => {
        const user = await prisma.user.findUnique({ ... });
        notify({
          eventType: NOTIFICATION_EVENTS.USER_LOGIN,
          data: {
            userName: user.name,
            email: user.email,
            timestamp: new Date().toISOString(),
          },
        });
      },
    },
  },
}
```

### Server Actions

The Settings page reads the events through `getNotificationsModel()` in `notification-settings-service.ts`, as part of the page model. `src/app/actions/settings/notification-settings.ts` provides:

| Action | Permission | Description |
| :--- | :--- | :--- |
| `saveNotificationEventsAction(eventIds, patch)` | `SETTINGS.WRITE` | Saves `enabled`, `channels`, `notifyUser` or `reminderHours` of one or several events, with an audit entry |
| `saveDefaultChannelsAction(ids)` | `SETTINGS.WRITE` | Saves the default channels |
| `sendTestNotificationAction(eventId)` | `SETTINGS.WRITE` | Sends the example data of `notification-test-data.ts` to the channels of the event |

The service refuses an unknown event, own channels that are empty or no longer exist, and a reminder outside `0` to `MAX_REMINDER_HOURS`. A test goes out while the event is off through `notify(event, { test: true })`, and a test that reached no channel and no user is an error, never a success.

### UI Component

`notifications-part.tsx` renders the Notifications part of Settings:

1. **Default channels** - a strip on top with the logos of the default channels and **Change**
2. **Event list** - a `DataTable` with where each event goes, its reminder and a switch, plus a filter for On, Off, Own channels and Nowhere
3. **Edit dialog** - `notification-dialog.tsx` with Report it, Send it to, Tell the user too (only for `supportsNotifyUser` events), Remind while it lasts (only for `supportsReminder` events) and Send a test
4. **Bulk actions** - Send to, Switch on and Switch off for the ticked events, one save for all of them

A switch or a saved dialog persists at once, the part has no save bar.

---

## Per-Job Notification Flow

Per-job notifications are sent from the runner pipeline step `04-completion.ts`:

```
RunnerContext (job, execution, metadata)
    │
    ├── Job has notificationId? → Load AdapterConfig
    ├── Check notifyCondition (always / success / failure)
    ├── renderTemplate(BACKUP_SUCCESS or BACKUP_FAILURE)
    ├── For each notification channel:
    │   ├── Generate adapter-specific rendered payload
    │   ├── adapter.send(config, payload.message, { title, fields, color })
    │   └── recordNotificationLog(entry) ← success or error
    └── Log result
```

This uses the same `renderTemplate()` and `NotificationPayload` system as system notifications, ensuring consistent message formatting across both layers. Each send attempt is logged to `NotificationLog` with the full rendered payload for preview on the History page.

---

## Creating a New Notification Adapter

Adding a new notification adapter requires changes across **multiple files** - the adapter code itself, schema definitions, UI constants, icon mapping, registry, and documentation. This section provides the complete step-by-step guide.

### Quick Reference Checklist

Every new notification adapter touches these files:

| # | File | What to do |
| :--- | :--- | :--- |
| 1 | `src/lib/adapters/definitions.ts` | Add Zod schema, inferred type, union type, `ADAPTER_DEFINITIONS` entry |
| 2 | `src/lib/adapters/notification/<id>.ts` | Create the adapter implementation |
| 3 | `src/lib/adapters/index.ts` | Import and register the adapter |
| 4 | `src/components/adapter/utils.ts` | Import icon and add to `ADAPTER_ICON_MAP` |
| 5 | `src/components/adapter/form-constants.ts` | Add keys to `NOTIFICATION_CONNECTION_KEYS`, `NOTIFICATION_CONFIG_KEYS`, and `PLACEHOLDERS` |
| 6 | `src/lib/adapters/connection-summary.ts` | Add `case` to `connectionAddress()` for the Sends to column |
| 7 | `src/components/adapter/schema-field.tsx` | Update `isTextArea` check (only if adapter has multi-line fields) |
| 8 | `src/app/dashboard/history/notification-preview.tsx` | Add adapter-specific preview component and register in `PREVIEW_COMPONENTS` map (optional) |
| 9 | `docs/user-guide/notifications/<id>.md` | Create docs page with setup guide |
| 10 | `docs/.vitepress/config.mts` | Add sidebar entry under "Notification Channels" |
| 11 | `docs/user-guide/notifications/index.md` | Add to supported channels table and "Choosing a Channel" section |
| 12 | `docs/user-guide/features/notifications.md` | Add to channels table and best practices |
| 13 | `README.md` | Update notification feature line and channels table |
| 14 | `docs/index.md` | Update feature card and supported notifications table |
| 15 | `docs/changelog.md` | Add changelog entry |
| 16 | `docs/developer-guide/adapters/notification.md` | Update "Available Adapters" table (this file) |
| 17 | `tests/unit/adapters/notification/<id>.test.ts` | Write unit tests for `test()` and `send()` |

### Step 1 - Define the Zod Schema

Add the schema, inferred type, and definition entry in `src/lib/adapters/definitions.ts`:

```typescript
// 1a. Schema - near the other notification schemas
export const MyServiceSchema = z.object({
  serverUrl: z.string().url("Valid URL is required"),
  apiToken: z.string().min(1, "API Token is required").describe("Your API token"),
  priority: z.coerce.number().min(1).max(10).default(5).describe("Default priority (1-10)"),
});

// 1b. Inferred type - in the "Notification Adapters" types section
export type MyServiceConfig = z.infer<typeof MyServiceSchema>;

// 1c. Union type - add to NotificationConfig
export type NotificationConfig = DiscordConfig | SlackConfig | /* ... */ | MyServiceConfig | EmailConfig;

// 1d. Definition entry - in the ADAPTER_DEFINITIONS array
{ id: "my-service", type: "notification", name: "My Service", configSchema: MyServiceSchema },
```

::: tip Schema conventions
- Use `.describe("...")` on optional/non-obvious fields - this text appears as a tooltip in the UI
- Use `.default(value)` for sensible defaults - they auto-fill in the form
- Use `.coerce.number()` for numeric fields to handle string input from forms
- Use `.url()` for URL fields to get built-in validation
:::

### Step 2 - Implement the Adapter

Create `src/lib/adapters/notification/<id>.ts`:

```typescript
import { NotificationAdapter } from "@/lib/core/interfaces";
import { MyServiceSchema, MyServiceConfig } from "@/lib/adapters/definitions";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ adapter: "my-service" });

export const MyServiceAdapter: NotificationAdapter = {
  id: "my-service",
  type: "notification",
  name: "My Service",
  configSchema: MyServiceSchema,

  async test(config: MyServiceConfig): Promise<{ success: boolean; message: string }> {
    try {
      // Send a lightweight test message
      const response = await fetch(`${config.serverUrl}/message`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${config.apiToken}` },
        body: JSON.stringify({ text: "DBackup Connection Test" }),
      });

      if (response.ok) {
        return { success: true, message: "Test notification sent successfully!" };
      }
      const body = await response.text().catch(() => "");
      return { success: false, message: `Returned ${response.status}: ${body || response.statusText}` };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: message || "Failed to connect" };
    }
  },

  async send(config: MyServiceConfig, message: string, context?: any): Promise<boolean> {
    try {
      // Build the payload using context for rich formatting
      const title = context?.title || "DBackup Notification";

      // Use context.fields for structured data
      let body = message;
      if (context?.fields?.length) {
        body += "\n" + context.fields
          .map((f: { name: string; value: string }) => `${f.name}: ${f.value || "-"}`)
          .join("\n");
      }

      const response = await fetch(`${config.serverUrl}/message`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${config.apiToken}` },
        body: JSON.stringify({ title, text: body }),
      });

      if (!response.ok) {
        log.warn("Notification failed", { status: response.status });
        return false;
      }
      return true;
    } catch (error) {
      log.error("Notification error", {}, wrapError(error));
      return false;
    }
  },
};
```

**Key patterns to follow:**
- Always use `logger.child()` - never `console.log`
- Always use `wrapError()` in catch blocks
- `test()` returns `{ success, message }` - never throws
- `send()` returns `boolean` - `true` on success, `false` on failure (never throws)
- Handle `context` being `undefined` (plain text fallback)
- Use `context.color` for status colors (`#00ff00` success, `#ff0000` failure)
- Use `context.fields` for structured key-value data
- Use `context.title` for the notification title
- Use `context.success` to determine success/failure state

### Step 3 - Register the Adapter

In `src/lib/adapters/index.ts`:

```typescript
import { MyServiceAdapter } from "./notification/my-service";

export function registerAdapters() {
  // ... existing registrations
  registry.register(MyServiceAdapter);
}
```

Place the import and registration near the other notification adapters to keep the file organized.

### Step 4 - Add an Icon

In `src/components/adapter/utils.ts`, import an Iconify icon and map it:

```typescript
// Import - choose from available icon packages:
// @iconify-icons/logos       → Multi-colored brand SVGs (preferred for well-known brands)
// @iconify-icons/simple-icons → Monochrome brand icons (add color via ADAPTER_COLOR_MAP)
// @iconify-icons/mdi          → Material Design Icons (generic/protocol icons)
import myServiceIcon from "@iconify-icons/mdi/bell-ring";

// Add to ADAPTER_ICON_MAP
const ADAPTER_ICON_MAP: Record<string, IconifyIcon> = {
  // ... existing entries
  "my-service": myServiceIcon,
};
```

::: tip Checking icon availability
Verify an icon exists before importing:
```bash
node -e "try { require('@iconify-icons/simple-icons/myservice'); console.log('OK') } catch { console.log('MISSING') }"
```
If the brand icon doesn't exist, use a generic MDI icon (e.g., `mdi/bell-ring`, `mdi/message-text`, `mdi/webhook`).
:::

If using a `simple-icons` monochrome icon, also add the brand color:

```typescript
const ADAPTER_COLOR_MAP: Record<string, string> = {
  // ... existing entries
  "my-service": "#FF6600",
};
```

### Step 5 - Configure Form Constants

In `src/components/adapter/form-constants.ts`, sort your schema fields into the two parts of the connection form, **Connection** and **Message**, and add placeholders:

```typescript
// Connection part - fields needed to reach the service
export const NOTIFICATION_CONNECTION_KEYS = [
  // ... existing keys
  'serverUrl', 'apiToken',  // Add your new keys here
];

// Message part - how the message looks and who gets it
export const NOTIFICATION_CONFIG_KEYS = [
  // ... existing keys
  'priority',  // Add your new keys here
];

// Placeholder hints shown in empty form fields
export const PLACEHOLDERS: Record<string, string> = {
  // ... existing entries
  "my-service.serverUrl": "https://my-service.example.com",
  "my-service.apiToken": "your-api-token-here",
  "my-service.priority": "5",
};
```

**Which part?** Connection keys go to the **Connection** part, config keys to the **Message** part. Rule of thumb: if the field is needed to reach the service, it's a connection key. If it shapes the message or picks its recipients, it's a config key. A key neither list names still appears, in the Message part, and a channel without config keys has no Message part and no list of parts at all.

Fields a credential profile fills in, like the webhook URL or the token, are hidden by `credentialManagedKeys()` in `connection-form-schema.ts`, so they need no entry here.

If your adapter has **multi-line text fields** (like `payloadTemplate` or `customHeaders`), also update the `isTextArea` check in `src/components/adapter/schema-field.tsx`:

```typescript
const isTextArea = /* existing checks */ || fieldKey === "myMultiLineField";
```

### Step 6 - Add the Sends to Summary

In `src/lib/adapters/connection-summary.ts`, add a `case` to the `connectionAddress()` switch so the **Sends to** column of the Notifications table shows meaningful info instead of `-`:

```typescript
switch (adapterId) {
    // ... existing cases
    case "my-service":
        return text(config.serverUrl) || null;
}
```

Return a plain string. The table styles it, and `null` shows a dash.

**What to show:** Pick the most identifying field(s) from the config - URL, topic, phone number, channel name, etc. Keep it short and scannable. Examples from existing adapters:

| Adapter | Sends to output |
| :--- | :--- |
| Discord / Slack / Teams | `Webhook` |
| Generic Webhook | `POST webhook`, the URL is a secret and never reaches the browser |
| Gotify | `https://gotify.example.com` |
| ntfy | `https://ntfy.sh/my-topic` |
| Telegram | `Chat 123456789` |
| Twilio SMS | `+1234... → +5678...` |
| Email | `from@... → to@...` |

### Step 7 - Documentation

Create the following documentation:

**a) Docs page** - `docs/user-guide/notifications/<id>.md`

Follow the structure of existing adapter pages:
- Overview (bullet points with key features)
- Configuration table (fields, defaults, required)
- Setup Guide (step-by-step with screenshots/tips)
- Message Format (example output)
- Troubleshooting (common error messages)

### Step 8 - Unit Tests

Create `tests/unit/adapters/notification/<id>.test.ts` following the existing pattern:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MyServiceAdapter } from "@/lib/adapters/notification/my-service";
import { MyServiceConfig } from "@/lib/adapters/definitions";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const baseConfig: MyServiceConfig = {
  serverUrl: "https://my-service.example.com",
  apiToken: "test-token",
  priority: 5,
};

describe("My Service Adapter", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  describe("test()", () => {
    it("should return success on 200", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
      const result = await MyServiceAdapter.test(baseConfig);
      expect(result.success).toBe(true);
    });

    it("should return failure on HTTP error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false, status: 401,
        text: async () => "Unauthorized",
        statusText: "Unauthorized",
      });
      const result = await MyServiceAdapter.test(baseConfig);
      expect(result.success).toBe(false);
    });

    it("should return failure on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      const result = await MyServiceAdapter.test(baseConfig);
      expect(result.success).toBe(false);
    });
  });

  describe("send()", () => {
    it("should return true on success", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
      const result = await MyServiceAdapter.send(baseConfig, "Backup completed");
      expect(result).toBe(true);
    });

    it("should verify payload structure", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
      await MyServiceAdapter.send(baseConfig, "Test", {
        title: "Backup Success",
        fields: [{ name: "Database", value: "mydb" }],
        color: "#00ff00",
      });
      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      // Assert body structure matches expected format
      expect(body.title).toBe("Backup Success");
    });

    it("should return false on HTTP error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "error" });
      const result = await MyServiceAdapter.send(baseConfig, "Test");
      expect(result).toBe(false);
    });

    it("should return false on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Timeout"));
      const result = await MyServiceAdapter.send(baseConfig, "Test");
      expect(result).toBe(false);
    });
  });
});
```

**What to test:**
- `test()` - success, HTTP error, network error
- `send()` - success, payload structure with context, HTTP error, network error
- Adapter-specific features (e.g., priority escalation, color mapping, auth headers, template rendering)
- Edge cases (trailing slashes in URLs, optional fields omitted, etc.)

::: tip Run notification tests
```bash
pnpm test -- tests/unit/adapters/notification/
```
:::

**b) VitePress sidebar** - `docs/.vitepress/config.mts`

Add the entry under the "Notification Channels" section:

```typescript
{
  text: 'Notification Channels',
  items: [
    // ... existing entries
    { text: 'My Service', link: '/user-guide/notifications/my-service' },
  ]
}
```

**c) Update existing pages:**

| File | Section to update |
| :--- | :--- |
| `docs/user-guide/notifications/index.md` | Supported Channels table, "Choosing a Channel" section, "Next Steps" links |
| `docs/user-guide/features/notifications.md` | Supported Channels table, Best Practices |
| `README.md` | Feature bullet point, Supported Notifications table |
| `docs/index.md` | Feature card description, Supported Notifications table |
| `docs/changelog.md` | Release entry |
| `docs/developer-guide/adapters/notification.md` | Available Adapters table (this file) |

### Summary: File Touch Map

```
src/lib/adapters/
├── definitions.ts          ← Schema + type + union + ADAPTER_DEFINITIONS
├── index.ts                ← Import + registry.register()
├── connection-summary.ts   ← connectionAddress() case for the Sends to column
└── notification/
    └── <id>.ts             ← NEW: Adapter implementation

src/components/adapter/
├── utils.ts                ← Icon import + ADAPTER_ICON_MAP (+ ADAPTER_COLOR_MAP)
├── form-constants.ts       ← CONNECTION_KEYS + CONFIG_KEYS + PLACEHOLDERS
└── schema-field.tsx        ← isTextArea check (only if multi-line fields)

docs/
├── user-guide/
│   ├── notifications/
│   │   ├── <id>.md         ← NEW: User-facing setup guide
│   │   └── index.md        ← Update table + choosing section
│   └── features/
│       └── notifications.md ← Update table + best practices
├── .vitepress/config.mts   ← Sidebar entry
├── changelog.md            ← Release notes
├── index.md                ← Feature card + table
└── developer-guide/
    └── adapters/
        └── notification.md ← Available Adapters table (this file)

README.md                   ← Feature line + channels table

tests/unit/adapters/notification/
└── <id>.test.ts            ← NEW: Unit tests for test() and send()
```

::: tip User-targeted delivery
If your new adapter should support per-user delivery (like Email does), add its `id` to the `EMAIL_ADAPTER_IDS` array in `system-notification-service.ts`. The adapter's config must have a `to` field that can be overridden.
:::

---

## Adding a New System Event

### 1. Add the Event Constant

```typescript
// src/lib/notifications/types.ts
export const NOTIFICATION_EVENTS = {
  // ... existing events
  MY_NEW_EVENT: "my_new_event",
} as const;
```

### 2. Define the Data Interface

```typescript
// src/lib/notifications/types.ts
export interface MyNewEventData {
  someField: string;
  timestamp: string;
}
```

Add it to the `NotificationEventData` union:

```typescript
export type NotificationEventData =
  // ... existing entries
  | { eventType: typeof NOTIFICATION_EVENTS.MY_NEW_EVENT; data: MyNewEventData };
```

### 3. Register the Event

```typescript
// src/lib/notifications/events.ts
{
  id: NOTIFICATION_EVENTS.MY_NEW_EVENT,
  name: "My New Event",
  description: "Description for the settings UI.",
  category: "system",
  defaultEnabled: false,
  // supportsNotifyUser: true  // Only if event carries a user email
  // supportsReminder: true, defaultReminderHours: 24  // Only if the event lasts and repeats
},
```

The name is a short sentence of what happened, like "A connection is offline", which the Settings list and the search show. Add example data for **Send a test** to `buildTestData()` in `src/services/notifications/notification-test-data.ts`.

### 4. Create the Template

```typescript
// src/lib/notifications/templates/system.ts
export function myNewEventTemplate(data: MyNewEventData, options?: TemplateOptions): NotificationPayload {
  const f = formatterFor(options);
  return {
    title: `${data.someField} changed`,
    message: "One sentence that says what happened.",
    fields: [
      { name: "Field", value: data.someField, inline: true },
      { name: "Time", value: f.date(data.timestamp) ?? data.timestamp, inline: true },
    ],
    color: "#3b82f6",
    success: true,
    tone: "neutral",
    icon: "circle-arrow-up",
    stats: [{ label: "Field", value: data.someField }],
    actions: action("Open settings", "/dashboard/settings", "settings"),
    timestamp: data.timestamp,
  };
}
```

Add the case to `renderTemplate()` in `templates/index.ts`:

```typescript
case NOTIFICATION_EVENTS.MY_NEW_EVENT:
  return myNewEventTemplate(event.data, options);
```

A pair of `icon` and `tone` the mail has no picture for yet goes into `BANNER_ICONS` in `src/components/email/email-icons.ts`, followed by `pnpm email:icons`.

### 5. Fire the Event

```typescript
import { notify } from "@/services/notifications/system-notification-service";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/types";

notify({
  eventType: NOTIFICATION_EVENTS.MY_NEW_EVENT,
  data: {
    someField: "value",
    timestamp: new Date().toISOString(),
  },
});
```

The event appears in the Notifications part of Settings with its category, description, default state and default reminder.

## Related Documentation

- [Adapter System](/developer-guide/core/adapters) – How adapters are registered
- [Database Adapters](/developer-guide/adapters/database) – Database dump/restore adapters
- [Storage Adapters](/developer-guide/adapters/storage) – File upload/download adapters
- [Runner Pipeline](/developer-guide/core/runner) – Backup execution steps
- [Service Layer](/developer-guide/core/services) – Business logic architecture
