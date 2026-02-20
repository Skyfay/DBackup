import { NotificationAdapter } from "@/lib/core/interfaces";
import { TeamsSchema, TeamsConfig } from "@/lib/adapters/definitions";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ adapter: "teams" });

/**
 * Microsoft Teams notification adapter using Incoming Webhooks (Power Automate / Workflows).
 *
 * Teams Workflows expect an Adaptive Card payload.
 * @see https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook
 */
export const TeamsAdapter: NotificationAdapter = {
    id: "teams",
    type: "notification",
    name: "Microsoft Teams",
    configSchema: TeamsSchema,

    async test(config: TeamsConfig): Promise<{ success: boolean; message: string }> {
        try {
            const card = buildAdaptiveCard(
                "DBackup Connection Test",
                "This is a test notification to verify your webhook configuration.",
                [],
                "#0078D4",
            );

            const response = await fetch(config.webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(card),
            });

            if (response.ok) {
                return { success: true, message: "Test notification sent successfully!" };
            } else {
                const body = await response.text().catch(() => "");
                return { success: false, message: `Teams returned ${response.status}: ${body || response.statusText}` };
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message: message || "Failed to connect to Microsoft Teams" };
        }
    },

    async send(config: TeamsConfig, message: string, context?: any): Promise<boolean> {
        try {
            const title = context?.title || "Notification";
            const color = context?.color || (context?.success ? "#00ff00" : "#ff0000");
            const fields: Array<{ name: string; value: string; inline?: boolean }> = context?.fields || [];

            const card = buildAdaptiveCard(title, message, fields, color);

            const response = await fetch(config.webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(card),
            });

            if (!response.ok) {
                const body = await response.text().catch(() => "");
                log.warn("Teams notification failed", { status: response.status, body });
                return false;
            }

            return true;
        } catch (error) {
            log.error("Teams notification error", {}, wrapError(error));
            return false;
        }
    },
};

/**
 * Builds an Adaptive Card payload compatible with Teams Workflows / Power Automate webhooks.
 *
 * @see https://adaptivecards.io/explorer/
 */
function buildAdaptiveCard(
    title: string,
    message: string,
    fields: Array<{ name: string; value: string; inline?: boolean }>,
    color: string,
): Record<string, unknown> {
    const body: Record<string, unknown>[] = [];

    // Color stripe via a ColumnSet with a thin colored column
    body.push({
        type: "TextBlock",
        text: title,
        size: "Large",
        weight: "Bolder",
        color: mapHexToAdaptiveColor(color),
        wrap: true,
    });

    body.push({
        type: "TextBlock",
        text: message,
        wrap: true,
        spacing: "Small",
    });

    // Render fields as a FactSet (key-value pairs)
    if (fields.length > 0) {
        body.push({
            type: "FactSet",
            facts: fields.map((f) => ({
                title: f.name,
                value: f.value || "-",
            })),
            spacing: "Medium",
        });
    }

    // Timestamp footer
    body.push({
        type: "TextBlock",
        text: new Date().toISOString(),
        size: "Small",
        isSubtle: true,
        spacing: "Medium",
        wrap: true,
    });

    return {
        type: "message",
        attachments: [
            {
                contentType: "application/vnd.microsoft.card.adaptive",
                contentUrl: null,
                content: {
                    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
                    type: "AdaptiveCard",
                    version: "1.4",
                    body,
                },
            },
        ],
    };
}

/**
 * Maps a hex colour to the closest Adaptive Card built-in colour.
 * Adaptive Cards only support a limited set of named colours.
 */
function mapHexToAdaptiveColor(hex: string): string {
    const clean = hex.replace("#", "").toLowerCase();
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);

    // Simple heuristic mapping to Adaptive Card color keywords
    if (r > 200 && g < 100 && b < 100) return "Attention";   // Red-ish
    if (g > 200 && r < 100) return "Good";                    // Green-ish
    if (r > 200 && g > 150 && b < 100) return "Warning";     // Yellow/Orange
    if (b > 180 && r < 100 && g < 100) return "Accent";      // Blue-ish
    if (r > 200 && g > 200 && b < 100) return "Warning";     // Yellow
    return "Default";
}
