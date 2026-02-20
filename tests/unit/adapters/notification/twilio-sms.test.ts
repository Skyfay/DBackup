import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TwilioSmsAdapter } from "@/lib/adapters/notification/twilio-sms";

describe("Twilio SMS Adapter", () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = mockFetch;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const baseConfig = {
        accountSid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        authToken: "test-auth-token",
        from: "+1234567890",
        to: "+0987654321",
    };

    describe("test()", () => {
        it("should send test SMS successfully", async () => {
            mockFetch.mockResolvedValue({ ok: true, status: 201 });

            const result = await TwilioSmsAdapter.test!(baseConfig);

            expect(result.success).toBe(true);
            expect(result.message).toContain("successfully");
            expect(mockFetch).toHaveBeenCalledWith(
                "https://api.twilio.com/2010-04-01/Accounts/ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/Messages.json",
                expect.objectContaining({
                    method: "POST",
                    headers: expect.objectContaining({
                        "Content-Type": "application/x-www-form-urlencoded",
                    }),
                }),
            );
        });

        it("should send Basic auth header", async () => {
            mockFetch.mockResolvedValue({ ok: true, status: 201 });

            await TwilioSmsAdapter.test!(baseConfig);

            const headers = mockFetch.mock.calls[0][1].headers;
            const expected = Buffer.from(`${baseConfig.accountSid}:${baseConfig.authToken}`).toString("base64");
            expect(headers["Authorization"]).toBe(`Basic ${expected}`);
        });

        it("should include From and To in request body", async () => {
            mockFetch.mockResolvedValue({ ok: true, status: 201 });

            await TwilioSmsAdapter.test!(baseConfig);

            const body = mockFetch.mock.calls[0][1].body;
            const params = new URLSearchParams(body);
            expect(params.get("From")).toBe("+1234567890");
            expect(params.get("To")).toBe("+0987654321");
            expect(params.get("Body")).toContain("Connection Test");
        });

        it("should handle Twilio API error", async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 401,
                statusText: "Unauthorized",
                json: vi.fn().mockResolvedValue({ message: "Authentication Error" }),
            });

            const result = await TwilioSmsAdapter.test!(baseConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("401");
            expect(result.message).toContain("Authentication Error");
        });

        it("should handle network error", async () => {
            mockFetch.mockRejectedValue(new Error("Network failure"));

            const result = await TwilioSmsAdapter.test!(baseConfig);

            expect(result.success).toBe(false);
            expect(result.message).toContain("Network failure");
        });
    });

    describe("send()", () => {
        it("should send SMS with context", async () => {
            mockFetch.mockResolvedValue({ ok: true, status: 201 });

            const context = {
                title: "Backup Successful",
                success: true,
                fields: [
                    { name: "Job", value: "Daily MySQL" },
                    { name: "Duration", value: "12s" },
                ],
            };

            const result = await TwilioSmsAdapter.send(baseConfig, "Backup completed", context);

            expect(result).toBe(true);
            const body = new URLSearchParams(mockFetch.mock.calls[0][1].body);
            const smsBody = body.get("Body")!;
            expect(smsBody).toContain("Backup Successful");
            expect(smsBody).toContain("✅");
            expect(smsBody).toContain("Job: Daily MySQL");
            expect(smsBody).toContain("Duration: 12s");
        });

        it("should show failure indicator on error context", async () => {
            mockFetch.mockResolvedValue({ ok: true, status: 201 });

            await TwilioSmsAdapter.send(baseConfig, "Backup failed", {
                title: "Backup Failed",
                success: false,
            });

            const body = new URLSearchParams(mockFetch.mock.calls[0][1].body);
            expect(body.get("Body")).toContain("❌");
        });

        it("should send plain message without context", async () => {
            mockFetch.mockResolvedValue({ ok: true, status: 201 });

            await TwilioSmsAdapter.send(baseConfig, "Simple message");

            const body = new URLSearchParams(mockFetch.mock.calls[0][1].body);
            expect(body.get("Body")).toBe("Simple message");
        });

        it("should limit fields to 4 for SMS length", async () => {
            mockFetch.mockResolvedValue({ ok: true, status: 201 });

            await TwilioSmsAdapter.send(baseConfig, "Test", {
                fields: [
                    { name: "F1", value: "v1" },
                    { name: "F2", value: "v2" },
                    { name: "F3", value: "v3" },
                    { name: "F4", value: "v4" },
                    { name: "F5", value: "v5" },
                    { name: "F6", value: "v6" },
                ],
            });

            const body = new URLSearchParams(mockFetch.mock.calls[0][1].body);
            const smsBody = body.get("Body")!;
            expect(smsBody).toContain("F4: v4");
            expect(smsBody).not.toContain("F5: v5");
        });

        it("should accept 201 status as success", async () => {
            mockFetch.mockResolvedValue({ ok: false, status: 201 });

            const result = await TwilioSmsAdapter.send(baseConfig, "Test");

            expect(result).toBe(true);
        });

        it("should return false on HTTP error", async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 400,
                json: vi.fn().mockResolvedValue({ message: "Invalid phone number" }),
            });

            const result = await TwilioSmsAdapter.send(baseConfig, "Test");

            expect(result).toBe(false);
        });

        it("should return false on network error", async () => {
            mockFetch.mockRejectedValue(new Error("Timeout"));

            const result = await TwilioSmsAdapter.send(baseConfig, "Test");

            expect(result).toBe(false);
        });
    });
});
