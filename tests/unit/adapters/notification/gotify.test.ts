import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GotifyAdapter } from "@/lib/adapters/notification/gotify";

describe("Gotify Adapter", () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = mockFetch;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const baseConfig = {
        serverUrl: "https://gotify.example.com",
        appToken: "AbCdEf12345",
        priority: 5,
    };

    describe("test()", () => {
        it("should send test notification successfully", async () => {
            mockFetch.mockResolvedValue({ ok: true, status: 200 });

            const result = await GotifyAdapter.test!(baseConfig);

            expect(result.success).toBe(true);
            expect(result.message).toContain("successfully");
            expect(mockFetch).toHaveBeenCalledWith(
                "https://gotify.example.com/message",
                expect.objectContaining({
                    method: "POST",
                    headers: expect.objectContaining({
                        "X-Gotify-Key": "AbCdEf12345",
                    }),
                }),
            );

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.title).toContain("Connection Test");
            expect(body.priority).toBe(1);
            expect(body.extras["client::display"].contentType).toBe("text/markdown");
        });

        it("should strip trailing slashes from server URL", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await GotifyAdapter.test!({ ...baseConfig, serverUrl: "https://gotify.example.com///" });

            expect(mockFetch).toHaveBeenCalledWith(
                "https://gotify.example.com/message",
                expect.any(Object),
            );
        });

        it("should handle test failure", async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 401,
                statusText: "Unauthorized",
                text: vi.fn().mockResolvedValue("unauthorized"),
            });

            const result = await GotifyAdapter.test!(baseConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("401");
        });

        it("should handle network error", async () => {
            mockFetch.mockRejectedValue(new Error("Connection refused"));

            const result = await GotifyAdapter.test!(baseConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("Connection refused");
        });
    });

    describe("send()", () => {
        it("should send notification with context", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            const context = {
                title: "Backup Successful",
                success: true,
                fields: [
                    { name: "Job", value: "Daily MySQL" },
                    { name: "Duration", value: "12s" },
                ],
            };

            const result = await GotifyAdapter.send(baseConfig, "Backup completed", context);

            expect(result).toBe(true);
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.title).toBe("Backup Successful");
            expect(body.message).toContain("Backup completed");
            expect(body.message).toContain("**Job:** Daily MySQL");
            expect(body.message).toContain("**Duration:** 12s");
            expect(body.priority).toBe(5); // Default priority for success
        });

        it("should escalate priority to 8 on failure", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await GotifyAdapter.send(baseConfig, "Failed", {
                title: "Backup Failed",
                success: false,
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.priority).toBe(8);
        });

        it("should use priority 1 for test events", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await GotifyAdapter.send(baseConfig, "Test", {
                title: "Test",
                eventType: "test",
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.priority).toBe(1);
        });

        it("should use configured default priority for success", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await GotifyAdapter.send(
                { ...baseConfig, priority: 3 },
                "Done",
                { title: "Done", success: true },
            );

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.priority).toBe(3);
        });

        it("should send plain message without context", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await GotifyAdapter.send(baseConfig, "Plain message");

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.title).toBe("DBackup Notification");
            expect(body.message).toBe("Plain message");
            expect(body.priority).toBe(5);
        });

        it("should include markdown title in message body", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await GotifyAdapter.send(baseConfig, "Body text", {
                title: "My Title",
                success: true,
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.message).toContain("## My Title");
            expect(body.message).toContain("Body text");
        });

        it("should return false on HTTP error", async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 500,
                text: vi.fn().mockResolvedValue("Internal Server Error"),
            });

            const result = await GotifyAdapter.send(baseConfig, "Test");

            expect(result).toBe(false);
        });

        it("should return false on network error", async () => {
            mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

            const result = await GotifyAdapter.send(baseConfig, "Test");

            expect(result).toBe(false);
        });
    });
});
