import { NotificationAdapter } from "@/lib/core/interfaces";
import { GotifySchema, GotifyConfig } from "@/lib/adapters/definitions";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { validateOutboundUrl } from "@/lib/url-validation";
import { stripTrailingSlashes } from "@/lib/paths";
import { NO_REDIRECTS, redirectRefusal } from "./http";

const log = logger.child({ adapter: "gotify" });

/**
 * Maps event types and success status to Gotify priority levels.
 *
 * Gotify priorities:
 * - 0   → min (silent / no notification on most clients)
 * - 1-3 → low
 * - 4-7 → normal (default)
 * - 8+  → high (persistent / sound on most clients)
 */
function resolvePriority(defaultPriority: number, context?: { success?: boolean; eventType?: string }): number {
    if (!context) return defaultPriority;

    if (context.eventType === "test") return 1;

    if (context.success === false) return 8;
    if (context.success === true) return defaultPriority;

    return defaultPriority;
}

function buildMarkdownMessage(message: string, context?: any): string {
    if (!context) return message;

    const parts: string[] = [];

    if (context.title) {
        parts.push(`## ${context.title}`);
    }

    parts.push(message);

    if (context.fields?.length) {
        parts.push("");
        for (const field of context.fields) {
            parts.push(`**${field.name}:** ${field.value || "-"}`);
        }
    }

    return parts.join("\n");
}

export const GotifyAdapter: NotificationAdapter = {
    id: "gotify",
    type: "notification",
    name: "Gotify",
    configSchema: GotifySchema,
    credentials: { primary: "TOKEN" },

    async test(config: GotifyConfig): Promise<{ success: boolean; message: string }> {
        try {
            const baseUrl = stripTrailingSlashes(config.serverUrl);
            const url = `${baseUrl}/message`;

            validateOutboundUrl(url);
            const response = await fetch(url, {
                ...NO_REDIRECTS,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Gotify-Key": config.appToken,
                },
                body: JSON.stringify({
                    title: "DBackup Connection Test",
                    message: "This is a test notification to verify your Gotify configuration.",
                    priority: 1,
                    extras: {
                        "client::display": { contentType: "text/markdown" },
                    },
                }),
            });

            const redirect = redirectRefusal("Gotify", response);
            if (redirect) return { success: false, message: redirect };
            if (response.ok) {
                return { success: true, message: "Test notification sent successfully!" };
            } else {
                const body = await response.text().catch(() => "");
                return { success: false, message: `Gotify returned ${response.status}: ${body || response.statusText}` };
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message: message || "Failed to connect to Gotify" };
        }
    },

    async send(config: GotifyConfig, message: string, context?: any): Promise<boolean> {
        try {
            const baseUrl = stripTrailingSlashes(config.serverUrl);
            const url = `${baseUrl}/message`;
            const priority = resolvePriority(config.priority ?? 5, context);
            const formattedMessage = buildMarkdownMessage(message, context);

            validateOutboundUrl(url);
            const response = await fetch(url, {
                ...NO_REDIRECTS,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Gotify-Key": config.appToken,
                },
                body: JSON.stringify({
                    title: context?.title || "DBackup Notification",
                    message: formattedMessage,
                    priority,
                    extras: {
                        "client::display": { contentType: "text/markdown" },
                    },
                }),
            });

            if (!response.ok) {
                const body = await response.text().catch(() => "");
                log.warn("Gotify notification failed", { status: response.status, body });
                return false;
            }

            return true;
        } catch (error) {
            log.error("Gotify notification error", {}, wrapError(error));
            return false;
        }
    },
};
