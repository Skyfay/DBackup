/**
 * The webhook style channels follow a redirect only on the host of their URL: the local network
 * check of a tenant read that host, and a redirect to another host would carry the request to a
 * host nobody checked. One on the same host, like from http to https behind a proxy, is followed
 * with the same method and body.
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
    it.each(CHANNELS)("%s asks fetch to hand back a redirect instead of following it itself", async (_name, adapter, config) => {
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

    it.each(CHANNELS)("%s follows a redirect to https on the same host with the same method and body", async (_name, adapter, config) => {
        const first = new URL(String(Object.values(config).find((value) => typeof value === "string" && value.startsWith("https://"))));
        const target = `https://${first.hostname}:8443/final`;
        fetchMock.mockResolvedValueOnce(answer(301, `http://${first.hostname}/moved`)).mockResolvedValueOnce(answer(308, target)).mockResolvedValue(answer(200));

        await expect(adapter.send(config as never, "Backup done", { title: "Backup", success: true })).resolves.toBe(true);

        const calls = fetchMock.mock.calls as [string, RequestInit][];
        expect(calls.map(([url]) => url).slice(1)).toEqual([`http://${first.hostname}/moved`, target]);
        for (const [, options] of calls) {
            expect(options).toMatchObject({ redirect: "manual", method: calls[0][1].method, body: calls[0][1].body });
        }
    });

    it.each(CHANNELS)("%s refuses a redirect to another host after one on the same host", async (name, adapter, config) => {
        const first = new URL(String(Object.values(config).find((value) => typeof value === "string" && value.startsWith("https://"))));
        fetchMock.mockResolvedValueOnce(answer(302, `https://${first.hostname}/step`)).mockResolvedValue(answer(302, "http://10.0.0.5/hook"));

        const result = await adapter.test!(config as never);

        expect(result.message).toBe(`${name} answered with a redirect to http://10.0.0.5/hook (302), which DBackup does not follow. Enter the final address instead.`);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each(CHANNELS)("%s gives up after a few redirects on the same host", async (_name, adapter, config) => {
        fetchMock.mockResolvedValue(answer(302, "/again"));

        const result = await adapter.test!(config as never);

        expect(result.success).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(6);
    });

    it.each(CHANNELS)("%s still sends to a normal endpoint that answers 2xx", async (_name, adapter, config) => {
        fetchMock.mockResolvedValue(answer(200));

        expect((await adapter.test!(config as never)).success).toBe(true);
        await expect(adapter.send(config as never, "Backup done", { title: "Backup", success: true })).resolves.toBe(true);
    });
});
