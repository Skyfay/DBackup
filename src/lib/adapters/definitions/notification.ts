import { z } from "zod";

export const DiscordSchema = z.object({
    webhookUrl: z.string().url("Valid Webhook URL is required"),
    username: z.string().optional().default("Backup Manager"),
    avatarUrl: z.string().url().optional(),
});

export const SlackSchema = z.object({
    webhookUrl: z.string().url("Valid Webhook URL is required"),
    channel: z.string().optional().describe("Override channel (optional)"),
    username: z.string().optional().default("DBackup").describe("Bot display name"),
    iconEmoji: z.string().optional().describe("Bot icon emoji (e.g. :shield:)"),
});

export const TeamsSchema = z.object({
    webhookUrl: z.string().url("Valid Webhook URL is required"),
});

export const GenericWebhookSchema = z.object({
    webhookUrl: z.string().url("Valid URL is required"),
    method: z.enum(["POST", "PUT", "PATCH", "GET", "HEAD"]).default("POST").describe("HTTP method"),
    contentType: z.string().default("application/json").describe("Content-Type header"),
    authHeader: z.string().optional().describe("Authorization header value (e.g. Bearer token)"),
    customHeaders: z.string().optional().describe("Additional headers (one per line, Key: Value)"),
    payloadTemplate: z.string().optional().describe("Custom JSON payload template with {{variable}} placeholders"),
});

export const GotifySchema = z.object({
    serverUrl: z.string().url("Valid Gotify server URL is required"),
    appToken: z.string().min(1, "App Token is required").describe("Application token (from Gotify Apps)"),
    priority: z.coerce.number().min(0).max(10).default(5).describe("Default message priority (0-10)"),
});

export const NtfySchema = z.object({
    serverUrl: z.string().url("Valid ntfy server URL is required").default("https://ntfy.sh"),
    topic: z.string().min(1, "Topic is required").describe("Notification topic name"),
    accessToken: z.string().optional().describe("Access token (required for protected topics)"),
    priority: z.coerce.number().min(1).max(5).default(3).describe("Default message priority (1-5)"),
});

export const TelegramSchema = z.object({
    botToken: z.string().min(1, "Bot Token is required").describe("Telegram Bot API token (from @BotFather)"),
    chatId: z.string().min(1, "Chat ID is required").describe("Chat, group, or channel ID"),
    messageThreadId: z.coerce.number().optional().describe("Topic/Thread ID for Telegram forum groups (leave empty for main chat)"),
    parseMode: z.enum(["HTML", "Markdown"]).default("HTML").describe("Message parse mode"),
    disableNotification: z.boolean().default(false).describe("Send silently (no notification sound)"),
});

export const TwilioSmsSchema = z.object({
    accountSid: z.string().min(1, "Account SID is required").describe("Twilio Account SID"),
    authToken: z.string().min(1, "Auth Token is required").describe("Twilio Auth Token"),
    from: z.string().min(1, "From number is required").describe("Sender phone number (E.164 format, e.g. +1234567890)"),
    to: z.string().min(1, "To number is required").describe("Recipient phone number (E.164 format, e.g. +1234567890)"),
});

export const EmailSchema = z.object({
    host: z.string().min(1, "SMTP Host is required"),
    port: z.coerce.number().default(587),
    secure: z.enum(["none", "ssl", "starttls"]).default("starttls"),
    user: z.string().optional(),
    password: z.string().optional(),
    from: z.string().min(1, "From email is required"),
    to: z.union([
        z.string().email("Valid To email is required"),
        z.array(z.string().email("Valid email required")).min(1, "At least one recipient is required"),
    ]),
});

// Inferred TypeScript Types
export type DiscordConfig = z.infer<typeof DiscordSchema>;
export type SlackConfig = z.infer<typeof SlackSchema>;
export type TeamsConfig = z.infer<typeof TeamsSchema>;
export type GenericWebhookConfig = z.infer<typeof GenericWebhookSchema>;
export type GotifyConfig = z.infer<typeof GotifySchema>;
export type NtfyConfig = z.infer<typeof NtfySchema>;
export type TelegramConfig = z.infer<typeof TelegramSchema>;
export type TwilioSmsConfig = z.infer<typeof TwilioSmsSchema>;
export type EmailConfig = z.infer<typeof EmailSchema>;

export type NotificationConfig = DiscordConfig | SlackConfig | TeamsConfig | GenericWebhookConfig | GotifyConfig | NtfyConfig | TelegramConfig | TwilioSmsConfig | EmailConfig;
