import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelegramAdapter } from "@/lib/adapters/notification/telegram";

describe("Telegram Adapter", () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = mockFetch;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const baseConfig = {
        botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
        chatId: "-1001234567890",
        parseMode: "HTML" as const,
        disableNotification: false,
    };

    describe("test()", () => {
        it("should send test notification successfully", async () => {
            mockFetch.mockResolvedValue({ ok: true, status: 200 });

            const result = await TelegramAdapter.test!(baseConfig);

            expect(result.success).toBe(true);
            expect(result.message).toContain("successfully");
            expect(mockFetch).toHaveBeenCalledWith(
                "https://api.telegram.org/bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11/sendMessage",
                expect.objectContaining({
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                }),
            );

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.chat_id).toBe("-1001234567890");
            expect(body.parse_mode).toBe("HTML");
            expect(body.text).toContain("Connection Test");
        });

        it("should handle Telegram API error", async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 401,
                statusText: "Unauthorized",
                json: vi.fn().mockResolvedValue({ description: "Unauthorized: invalid bot token" }),
            });

            const result = await TelegramAdapter.test!(baseConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("401");
            expect(result.message).toContain("invalid bot token");
        });

        it("should handle network error", async () => {
            mockFetch.mockRejectedValue(new Error("Connection refused"));

            const result = await TelegramAdapter.test!(baseConfig);

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

            const result = await TelegramAdapter.send(baseConfig, "Backup completed", context);

            expect(result).toBe(true);
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.text).toContain("✅");
            expect(body.text).toContain("<b>Backup Successful</b>");
            expect(body.text).toContain("Backup completed");
            expect(body.text).toContain("<b>Job:</b> Daily MySQL");
            expect(body.text).toContain("<b>Duration:</b> 12s");
        });

        it("should show failure emoji on error context", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await TelegramAdapter.send(baseConfig, "Backup failed", {
                title: "Backup Failed",
                success: false,
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.text).toContain("❌");
        });

        it("should send plain message without context", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await TelegramAdapter.send(baseConfig, "Simple message");

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.text).toBe("Simple message");
            expect(body.parse_mode).toBe("HTML");
        });

        it("should escape HTML entities in message", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await TelegramAdapter.send(baseConfig, "Test <script> & \"quotes\"");

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.text).toContain("&lt;script&gt;");
            expect(body.text).toContain("&amp;");
        });

        it("should respect disableNotification setting", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await TelegramAdapter.send(
                { ...baseConfig, disableNotification: true },
                "Silent message",
            );

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.disable_notification).toBe(true);
        });

        it("should use configured parseMode", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await TelegramAdapter.send(
                { ...baseConfig, parseMode: "MarkdownV2" },
                "Markdown message",
            );

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.parse_mode).toBe("MarkdownV2");
        });

        it("should return false on HTTP error", async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 403,
                json: vi.fn().mockResolvedValue({ description: "Forbidden: bot was blocked" }),
            });

            const result = await TelegramAdapter.send(baseConfig, "Test");

            expect(result).toBe(false);
        });

        it("should return false on network error", async () => {
            mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

            const result = await TelegramAdapter.send(baseConfig, "Test");

            expect(result).toBe(false);
        });
    });
});
