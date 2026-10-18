import { NotificationAdapter } from "@/lib/core/interfaces";
import { NtfySchema, NtfyConfig } from "@/lib/adapters/definitions";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { validateOutboundUrl } from "@/lib/url-validation";
import { stripTrailingSlashes } from "@/lib/paths";
import { NO_REDIRECTS, redirectRefusal } from "./http";

const log = logger.child({ adapter: "ntfy" });

/**
 * Maps event types and success status to ntfy priority levels.
 *
 * ntfy priorities:
 * 1 → min
 * 2 → low
 * 3 → default
 * 4 → high
 * 5 → max / urgent
 */
function resolvePriority(defaultPriority: number, context?: { success?: boolean; eventType?: string }): number {
    if (!context) return defaultPriority;

    if (context.eventType === "test") return 2;

    if (context.success === false) return 5;
    if (context.success === true) return defaultPriority;

    return defaultPriority;
}

function mapTagsFromContext(context?: any): string[] {
    if (!context) return ["backup"];

    const tags: string[] = [];

    if (context.success === true) tags.push("white_check_mark", "backup");
    else if (context.success === false) tags.push("x", "warning", "backup");
    else tags.push("backup");

    return tags;
}

function buildMarkdownMessage(message: string, context?: any): string {
    if (!context?.fields?.length) return message;

    const parts: string[] = [message, ""];

    for (const field of context.fields) {
        parts.push(`${field.name}: ${field.value || "-"}`);
    }

    return parts.join("\n");
}

export const NtfyAdapter: NotificationAdapter = {
    id: "ntfy",
    type: "notification",
    name: "ntfy",
    configSchema: NtfySchema,
    credentials: { primary: "TOKEN" },

    async test(config: NtfyConfig): Promise<{ success: boolean; message: string }> {
        try {
            const baseUrl = stripTrailingSlashes(config.serverUrl);
            const url = `${baseUrl}/${encodeURIComponent(config.topic)}`;

            const headers: Record<string, string> = {
                "Title": "DBackup Connection Test",
                "Priority": "2",
                "Tags": "test_tube",
            };

            if (config.accessToken) {
                headers["Authorization"] = `Bearer ${config.accessToken}`;
            }

            validateOutboundUrl(url);
            const response = await fetch(url, {
                ...NO_REDIRECTS,
                method: "POST",
                headers,
                body: "This is a test notification to verify your ntfy configuration.",
            });

            const redirect = redirectRefusal("ntfy", response);
            if (redirect) return { success: false, message: redirect };
            if (response.ok) {
                return { success: true, message: "Test notification sent successfully!" };
            } else {
                const body = await response.text().catch(() => "");
                return { success: false, message: `ntfy returned ${response.status}: ${body || response.statusText}` };
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message: message || "Failed to connect to ntfy" };
        }
    },

    async send(config: NtfyConfig, message: string, context?: any): Promise<boolean> {
        try {
            const baseUrl = stripTrailingSlashes(config.serverUrl);
            const url = `${baseUrl}/${encodeURIComponent(config.topic)}`;
            const priority = resolvePriority(config.priority ?? 3, context);
            const tags = mapTagsFromContext(context);
            const formattedMessage = buildMarkdownMessage(message, context);

            const headers: Record<string, string> = {
                "Title": context?.title || "DBackup Notification",
                "Priority": String(priority),
                "Tags": tags.join(","),
                "Markdown": "yes",
            };

            if (config.accessToken) {
                headers["Authorization"] = `Bearer ${config.accessToken}`;
            }

            validateOutboundUrl(url);
            const response = await fetch(url, {
                ...NO_REDIRECTS,
                method: "POST",
                headers,
                body: formattedMessage,
            });

            if (!response.ok) {
                const body = await response.text().catch(() => "");
                log.warn("ntfy notification failed", { status: response.status, body });
                return false;
            }

            return true;
        } catch (error) {
            log.error("ntfy notification error", {}, wrapError(error));
            return false;
        }
    },
};
