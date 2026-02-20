import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SlackAdapter } from "@/lib/adapters/notification/slack";

describe("Slack Adapter", () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = mockFetch;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const baseConfig = {
        webhookUrl: "https://hooks.slack.com/services/T00/B00/xxx",
    };

    describe("test()", () => {
        it("should send test notification successfully", async () => {
            mockFetch.mockResolvedValue({ ok: true, status: 200 });

            const result = await SlackAdapter.test!(baseConfig);

            expect(result.success).toBe(true);
            expect(result.message).toContain("successfully");
            expect(mockFetch).toHaveBeenCalledWith(baseConfig.webhookUrl, expect.any(Object));

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.text).toContain("Connection Test");
        });

        it("should handle test failure with status code", async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 403,
                statusText: "Forbidden",
                text: vi.fn().mockResolvedValue("invalid_token"),
            });

            const result = await SlackAdapter.test!(baseConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("403");
            expect(result.message).toContain("invalid_token");
        });

        it("should handle network error", async () => {
            mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

            const result = await SlackAdapter.test!(baseConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("ECONNREFUSED");
        });
    });

    describe("send()", () => {
        it("should send plain text when no context is provided", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            const result = await SlackAdapter.send(baseConfig, "Simple message");

            expect(result).toBe(true);
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.text).toBe("Simple message");
            expect(body.attachments).toBeUndefined();
        });

        it("should send Block Kit with attachments when context is provided", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            const context = {
                title: "Backup Successful",
                success: true,
                fields: [
                    { name: "Job", value: "Daily MySQL", inline: true },
                    { name: "Duration", value: "12s", inline: true },
                ],
            };

            const result = await SlackAdapter.send(baseConfig, "Backup completed", context);

            expect(result).toBe(true);
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);

            // Should use attachments for color bar
            expect(body.attachments).toHaveLength(1);
            expect(body.attachments[0].color).toBe("#00ff00");

            // Should have blocks inside the attachment
            const blocks = body.attachments[0].blocks;
            expect(blocks[0].type).toBe("header");
            expect(blocks[0].text.text).toBe("Backup Successful");
            expect(blocks[1].type).toBe("section");
            expect(blocks[1].text.text).toBe("Backup completed");

            // Fields section
            const fieldsBlock = blocks.find((b: any) => b.type === "section" && b.fields);
            expect(fieldsBlock).toBeDefined();
            expect(fieldsBlock.fields).toHaveLength(2);
            expect(fieldsBlock.fields[0].text).toContain("Job");
            expect(fieldsBlock.fields[0].text).toContain("Daily MySQL");

            // Context block with timestamp
            const contextBlock = blocks.find((b: any) => b.type === "context");
            expect(contextBlock).toBeDefined();
        });

        it("should use red color for failure", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await SlackAdapter.send(baseConfig, "Failed", {
                title: "Backup Failed",
                success: false,
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.attachments[0].color).toBe("#ff0000");
        });

        it("should use custom color from context", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await SlackAdapter.send(baseConfig, "Info", {
                title: "Info",
                color: "#3b82f6",
                success: true,
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.attachments[0].color).toBe("#3b82f6");
        });

        it("should include channel override when configured", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await SlackAdapter.send(
                { ...baseConfig, channel: "#alerts" },
                "Test",
            );

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.channel).toBe("#alerts");
        });

        it("should include username and icon emoji when configured", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await SlackAdapter.send(
                { ...baseConfig, username: "BackupBot", iconEmoji: ":shield:" },
                "Test",
            );

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.username).toBe("BackupBot");
            expect(body.icon_emoji).toBe(":shield:");
        });

        it("should return false on HTTP error", async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 500,
                text: vi.fn().mockResolvedValue("server error"),
            });

            const result = await SlackAdapter.send(baseConfig, "Test");

            expect(result).toBe(false);
        });

        it("should return false on network error", async () => {
            mockFetch.mockRejectedValue(new Error("Network error"));

            const result = await SlackAdapter.send(baseConfig, "Test");

            expect(result).toBe(false);
        });
    });
});
