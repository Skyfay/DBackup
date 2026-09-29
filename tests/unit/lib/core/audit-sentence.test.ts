import { describe, expect, it } from "vitest";
import { auditSentence } from "@/lib/core/audit-sentence";

const entry = (action: string, resource: string, details?: Record<string, unknown>) => ({ action, resource, details: details ? JSON.stringify(details) : null });

describe("an entry of the audit log as a sentence", () => {
    it("says a sign-in and a sign-out plainly", () => {
        expect(auditSentence(entry("LOGIN", "AUTH", { method: "web-ui" }))).toBe("Signed in");
        expect(auditSentence(entry("LOGOUT", "AUTH"))).toBe("Signed out");
    });

    it("names what was made or deleted when the entry holds its name", () => {
        expect(auditSentence(entry("CREATE", "ADAPTER", { name: "db-prod", type: "database" }))).toBe("Created the connection db-prod");
        expect(auditSentence(entry("DELETE", "API_KEY"))).toBe("Deleted an API key");
    });

    it("tells the kinds of templates apart", () => {
        expect(auditSentence(entry("CREATE", "TEMPLATE", { type: "RetentionPolicy", name: "Keep 30" }))).toBe("Created the retention policy Keep 30");
        expect(auditSentence(entry("DELETE", "TEMPLATE", { type: "RetentionPolicy", bulk: true }))).toBe("Deleted several retention policies");
    });

    it("says what happened to a user", () => {
        expect(auditSentence(entry("UPDATE", "USER", { change: "Password Set" }))).toBe("Set a new password for a user");
        expect(auditSentence(entry("UPDATE", "USER", { change: "Two-Factor Reset" }))).toBe("Reset the second factor of a user");
        expect(auditSentence(entry("UPDATE", "USER", { name: "Lena Graf" }))).toBe("Changed the user Lena Graf");
    });

    it("tells runs, downloads and reveals apart", () => {
        expect(auditSentence(entry("EXECUTE", "JOB", { executionId: "e1", trigger: "manual" }))).toBe("Ran a job");
        expect(auditSentence(entry("EXPORT", "DESTINATION", { action: "download_link", file: "a.tar" }))).toBe("Downloaded a backup");
        expect(auditSentence(entry("EXPORT", "VAULT", { action: "recovery_kit_download" }))).toBe("Downloaded a recovery kit");
        expect(auditSentence(entry("EXPORT", "CREDENTIAL"))).toBe("Revealed a secret");
    });

    it("stays general for details it cannot read", () => {
        expect(auditSentence({ action: "UPDATE", resource: "JOB", details: "not json" })).toBe("Changed a job");
        expect(auditSentence(entry("UPDATE", "SOMETHING_NEW"))).toBe("Changed an entry");
    });
});
