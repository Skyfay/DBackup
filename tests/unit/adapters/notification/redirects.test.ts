/**
 * The webhook style channels never follow a redirect: the local network check of a tenant read
 * the host of the configured URL, and a redirect would carry the request to a host nobody
 * checked. Discord, Slack, Teams, Gotify and ntfy answer 2xx directly, so a 3xx is a failed send.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationAdapter } from "@/lib/core/interfaces";
import { DiscordAdapter } from "@/lib/adapters/notification/discord";
import { SlackAdapter } from "@/lib/adapters/notification/slack";
import { TeamsAdapter } from "@/lib/adapters/notification/teams";
import { GenericWebhookAdapter } from "@/lib/adapters/notification/generic-webhook";
import { GotifyAdapter } from "@/lib/adapters/notification/gotify";
import { NtfyAdapter } from "@/lib/adapters/notification/ntfy";

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const CHANNELS: [string, NotificationAdapter, Record<string, unknown>][] = [
    ["Discord", DiscordAdapter, { webhookUrl: "https://discord.com/api/webhooks/1/x" }],
    ["Slack", SlackAdapter, { webhookUrl: "https://hooks.slack.com/services/T00/B00/x" }],
    ["Teams", TeamsAdapter, { webhookUrl: "https://acme.webhook.office.com/webhookb2/x" }],
    ["The webhook", GenericWebhookAdapter, { webhookUrl: "https://hooks.example.com/in", method: "POST", contentType: "application/json" }],
    ["Gotify", GotifyAdapter, { serverUrl: "https://gotify.example.com", appToken: "token", priority: 5 }],
    ["ntfy", NtfyAdapter, { serverUrl: "https://ntfy.example.com", topic: "alerts", priority: 3 }],
];

const fetchMock = vi.fn();

function answer(status: number, location?: string) {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status >= 300 && status < 400 ? "Found" : "OK",
        headers: new Headers(location ? { location } : {}),
        text: async () => "",
        json: async () => ({}),
    };
}

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("a redirect of a webhook style channel", () => {
    it.each(CHANNELS)("%s asks fetch to hand back a redirect instead of following it", async (_name, adapter, config) => {
        fetchMock.mockResolvedValue(answer(204));

        await adapter.test!(config as never);
        await adapter.send(config as never, "Backup done", { title: "Backup", success: true });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        for (const [, options] of fetchMock.mock.calls) expect(options).toMatchObject({ redirect: "manual" });
    });

    it.each(CHANNELS)("%s fails a test answered with a redirect and says where it led", async (name, adapter, config) => {
        fetchMock.mockResolvedValue(answer(302, "http://10.0.0.5/hook"));

        const result = await adapter.test!(config as never);

        expect(result.success).toBe(false);
        expect(result.message).toBe(`${name} answered with a redirect to http://10.0.0.5/hook (302), which DBackup does not follow. Enter the final address instead.`);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each(CHANNELS)("%s reports a send answered with a redirect as failed", async (_name, adapter, config) => {
        fetchMock.mockResolvedValue(answer(307, "http://169.254.169.254/"));

        await expect(adapter.send(config as never, "Backup done", { title: "Backup", success: true })).resolves.toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each(CHANNELS)("%s still sends to a normal endpoint that answers 2xx", async (_name, adapter, config) => {
        fetchMock.mockResolvedValue(answer(200));

        expect((await adapter.test!(config as never)).success).toBe(true);
        await expect(adapter.send(config as never, "Backup done", { title: "Backup", success: true })).resolves.toBe(true);
    });
});
