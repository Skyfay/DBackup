import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TeamsAdapter } from "@/lib/adapters/notification/teams";

describe("Teams Adapter", () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = mockFetch;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const baseConfig = {
        webhookUrl: "https://xxx.webhook.office.com/webhookb2/test",
    };

    describe("test()", () => {
        it("should send test Adaptive Card successfully", async () => {
            mockFetch.mockResolvedValue({ ok: true, status: 200 });

            const result = await TeamsAdapter.test!(baseConfig);

            expect(result.success).toBe(true);
            expect(result.message).toContain("successfully");
            expect(mockFetch).toHaveBeenCalledWith(baseConfig.webhookUrl, expect.any(Object));

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.type).toBe("message");
            expect(body.attachments).toHaveLength(1);
            expect(body.attachments[0].contentType).toBe("application/vnd.microsoft.card.adaptive");

            const card = body.attachments[0].content;
            expect(card.type).toBe("AdaptiveCard");
            expect(card.version).toBe("1.4");

            // Title TextBlock should contain test text
            const titleBlock = card.body.find((b: any) => b.size === "Large");
            expect(titleBlock.text).toContain("Connection Test");
        });

        it("should handle test failure", async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 400,
                statusText: "Bad Request",
                text: vi.fn().mockResolvedValue("invalid payload"),
            });

            const result = await TeamsAdapter.test!(baseConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("400");
        });

        it("should handle network error", async () => {
            mockFetch.mockRejectedValue(new Error("DNS resolution failed"));

            const result = await TeamsAdapter.test!(baseConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("DNS resolution failed");
        });
    });

    describe("send()", () => {
        it("should send Adaptive Card with context", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            const context = {
                title: "Backup Successful",
                success: true,
                fields: [
                    { name: "Job", value: "Daily MySQL" },
                    { name: "Duration", value: "12s" },
                ],
                color: "#00ff00",
            };

            const result = await TeamsAdapter.send(baseConfig, "Backup completed", context);

            expect(result).toBe(true);
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            const card = body.attachments[0].content;

            // Title
            const titleBlock = card.body.find((b: any) => b.size === "Large");
            expect(titleBlock.text).toBe("Backup Successful");
            expect(titleBlock.color).toBe("Good"); // Green maps to "Good"

            // Message
            const messageBlock = card.body.find((b: any) => b.text === "Backup completed");
            expect(messageBlock).toBeDefined();

            // FactSet fields
            const factSet = card.body.find((b: any) => b.type === "FactSet");
            expect(factSet).toBeDefined();
            expect(factSet.facts).toHaveLength(2);
            expect(factSet.facts[0].title).toBe("Job");
            expect(factSet.facts[0].value).toBe("Daily MySQL");
        });

        it("should map red color to Attention", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await TeamsAdapter.send(baseConfig, "Failed", {
                title: "Backup Failed",
                success: false,
                color: "#ff0000",
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            const titleBlock = body.attachments[0].content.body.find((b: any) => b.size === "Large");
            expect(titleBlock.color).toBe("Attention");
        });

        it("should use default red color when success is false and no color given", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await TeamsAdapter.send(baseConfig, "Failed", {
                title: "Backup Failed",
                success: false,
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            const titleBlock = body.attachments[0].content.body.find((b: any) => b.size === "Large");
            expect(titleBlock.color).toBe("Attention");
        });

        it("should send without FactSet when no fields provided", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await TeamsAdapter.send(baseConfig, "Simple notification", {
                title: "Info",
                success: true,
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            const factSet = body.attachments[0].content.body.find((b: any) => b.type === "FactSet");
            expect(factSet).toBeUndefined();
        });

        it("should include timestamp in the card body", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await TeamsAdapter.send(baseConfig, "Test", {
                title: "Test",
                success: true,
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            const subtleBlock = body.attachments[0].content.body.find((b: any) => b.isSubtle === true);
            expect(subtleBlock).toBeDefined();
            // Should be an ISO timestamp
            expect(subtleBlock.text).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        });

        it("should return false on HTTP error", async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 502,
                text: vi.fn().mockResolvedValue("Bad Gateway"),
            });

            const result = await TeamsAdapter.send(baseConfig, "Test");

            expect(result).toBe(false);
        });

        it("should return false on network error", async () => {
            mockFetch.mockRejectedValue(new Error("Timeout"));

            const result = await TeamsAdapter.send(baseConfig, "Test");

            expect(result).toBe(false);
        });
    });
});
