import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EmailAdapter } from "@/lib/adapters/notification/email";
import nodemailer from "nodemailer";

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

vi.mock("@/lib/logging/logger", () => ({
  logger: {
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock("@/lib/logging/errors", () => ({
  wrapError: vi.fn((e: any) => e),
}));

// The name and address of the instance, which the sender and the buttons of a mail use.
vi.mock("@/lib/notifications/brand", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/notifications/brand")>()),
  loadNotificationBrand: vi.fn(async () => ({ instanceName: "Production", baseUrl: "https://backup.example.com", timeZone: "UTC" })),
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

    it("should set ignoreTLS when secure mode is none", async () => {
      const insecureConfig = {
        ...baseConfig,
        secure: "none",
      };

      await EmailAdapter.test!(insecureConfig);

      expect((nodemailer as any).createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          ignoreTLS: true,
          secure: false,
        })
      );
    });
  });

  describe("the test mail", () => {
    it("sends the test mail in the template of every notification", async () => {
      await EmailAdapter.test!(baseConfig);

      const mail = mockSendMail.mock.calls[0][0];
      expect(mail.subject).toBe("Your SMTP settings work");
      expect(mail.html).toContain("smtp.example.com");
      expect(mail.html).toContain("STARTTLS");
      expect(mail.text).toContain("Port: 587");
    });
  });

  describe("send()", () => {
    it("sends the payload as subject, HTML and plain text", async () => {
      const context = {
        title: "mysql-shop finished",
        fields: [{ name: "Job", value: "mysql-shop", inline: true }],
        color: "#22c55e",
        success: true,
      };

      const result = await EmailAdapter.send(baseConfig, "Backup completed", context);

      expect(result).toBe(true);
      const mail = mockSendMail.mock.calls[0][0];
      expect(mail.to).toBe("admin@example.com");
      expect(mail.subject).toBe("mysql-shop finished");
      expect(mail.text).toContain("Backup completed");
      expect(mail.text).toContain("Job: mysql-shop");
      expect(mail.html).toContain("<!DOCTYPE html>");
    });

    it("names the instance as the sender when From has no name", async () => {
      await EmailAdapter.send(baseConfig, "Test", { title: "Test", success: true });

      expect(mockSendMail.mock.calls[0][0].from).toBe('"DBackup · Production" <backup@example.com>');
    });

    it("keeps a sender name that is set", async () => {
      await EmailAdapter.send({ ...baseConfig, from: "Ops <backup@example.com>" }, "Test", { title: "Test", success: true });

      expect(mockSendMail.mock.calls[0][0].from).toBe("Ops <backup@example.com>");
    });

    it("falls back to a plain subject for a caller that sends only text", async () => {
      const result = await EmailAdapter.send(baseConfig, "Test message", { success: true });

      expect(result).toBe(true);
      expect(mockSendMail.mock.calls[0][0].subject).toBe("DBackup notification");
    });

    it("should handle array of recipients", async () => {
      const multiConfig = {
        ...baseConfig,
        to: ["admin@example.com", "ops@example.com", "dev@example.com"],
      };

      await EmailAdapter.send(multiConfig, "Test", { title: "Test", success: true });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "admin@example.com, ops@example.com, dev@example.com",
        })
      );
    });

    it("should return false on send failure", async () => {
      mockSendMail.mockRejectedValueOnce(new Error("SMTP timeout"));

      const result = await EmailAdapter.send(baseConfig, "Test", { success: true });

      expect(result).toBe(false);
    });

    it("links its buttons to the address of the instance and says why it came", async () => {
      await EmailAdapter.send(baseConfig, "The run stopped.", {
        title: "postgres-nightly failed",
        success: false,
        actions: [{ label: "Open run", href: "/dashboard/history/run?id=e1&from=history", icon: "history" }],
        reason: "You get this through Ops mail.",
      });

      const html = mockSendMail.mock.calls[0][0].html;
      expect(html).toContain("https://docs.dbackup.app/logo.png");
      expect(html).toContain("https://backup.example.com/dashboard/history/run?id=e1&amp;from=history");
      expect(html).toContain("You get this through Ops mail.");
    });
  });
});
