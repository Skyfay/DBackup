import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GenericWebhookAdapter } from "@/lib/adapters/notification/generic-webhook";

describe("Generic Webhook Adapter", () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = mockFetch;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const baseConfig = {
        webhookUrl: "https://example.com/webhook",
        method: "POST" as const,
        contentType: "application/json",
    };

    describe("test()", () => {
        it("should send test payload successfully", async () => {
            mockFetch.mockResolvedValue({ ok: true, status: 200 });

            const result = await GenericWebhookAdapter.test!(baseConfig);

            expect(result.success).toBe(true);
            expect(result.message).toContain("200");
            expect(mockFetch).toHaveBeenCalledWith(baseConfig.webhookUrl, expect.any(Object));

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.title).toContain("Connection Test");
            expect(body.success).toBe(true);
            expect(body.eventType).toBe("test");
            expect(body.timestamp).toBeDefined();
        });

        it("should use custom payload template for test", async () => {
            mockFetch.mockResolvedValue({ ok: true, status: 200 });

            const config = {
                ...baseConfig,
                payloadTemplate: '{"text": "{{title}}: {{message}}"}',
            };

            await GenericWebhookAdapter.test!(config);

            const body = mockFetch.mock.calls[0][1].body;
            expect(body).toContain("Connection Test");
            // Should be the rendered template, not the default JSON
            const parsed = JSON.parse(body);
            expect(parsed.text).toContain("Connection Test");
        });

        it("should include authorization header", async () => {
            mockFetch.mockResolvedValue({ ok: true, status: 200 });

            await GenericWebhookAdapter.test!({
                ...baseConfig,
                authHeader: "Bearer my-token",
            });

            const headers = mockFetch.mock.calls[0][1].headers;
            expect(headers.Authorization).toBe("Bearer my-token");
        });

        it("should parse custom headers", async () => {
            mockFetch.mockResolvedValue({ ok: true, status: 200 });

            await GenericWebhookAdapter.test!({
                ...baseConfig,
                customHeaders: "X-Custom: value1\nX-Api-Key: secret123",
            });

            const headers = mockFetch.mock.calls[0][1].headers;
            expect(headers["X-Custom"]).toBe("value1");
            expect(headers["X-Api-Key"]).toBe("secret123");
        });

        it("should handle test failure", async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 500,
                statusText: "Internal Server Error",
                text: vi.fn().mockResolvedValue("server error"),
            });

            const result = await GenericWebhookAdapter.test!(baseConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("500");
        });

        it("should handle network error", async () => {
            mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

            const result = await GenericWebhookAdapter.test!(baseConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("ECONNREFUSED");
        });
    });

    describe("send()", () => {
        it("should send default JSON payload with context", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            const context = {
                title: "Backup Successful",
                success: true,
                color: "#00ff00",
                eventType: "backup_success",
                fields: [
                    { name: "Job", value: "Daily MySQL", inline: true },
                    { name: "Duration", value: "12s", inline: true },
                ],
            };

            const result = await GenericWebhookAdapter.send(baseConfig, "Backup completed", context);

            expect(result).toBe(true);
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.title).toBe("Backup Successful");
            expect(body.message).toBe("Backup completed");
            expect(body.success).toBe(true);
            expect(body.color).toBe("#00ff00");
            expect(body.eventType).toBe("backup_success");
            expect(body.fields).toHaveLength(2);
            expect(body.timestamp).toBeDefined();
        });

        it("should use configured HTTP method", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await GenericWebhookAdapter.send(
                { ...baseConfig, method: "PUT" as const },
                "Test",
            );

            expect(mockFetch.mock.calls[0][1].method).toBe("PUT");
        });

        it("should use custom content type", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await GenericWebhookAdapter.send(
                { ...baseConfig, contentType: "text/plain" },
                "Test",
            );

            expect(mockFetch.mock.calls[0][1].headers["Content-Type"]).toBe("text/plain");
        });

        it("should render custom payload template with variables", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            const config = {
                ...baseConfig,
                payloadTemplate: '{"text": "{{title}} - {{message}}", "ok": {{success}}, "ts": "{{timestamp}}"}',
            };

            await GenericWebhookAdapter.send(config, "Backup done", {
                title: "Success",
                success: true,
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.text).toBe("Success - Backup done");
            expect(body.ok).toBe(true);
            expect(body.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        });

        it("should replace unknown placeholders with empty string", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            const config = {
                ...baseConfig,
                payloadTemplate: '{"text": "{{unknown_var}}"}',
            };

            await GenericWebhookAdapter.send(config, "Test");

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.text).toBe("");
        });

        it("should omit fields and eventType when empty in default payload", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await GenericWebhookAdapter.send(baseConfig, "Plain message");

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.fields).toBeUndefined();
            expect(body.eventType).toBeUndefined();
        });

        it("should use red color when success is false and no custom color given", async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await GenericWebhookAdapter.send(baseConfig, "Failed", {
                title: "Error",
                success: false,
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.color).toBe("#ff0000");
            expect(body.success).toBe(false);
        });

        it("should return false on HTTP error", async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 422,
                text: vi.fn().mockResolvedValue("Unprocessable Entity"),
            });

            const result = await GenericWebhookAdapter.send(baseConfig, "Test");

            expect(result).toBe(false);
        });

        it("should return false on network error", async () => {
            mockFetch.mockRejectedValue(new Error("Network failure"));

            const result = await GenericWebhookAdapter.send(baseConfig, "Test");

            expect(result).toBe(false);
        });
    });
});
