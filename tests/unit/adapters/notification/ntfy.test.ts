import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NtfyAdapter } from "@/lib/adapters/notification/ntfy";

describe("ntfy Adapter", () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = mockFetch;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const baseConfig = {
        serverUrl: "https://ntfy.sh",
        topic: "dbackup-alerts",
        priority: 3,
    };

    describe("test()", () => {
        it("should send test notification successfully", async () => {
            mockFetch.mockResolvedValue({ ok: true, status: 200 });

            const result = await NtfyAdapter.test!(baseConfig);

            expect(result.success).toBe(true);
            expect(result.message).toContain("successfully");
            expect(mockFetch).toHaveBeenCalledWith(
                "https://ntfy.sh/dbackup-alerts",
                expect.objectContaining({
                    method: "POST",
                    headers: expect.objectContaining({
                        Title: "DBackup Connection Test",
                        Priority: "2",
                        Tags: "test_tube",
                    }),
                }),
            );
        });

        it("should include authorization header when access token is set", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await NtfyAdapter.test!({ ...baseConfig, accessToken: "tk_secret" });

            const headers = mockFetch.mock.calls[0][1].headers;
            expect(headers.Authorization).toBe("Bearer tk_secret");
        });

        it("should not include authorization header when no access token", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await NtfyAdapter.test!(baseConfig);

            const headers = mockFetch.mock.calls[0][1].headers;
            expect(headers.Authorization).toBeUndefined();
        });

        it("should URL-encode the topic name", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await NtfyAdapter.test!({ ...baseConfig, topic: "my topic/special" });

            expect(mockFetch).toHaveBeenCalledWith(
                "https://ntfy.sh/my%20topic%2Fspecial",
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

            const result = await NtfyAdapter.test!(baseConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("401");
        });

        it("should handle network error", async () => {
            mockFetch.mockRejectedValue(new Error("ENOTFOUND"));

            const result = await NtfyAdapter.test!(baseConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("ENOTFOUND");
        });
    });

    describe("send()", () => {
        it("should send notification with correct headers", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            const context = {
                title: "Backup Successful",
                success: true,
                fields: [
                    { name: "Job", value: "Daily MySQL" },
                    { name: "Duration", value: "12s" },
                ],
            };

            const result = await NtfyAdapter.send(baseConfig, "Backup completed", context);

            expect(result).toBe(true);
            const call = mockFetch.mock.calls[0];
            const headers = call[1].headers;

            expect(headers.Title).toBe("Backup Successful");
            expect(headers.Priority).toBe("3"); // Default priority for success
            expect(headers.Markdown).toBe("yes");
            expect(headers.Tags).toContain("white_check_mark");
            expect(headers.Tags).toContain("backup");

            // Body should contain message and fields
            const body = call[1].body;
            expect(body).toContain("Backup completed");
            expect(body).toContain("Job: Daily MySQL");
            expect(body).toContain("Duration: 12s");
        });

        it("should escalate priority to 5 on failure", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await NtfyAdapter.send(baseConfig, "Failed", {
                title: "Backup Failed",
                success: false,
            });

            const headers = mockFetch.mock.calls[0][1].headers;
            expect(headers.Priority).toBe("5");
        });

        it("should use failure tags for failed events", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await NtfyAdapter.send(baseConfig, "Failed", {
                title: "Backup Failed",
                success: false,
            });

            const headers = mockFetch.mock.calls[0][1].headers;
            expect(headers.Tags).toContain("x");
            expect(headers.Tags).toContain("warning");
            expect(headers.Tags).toContain("backup");
        });

        it("should use priority 2 for test events", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await NtfyAdapter.send(baseConfig, "Test", {
                success: true,
                title: "Test",
                eventType: "test",
            });

            const headers = mockFetch.mock.calls[0][1].headers;
            expect(headers.Priority).toBe("2");
        });

        it("should use configured default priority for success", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await NtfyAdapter.send(
                { ...baseConfig, priority: 4 },
                "Done",
                { title: "Done", success: true },
            );

            const headers = mockFetch.mock.calls[0][1].headers;
            expect(headers.Priority).toBe("4");
        });

        it("should send plain message without context fields", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await NtfyAdapter.send(baseConfig, "Plain message");

            const call = mockFetch.mock.calls[0];
            expect(call[1].body).toBe("Plain message");
            expect(call[1].headers.Title).toBe("DBackup Notification");
        });

        it("should include bearer token when access token is set", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await NtfyAdapter.send(
                { ...baseConfig, accessToken: "tk_abc" },
                "Test",
            );

            const headers = mockFetch.mock.calls[0][1].headers;
            expect(headers.Authorization).toBe("Bearer tk_abc");
        });

        it("should strip trailing slashes from server URL", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await NtfyAdapter.send(
                { ...baseConfig, serverUrl: "https://ntfy.sh///" },
                "Test",
            );

            expect(mockFetch).toHaveBeenCalledWith(
                "https://ntfy.sh/dbackup-alerts",
                expect.any(Object),
            );
        });

        it("should return false on HTTP error", async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 403,
                text: vi.fn().mockResolvedValue("Forbidden"),
            });

            const result = await NtfyAdapter.send(baseConfig, "Test");

            expect(result).toBe(false);
        });

        it("should return false on network error", async () => {
            mockFetch.mockRejectedValue(new Error("Socket hang up"));

            const result = await NtfyAdapter.send(baseConfig, "Test");

            expect(result).toBe(false);
        });
    });
});
