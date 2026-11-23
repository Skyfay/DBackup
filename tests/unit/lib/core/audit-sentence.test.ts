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

    it("says an account joined a tenant through its provider, and the group it got there", () => {
        const joined = { name: "Lena Graf", via: "sso", change: "Joined through single sign-on", provider: "Acme Entra ID", group: "Viewer" };
        expect(auditSentence(entry("UPDATE", "USER", joined))).toBe("Joined through Acme Entra ID into the group Viewer");
        expect(auditSentence(entry("UPDATE", "USER", { change: "Joined through single sign-on" }))).toBe("Joined through single sign-on");
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
        expect(auditSentence(entry("EXECUTE", "BACKUP", { action: "verify", file: "nightly.tar" }))).toMatch(/^Checked /);
        expect(auditSentence(entry("UPDATE", "USER", { change: "Password Set" }), "Lena Graf")).toBe("Set a new password for Lena Graf");
        expect(auditSentence(entry("UPDATE", "USER", { change: "Sessions Revoked", count: 2 }), "Lena Graf")).toBe("Signed out Lena Graf everywhere");
    });

    it("names the user and the group a change of the group gave, from the entry itself", () => {
        expect(auditSentence(entry("UPDATE", "USER", { change: "Updating Group", name: "Lena Graf", groupId: "g-view", group: "Viewers" }))).toBe("Changed the group of Lena Graf to Viewers");
        expect(auditSentence(entry("UPDATE", "USER", { change: "Updating Group", name: "Lena Graf", groupId: "none" }))).toBe("Changed the group of Lena Graf");
        // An entry of an earlier version kept neither.
        expect(auditSentence(entry("UPDATE", "USER", { change: "Updating Group", groupId: "g-view" }), "Lena")).toBe("Changed the group of Lena");
    });

    it("tells the kinds of templates apart and counts a bulk action", () => {
        expect(auditSentence(entry("CREATE", "TEMPLATE", { type: "RetentionPolicy", name: "Keep 30" }))).toBe("Created the retention policy Keep 30");
        expect(auditSentence(entry("DELETE", "TEMPLATE", { type: "RetentionPolicy", bulk: true, succeeded: 3 }))).toBe("Deleted 3 retention policies");
        expect(auditSentence(entry("DELETE", "TEMPLATE", { type: "RetentionPolicy", bulk: true }))).toBe("Deleted several retention policies");
    });

    it("names what a bulk action changed, the first three and how many more", () => {
        expect(auditSentence(entry("DELETE", "API_KEY", { bulk: true, succeeded: 2, names: ["CI pipeline", "Deploy"] }))).toBe("Deleted 2 API keys: CI pipeline, Deploy");
        expect(auditSentence(entry("UPDATE", "API_KEY", { bulk: true, enabled: false, succeeded: 5, names: ["A", "B", "C", "D", "E"] }))).toBe("Changed 5 API keys: A, B, C and 2 more");
        expect(auditSentence(entry("DELETE", "USER", { bulk: true, succeeded: 2, permanently: true, names: ["Lena", "Tom"] }))).toBe("Deleted 2 users permanently: Lena, Tom");
        expect(describeEntry(entry("DELETE", "GROUP", { bulk: true, succeeded: 1, names: ["Operators"] })).parts).toContainEqual({ text: "Operators", strong: true });
    });

    it("says which test notification went out, and to the recipients of which channel", () => {
        expect(describeEntry(entry("EXECUTE", "SYSTEM", { name: "A restore fails", action: "notification_test" }))).toEqual({
            parts: [{ text: "Sent a test of " }, { text: "A restore fails", strong: true }], glyph: "play", kind: "run",
        });
        expect(auditSentence(entry("EXECUTE", "ADAPTER", { name: "Team mail", action: "recipients_test" }))).toBe("Sent a test to the own recipients of the connection Team mail");
    });

    it("says which connection was tested and whose databases were read", () => {
        expect(auditSentence(entry("EXECUTE", "ADAPTER", { action: "connection_test", name: "Shop MySQL", adapter: "mysql", success: true }))).toBe("Tested the connection Shop MySQL");
        expect(auditSentence(entry("EXECUTE", "ADAPTER", { action: "connection_test", adapter: "mysql", success: false }))).toBe("Tested a new connection");
        expect(auditSentence(entry("EXECUTE", "ADAPTER", { action: "ssh_test", adapter: "mssql", host: "db1.example.ch", success: true }))).toBe("Tested the SSH login to db1.example.ch");
        expect(auditSentence(entry("EXECUTE", "SOURCE", { action: "databases_read", name: "Shop MySQL", count: 1 }))).toBe("Read the databases of the source Shop MySQL");
        expect(auditSentence(entry("EXECUTE", "SOURCE", { action: "databases_read", count: 4, all: true }))).toBe("Read the databases of every source");
        expect(auditSentence(entry("EXECUTE", "SOURCE", { action: "databases_read", count: 3 }))).toBe("Read the databases of 3 sources");
        expect(auditSentence(entry("EXECUTE", "SOURCE", { action: "databases_read", form: true, adapter: "mysql", success: true }))).toBe("Read the databases of a new connection");
    });

    it("says whose folders a picker browsed and which server was asked for its snapshots", () => {
        expect(auditSentence(entry("EXECUTE", "ADAPTER", { action: "folder_browse", adapter: "sftp", host: "nas.example.ch", success: true }))).toBe("Browsed the folders of nas.example.ch");
        expect(auditSentence(entry("EXECUTE", "ADAPTER", { action: "folder_browse", local: true, success: true }))).toBe("Browsed the folders of the server DBackup runs on");
        expect(auditSentence(entry("EXECUTE", "ADAPTER", { action: "folder_browse", adapter: "dropbox", success: false }))).toBe("Browsed the folders of a connection");
        expect(auditSentence(entry("EXECUTE", "ADAPTER", { action: "snapshot_check", adapter: "smb", host: "fs1.example.ch", success: true }))).toBe("Checked the snapshots of fs1.example.ch");
        expect(auditSentence(entry("EXECUTE", "ADAPTER", { action: "snapshot_check", adapter: "smb", success: false }))).toBe("Checked the snapshots of a server");
    });

    it("says at which address a sign-in provider was checked", () => {
        expect(auditSentence(entry("EXECUTE", "SSO_PROVIDER", { action: "sso_check", adapter: "keycloak", host: "auth.example.ch", success: true }))).toBe("Checked the sign-in provider at auth.example.ch");
        expect(auditSentence(entry("EXECUTE", "SSO_PROVIDER", { action: "sso_check", adapter: "keycloak", success: false }))).toBe("Checked the sign-in provider at an address");
    });

    it("names the saved connection a picker read, its volumes, a folder of a restore target and a login it checked", () => {
        expect(auditSentence(entry("EXECUTE", "ADAPTER", { action: "folder_browse", name: "Office NAS", adapter: "sftp", success: true }))).toBe("Browsed the folders of the connection Office NAS");
        expect(auditSentence(entry("EXECUTE", "ADAPTER", { action: "volume_list", name: "Immich host", adapter: "docker-volume", success: true }))).toBe("Listed the Docker volumes of the connection Immich host");
        expect(auditSentence(entry("EXECUTE", "ADAPTER", { action: "volume_sizes", name: "Immich host", success: false }))).toBe("Measured the Docker volumes of the connection Immich host");
        expect(auditSentence(entry("EXECUTE", "ADAPTER", { action: "path_check", name: "Office NAS", path: "photos/2026", success: true }))).toBe("Checked whether the folder photos/2026 of the connection Office NAS holds files");
        expect(auditSentence(entry("EXECUTE", "ADAPTER", { action: "path_check", path: "", success: true }))).toBe("Checked whether the top folder of a connection holds files");
        expect(auditSentence(entry("EXECUTE", "CREDENTIAL", { action: "token_check", name: "Acme Dropbox", adapter: "dropbox", success: true }))).toBe("Checked the authorization of the credential profile Acme Dropbox");
        expect(auditSentence(entry("EXECUTE", "ADAPTER", { action: "storage_check", names: ["Office NAS", "R2"], success: true }))).toBe("Listed the backups at the destinations again: Office NAS, R2");
    });

    it("tells a key tried on a backup that changed nothing in the Vault", () => {
        expect(auditSentence(entry("EXECUTE", "VAULT", { action: "key_check", file: "shop/2026-10-01.tar", destination: "Office NAS", success: false }))).toBe("Tried a key on 2026-10-01.tar at Office NAS, it did not open it");
        expect(auditSentence(entry("EXECUTE", "VAULT", { action: "key_check", file: "shop/2026-10-01.tar", keyName: "Office key", success: true }))).toBe("Tried a key on 2026-10-01.tar, it is the key Office key");
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
        expect(auditSentence(entry("EXPORT", "SOURCE", { action: "table_data", name: "Shop DB", database: "shop", table: "orders", page: 2 }))).toBe("Read the rows of orders of shop on Shop DB");
        expect(auditSentence(entry("EXPORT", "SOURCE", { action: "table_list", name: "Shop DB", database: "shop" }))).toBe("Listed the tables of shop on Shop DB");
        expect(auditSentence(entry("RESTORE", "SYSTEM", { action: "config_restore", file: "config/2026-09-28.tar.gz.enc" }))).toBe("Restored the configuration from 2026-09-28.tar.gz.enc");
    });

    it("names a group the platform makes for tenants apart from the groups of a tenant", () => {
        expect(auditSentence(entry("CREATE", "GROUP", { name: "Client", forTenants: true }))).toBe("Created the group for tenants Client");
        expect(auditSentence(entry("CREATE", "GROUP", { name: "Client", fromPlatform: true }))).toBe("Created the group Client");
    });

    it("names the database, the server and the customer of a customer's restore in the log of the server's tenant", () => {
        const restore = describeEntry(entry("RESTORE", "BACKUP", { action: "shared_restore", name: "shop2", server: "Shared MySQL", tenant: "Acme" }));
        expect(restore.parts.map((part) => part.text).join("")).toBe("Restored shop2 on Shared MySQL for Acme");
        expect(restore.kind).toBe("sensitive");
        expect(auditSentence(entry("RESTORE", "BACKUP", { action: "shared_restore" }))).toBe("Restored a shared database");
    });

    it("says that the terms of a shared connection changed, apart from who gets it", () => {
        expect(auditSentence(entry("UPDATE", "ADAPTER", { name: "Mail", action: "shareTerms", changes: [{ field: "Who gets the mail", from: "a", to: "b" }] })))
            .toBe("Changed the sharing terms of the connection Mail");
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

    it("names the platform groups of the MSP and who got one", () => {
        expect(auditSentence(entry("CREATE", "PLATFORM_GROUP", { name: "Support", scope: "All tenants, new ones too" }))).toBe("Created the platform group Support");
        expect(auditSentence(entry("UPDATE", "PLATFORM_GROUP", { name: "Support", areas: [] }))).toBe("Changed the platform group Support");
        expect(auditSentence(entry("DELETE", "PLATFORM_GROUP", { name: "Support", members: 3 }))).toBe("Deleted the platform group Support");
        expect(auditSentence(entry("UPDATE", "USER", { change: "Platform group set", from: "No platform group", to: "Support" }), "Lena Graf")).toBe("Changed the platform group of Lena Graf");
        expect(auditSentence(entry("UPDATE", "USER", { change: "Made platform admin" }), "Lena Graf")).toBe("Made Lena Graf a platform admin");
    });

    it("names the account of a change of how it signs in, and the tenant of an invitation, from the entry itself", () => {
        expect(auditSentence(entry("UPDATE", "USER", { change: "Password Set", name: "Lena Graf", signedOut: 2 }))).toBe("Set a new password for Lena Graf");
        expect(auditSentence(entry("UPDATE", "USER", { change: "Sessions Revoked", name: "Lena Graf", count: 1 }))).toBe("Signed out Lena Graf everywhere");
        expect(auditSentence(entry("UPDATE", "USER", { change: "Made platform admin", name: "Lena Graf" }))).toBe("Made Lena Graf a platform admin");
        // An invitation changes no tenant, so it never reads as one created or deleted.
        expect(auditSentence(entry("CREATE", "TENANT", { change: "Invitation created", name: "Acme GmbH", group: "Operators" }))).toBe("Made an invitation to Acme GmbH");
        expect(auditSentence(entry("DELETE", "TENANT", { change: "Invitation revoked", name: "Acme GmbH", group: "Operators" }))).toBe("Revoked an invitation to Acme GmbH");
        expect(auditSentence(entry("UPDATE", "TENANT", { change: "Invitation accepted", name: "Acme GmbH", joined: true }))).toBe("Accepted an invitation to Acme GmbH");
        expect(auditSentence(entry("DELETE", "AUTH", { change: "SSO account unlinked", name: "Authentik", providerId: "authentik" }))).toBe("Unlinked the sign-in through Authentik");
        expect(auditSentence(entry("DELETE", "AUTH", { change: "SSO account unlinked", providerId: "authentik" }))).toBe("Unlinked a single sign-on account");
    });

    it("stays general for details it cannot read", () => {
        expect(auditSentence({ action: "UPDATE", resource: "JOB", details: "not json" })).toBe("Changed a job");
        expect(auditSentence(entry("UPDATE", "SOMETHING_NEW"))).toBe("Changed an entry");
    });
});
