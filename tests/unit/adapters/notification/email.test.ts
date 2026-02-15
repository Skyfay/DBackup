import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EmailAdapter } from "@/lib/adapters/notification/email";

// Mock nodemailer
const mockVerify = vi.fn().mockResolvedValue(true);
const mockSendMail = vi.fn().mockResolvedValue({ messageId: "test-id" });

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      verify: mockVerify,
      sendMail: mockSendMail,
    })),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock("@/lib/errors", () => ({
  wrapError: vi.fn((e: any) => e),
}));

describe("Email Adapter", () => {
  const baseConfig = {
    host: "smtp.example.com",
    port: 587,
    secure: "starttls",
    user: "testuser",
    password: "testpass",
    from: "backup@example.com",
    to: "admin@example.com",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("test()", () => {
    it("should verify SMTP connection successfully", async () => {
      const result = await EmailAdapter.test!(baseConfig);

      expect(result.success).toBe(true);
      expect(result.message).toContain("verified");
    });

    it("should handle connection failure", async () => {
      mockVerify.mockRejectedValueOnce(new Error("Connection refused"));

      const result = await EmailAdapter.test!(baseConfig);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Connection refused");
    });
  });

  describe("send()", () => {
    it("should send email with notification context", async () => {
      const context = {
        title: "Backup Successful",
        fields: [{ name: "Job", value: "Daily MySQL", inline: true }],
        color: "#22c55e",
        success: true,
      };

      const result = await EmailAdapter.send(baseConfig, "Backup completed", context);

      expect(result).toBe(true);
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "backup@example.com",
          to: "admin@example.com",
          subject: "Backup Successful",
          text: "Backup completed",
          html: expect.any(String),
        })
      );
    });

    it("should use DBackup Notification as default subject", async () => {
      const result = await EmailAdapter.send(baseConfig, "Test message", {});

      expect(result).toBe(true);
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "DBackup Notification",
        })
      );
    });

    it("should handle array of recipients", async () => {
      const multiConfig = {
        ...baseConfig,
        to: ["admin@example.com", "ops@example.com", "dev@example.com"],
      };

      await EmailAdapter.send(multiConfig, "Test", { title: "Test" });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "admin@example.com, ops@example.com, dev@example.com",
        })
      );
    });

    it("should handle single string recipient", async () => {
      await EmailAdapter.send(baseConfig, "Test", { title: "Test" });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "admin@example.com",
        })
      );
    });

    it("should return false on send failure", async () => {
      mockSendMail.mockRejectedValueOnce(new Error("SMTP timeout"));

      const result = await EmailAdapter.send(baseConfig, "Test", {});

      expect(result).toBe(false);
    });

    it("should render HTML with logo from dbackup.app", async () => {
      await EmailAdapter.send(baseConfig, "Test message", {
        title: "Test",
        success: true,
      });

      const html = mockSendMail.mock.calls[0][0].html;
      expect(html).toContain("https://dbackup.app/logo.png");
    });

    it("should render HTML with DBackup footer", async () => {
      await EmailAdapter.send(baseConfig, "Test message", {
        title: "Test",
        success: true,
      });

      const html = mockSendMail.mock.calls[0][0].html;
      expect(html).toContain("Sent by DBackup");
      expect(html).not.toContain("Database Backup Manager");
    });
  });
});
