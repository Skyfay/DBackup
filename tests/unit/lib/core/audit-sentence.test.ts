import { describe, expect, it } from "vitest";
import { auditSentence, describeEntry } from "@/lib/core/audit-sentence";

const entry = (action: string, resource: string, details?: Record<string, unknown>) => ({ action, resource, details: details ? JSON.stringify(details) : null });

describe("an entry of the audit log as a sentence", () => {
    it("says how someone signed in, and through which provider", () => {
        expect(auditSentence(entry("LOGIN", "AUTH", { method: "web-ui" }))).toBe("Signed in");
        expect(auditSentence(entry("LOGIN", "AUTH", { method: "passkey" }))).toBe("Signed in with a passkey");
        expect(auditSentence(entry("LOGIN", "AUTH", { method: "two-factor" }))).toBe("Signed in with a password and a second factor");
        expect(auditSentence(entry("LOGIN", "AUTH", { method: "sso", provider: "Authentik" }))).toBe("Signed in through Authentik");
        expect(auditSentence(entry("LOGOUT", "AUTH"))).toBe("Signed out");
    });

    it("says someone signed up through a provider, and the group it put them in", () => {
        expect(auditSentence(entry("CREATE", "USER", { name: "Tom Weber", via: "sso", provider: "Authentik", group: "Operators" }))).toBe("Signed up through Authentik into the group Operators");
        expect(auditSentence(entry("CREATE", "USER", { name: "Tom Weber", via: "sso", provider: "Pocket ID" }))).toBe("Signed up through Pocket ID");
        expect(auditSentence(entry("CREATE", "USER", { name: "Tom Weber" }))).toBe("Created the user Tom Weber");
    });

    it("names the account a failed sign-in tried and marks it as failed", () => {
        const failed = describeEntry(entry("LOGIN_FAILED", "AUTH", { email: "admin@example.ch", reason: "unknown_email" }));

        expect(failed.parts).toEqual([{ text: "A sign-in as " }, { text: "admin@example.ch", strong: true }, { text: " failed" }]);
        expect(failed.kind).toBe("failed");
    });

    it("names what was made or deleted in bold when the entry holds its name", () => {
        expect(describeEntry(entry("CREATE", "ADAPTER", { name: "db-prod" })).parts).toEqual([{ text: "Created " }, { text: "the connection " }, { text: "db-prod", strong: true }]);
        expect(auditSentence(entry("DELETE", "API_KEY"))).toBe("Deleted an API key");
        expect(auditSentence(entry("CREATE", "JOB", { name: "Shop copy", clonedFromName: "Shop nightly" }))).toBe("Created the job Shop copy as a copy of Shop nightly");
    });

    it("takes the name of the record from the caller when the entry did not keep it", () => {
        expect(auditSentence(entry("EXECUTE", "JOB", { executionId: "e1", trigger: "manual" }))).toBe("Started a job");
        expect(auditSentence(entry("EXECUTE", "JOB", { executionId: "e1" }), "Shop nightly")).toBe("Started the job Shop nightly");
        expect(auditSentence(entry("UPDATE", "USER", { change: "Password Set" }), "Lena Graf")).toBe("Set a new password for Lena Graf");
        expect(auditSentence(entry("UPDATE", "USER", { change: "Sessions Revoked", count: 2 }), "Lena Graf")).toBe("Signed out Lena Graf everywhere");
    });

    it("tells the kinds of templates apart and counts a bulk action", () => {
        expect(auditSentence(entry("CREATE", "TEMPLATE", { type: "RetentionPolicy", name: "Keep 30" }))).toBe("Created the retention policy Keep 30");
        expect(auditSentence(entry("DELETE", "TEMPLATE", { type: "RetentionPolicy", bulk: true, succeeded: 3 }))).toBe("Deleted 3 retention policies");
        expect(auditSentence(entry("DELETE", "TEMPLATE", { type: "RetentionPolicy", bulk: true }))).toBe("Deleted several retention policies");
    });

    it("tells restores, downloads and reveals apart, all of them sensitive", () => {
        const restore = describeEntry(entry("RESTORE", "BACKUP", { action: "restore", file: "shop/2026-09-29.tar.gz", target: "db-prod" }));
        expect(restore.parts.map((part) => part.text).join("")).toBe("Restored 2026-09-29.tar.gz into db-prod");
        expect(restore.kind).toBe("sensitive");

        expect(auditSentence(entry("EXPORT", "BACKUP", { action: "download_link", file: "a.tar" }))).toBe("Downloaded a.tar through a link");
        expect(auditSentence(entry("EXPORT", "BACKUP", { action: "download_link_created", file: "shop/a.tar" }))).toBe("Made a download link for a.tar");
        expect(auditSentence(entry("EXPORT", "VAULT", { action: "recovery_kit_download" }))).toBe("Downloaded a recovery kit");
        expect(auditSentence(entry("EXPORT", "CREDENTIAL", { action: "reveal", name: "S3 Hetzner" }))).toBe("Revealed the secret of S3 Hetzner");
        expect(auditSentence(entry("EXPORT", "CREDENTIAL"))).toBe("Revealed a secret");
        expect(auditSentence(entry("RESTORE", "SYSTEM", { action: "config_restore", file: "config/2026-09-28.tar.gz.enc" }))).toBe("Restored the configuration from 2026-09-28.tar.gz.enc");
    });

    it("says what a change of state was", () => {
        expect(auditSentence(entry("UPDATE", "API_KEY", { name: "CI pipeline", action: "rotate" }))).toBe("Rotated the API key CI pipeline");
        expect(auditSentence(entry("UPDATE", "API_KEY", { name: "CI pipeline", enabled: false }))).toBe("Disabled the API key CI pipeline");
        expect(auditSentence(entry("UPDATE", "BACKUP", { action: "lock", file: "shop/a.tar" }))).toBe("Locked the backup a.tar");
        expect(auditSentence(entry("UPDATE", "JOB", { action: "cancel", name: "Shop nightly" }))).toBe("Cancelled a run of the job Shop nightly");
        expect(auditSentence(entry("UPDATE", "SYSTEM", { area: "Data retention", changes: [] }))).toBe("Changed the settings of Data retention");
    });

    it("tells a delete into Recently deleted from one for good, and a restore from there", () => {
        expect(auditSentence(entry("DELETE", "JOB", { name: "Shop nightly" }))).toBe("Deleted the job Shop nightly");
        expect(auditSentence(entry("DELETE", "VAULT", { type: "EncryptionProfile", name: "Offsite 2025", permanently: true }))).toBe("Deleted the encryption key Offsite 2025 permanently");
        expect(auditSentence(entry("DELETE", "USER", { bulk: true, succeeded: 2, permanently: true }))).toBe("Deleted 2 users permanently");
        expect(auditSentence(entry("DELETE", "ADAPTER", { name: "Old NAS", action: "trash_purge", permanently: true }))).toBe("Removed the connection Old NAS from Recently deleted");

        const restored = describeEntry(entry("RESTORE", "USER", { name: "Jana Keller", action: "trash_restore" }));
        expect(restored.parts.map((part) => part.text).join("")).toBe("Restored the user Jana Keller from Recently deleted");
        expect(restored.kind).toBe("sensitive");
    });

    it("stays general for details it cannot read", () => {
        expect(auditSentence({ action: "UPDATE", resource: "JOB", details: "not json" })).toBe("Changed a job");
        expect(auditSentence(entry("UPDATE", "SOMETHING_NEW"))).toBe("Changed an entry");
    });
});
