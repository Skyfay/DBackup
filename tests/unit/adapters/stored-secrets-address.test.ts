// @vitest-environment node
/**
 * The secrets of a saved connection are filled into a config of its form only while that config
 * connects where the saved one does. A form that points the connection at another server, port,
 * SSH host or webhook with the secret left blank has to bring the secret itself, typed in or from
 * a saved login, or the saved password, key or token would go to a server of its choosing on a
 * test, a browse or a save.
 */
import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/logging/errors";
import { LOGIN_FOR_NEW_ADDRESS, mergeStoredSecrets, SECRETS_FOR_NEW_ADDRESS, type AssignedLogins } from "@/lib/adapters/stored-secrets";

type Config = Record<string, unknown>;

const LOGIN: AssignedLogins = { primaryCredentialId: "login-1" };
const BOTH: AssignedLogins = { primaryCredentialId: "login-1", sshCredentialId: "ssh-1" };

const merge = (adapterId: string, submitted: Config, stored: Config, logins: AssignedLogins = {}) =>
    mergeStoredSecrets(adapterId, submitted, stored, logins) as Config;

/** The request is refused with the sentence for a typed secret or for a saved login. */
const refused = (adapterId: string, submitted: Config, stored: Config, message: string, logins: AssignedLogins = {}) => {
    expect(() => merge(adapterId, submitted, stored, logins)).toThrow(ValidationError);
    expect(() => merge(adapterId, submitted, stored, logins)).toThrow(message);
};

describe("a database source", () => {
    const stored = { host: "db.local", port: 5432, user: "backup", password: "pw", database: "app", options: "--no-owner" };

    it("keeps its password when the name, user, databases or options change", () => {
        expect(merge("postgres", { host: "db.local", port: 5432, user: "admin", database: "shop", options: "" }, stored).password).toBe("pw");
    });

    it("keeps its password for the same host written another way", () => {
        expect(merge("postgres", { host: " DB.local ", port: "5432" }, stored).password).toBe("pw");
    });

    it("keeps an older saved config without a port, which the form now fills with its default", () => {
        expect(merge("mysql", { host: "db.local", port: 3306 }, { host: "db.local", password: "pw" }).password).toBe("pw");
    });

    it("never sends the saved password to another host, another port or an added host of a list", () => {
        refused("postgres", { host: "evil.example.com", port: 5432 }, stored, LOGIN_FOR_NEW_ADDRESS);
        refused("postgres", { host: "db.local", port: 6543 }, stored, LOGIN_FOR_NEW_ADDRESS);
        refused("postgres", { host: "db.local,evil.example.com", port: 5432 }, stored, LOGIN_FOR_NEW_ADDRESS);
    });

    it("leaves the saved password behind for a new host that a saved login signs in to", () => {
        const merged = merge("postgres", { host: "db2.local", port: 5432, user: "backup" }, stored, LOGIN);

        expect(merged).toEqual({ host: "db2.local", port: 5432, user: "backup" });
    });

    it("takes another host with the password sent along for it", () => {
        expect(merge("postgres", { host: "db2.local", port: 5432, password: "new" }, stored)).toMatchObject({ host: "db2.local", password: "new" });
    });

    it("asks to type the MongoDB connection string again for another host, saved login or not", () => {
        refused("mongodb", { host: "evil.example.com", port: 27017 }, { host: "db.local", port: 27017, uri: "mongodb://u:pw@db.local:27017/app" }, SECRETS_FOR_NEW_ADDRESS, LOGIN);
    });
});

describe("a source over SSH", () => {
    const stored = {
        host: "127.0.0.1", port: 3306, password: "db-pw",
        connectionMode: "ssh", sshHost: "jump.example.com", sshPort: 22, sshUsername: "root", sshPassword: "ssh-pw",
    };
    const blank = { ...stored, password: "", sshPassword: "" };

    it("keeps both secrets while the SSH server and the database behind it stay", () => {
        expect(merge("mysql", { ...blank, sshUsername: "backup" }, stored)).toMatchObject({ password: "db-pw", sshPassword: "ssh-pw" });
    });

    it("sends neither to another SSH server, another SSH port or another database behind it", () => {
        refused("mysql", { ...blank, sshHost: "evil.example.com" }, stored, LOGIN_FOR_NEW_ADDRESS);
        refused("mysql", { ...blank, sshPort: 2222 }, stored, LOGIN_FOR_NEW_ADDRESS);
        refused("mysql", { ...blank, host: "evil.internal" }, stored, LOGIN_FOR_NEW_ADDRESS);
    });

    it("needs a saved login for each slot whose secret stays behind", () => {
        // A login for the database alone leaves the SSH password without one.
        refused("mysql", { ...blank, sshHost: "jump2.example.com" }, stored, LOGIN_FOR_NEW_ADDRESS, LOGIN);
        expect(merge("mysql", { ...blank, sshHost: "jump2.example.com" }, stored, BOTH)).toEqual({ ...blank, sshHost: "jump2.example.com" });
    });

    it("sends nothing through an SSH server of the form when a direct connection switches to SSH", () => {
        refused("mysql", { host: "db.local", port: 3306, connectionMode: "ssh", sshHost: "evil.example.com", sshUsername: "x" }, { host: "db.local", port: 3306, password: "db-pw" }, LOGIN_FOR_NEW_ADDRESS);
    });

    it("sends the SSH key of SQLite to no other host", () => {
        refused("sqlite", { mode: "ssh", host: "evil.example.com", path: "/srv/app.db" }, { mode: "ssh", host: "files.local", path: "/srv/app.db", privateKey: "KEY" }, LOGIN_FOR_NEW_ADDRESS);
    });
});

describe("a destination", () => {
    it("keeps the password of an SFTP server when its folder changes, not when its server does", () => {
        const stored = { host: "nas.local", port: 22, username: "backup", password: "pw", pathPrefix: "/backups" };
        expect(merge("sftp", { host: "nas.local", port: 22, username: "backup", pathPrefix: "/other" }, stored).password).toBe("pw");
        refused("sftp", { host: "evil.example.com", port: 22, username: "backup", pathPrefix: "/backups" }, stored, LOGIN_FOR_NEW_ADDRESS);
    });

    it("keeps the keys of S3 when only the bucket changes, not when the endpoint does", () => {
        const stored = { endpoint: "https://s3.example.com", bucket: "backups", accessKeyId: "AK", secretAccessKey: "SK" };
        expect(merge("s3-generic", { endpoint: "https://s3.example.com", bucket: "archive" }, stored)).toMatchObject({ accessKeyId: "AK", secretAccessKey: "SK" });
        refused("s3-generic", { endpoint: "https://evil.example.com", bucket: "backups" }, stored, LOGIN_FOR_NEW_ADDRESS);
        refused("s3-generic", { endpoint: "https://s3.example.com:9443", bucket: "backups" }, stored, LOGIN_FOR_NEW_ADDRESS);
    });

    it("sends the password of WebDAV to no other server and not over plain HTTP", () => {
        const stored = { url: "https://cloud.example.com/dav", username: "me", password: "pw" };
        expect(merge("webdav", { url: "https://cloud.example.com/dav/other", username: "me" }, stored).password).toBe("pw");
        refused("webdav", { url: "https://evil.example.com/dav", username: "me" }, stored, LOGIN_FOR_NEW_ADDRESS);
        refused("webdav", { url: "http://cloud.example.com/dav", username: "me" }, stored, LOGIN_FOR_NEW_ADDRESS);
    });

    it("keeps the tokens of a cloud drive, whose provider is the only place they go", () => {
        const stored = { clientId: "id", clientSecret: "secret", refreshToken: "refresh", folderId: "root" };
        expect(merge("google-drive", { clientId: "other-id", folderId: "backups" }, stored)).toMatchObject({ clientSecret: "secret", refreshToken: "refresh" });
        expect(merge("onedrive", { clientId: "id", folderPath: "/x" }, stored)).toMatchObject({ refreshToken: "refresh" });
        expect(merge("dropbox", { clientId: "id", folderPath: "/x" }, stored)).toMatchObject({ refreshToken: "refresh" });
    });
});

describe("a notification channel", () => {
    it("keeps a webhook that is itself the secret when it is left blank, and takes a new one sent along", () => {
        const stored = { webhookUrl: "https://discord.com/api/webhooks/1/abc", username: "DBackup" };
        expect(merge("discord", { webhookUrl: "", username: "Backups" }, stored).webhookUrl).toBe(stored.webhookUrl);
        expect(merge("discord", { webhookUrl: "https://hooks.example.com/hook", username: "Backups" }, stored).webhookUrl).toBe("https://hooks.example.com/hook");
    });

    it("sends the authorization header of a webhook to no other server", () => {
        refused("generic-webhook", { webhookUrl: "https://evil.example.com/hook" }, { webhookUrl: "https://hooks.example.com/in", authHeader: "Bearer secret" }, LOGIN_FOR_NEW_ADDRESS);
    });

    it("sends the token of Gotify or ntfy to no other server", () => {
        refused("gotify", { serverUrl: "https://evil.example.com" }, { serverUrl: "https://push.example.com", appToken: "tok" }, LOGIN_FOR_NEW_ADDRESS);
        refused("ntfy", { serverUrl: "https://evil.example.com", topic: "x" }, { serverUrl: "https://ntfy.sh", topic: "x", accessToken: "tok" }, LOGIN_FOR_NEW_ADDRESS);
        expect(merge("gotify", { serverUrl: "https://push.example.com", priority: 8 }, { serverUrl: "https://push.example.com", appToken: "tok" }).appToken).toBe("tok");
    });

    it("keeps the tokens of Telegram and Twilio, whose endpoint the adapter fixes", () => {
        expect(merge("telegram", { chatId: "42" }, { chatId: "1", botToken: "bot" }).botToken).toBe("bot");
        expect(merge("twilio-sms", { from: "+1", to: "+2" }, { from: "+1", to: "+3", accountSid: "AC", authToken: "tok" })).toMatchObject({ accountSid: "AC", authToken: "tok" });
    });

    it("sends the SMTP password to no other mail server or port", () => {
        const stored = { host: "smtp.example.com", port: 587, user: "me", password: "pw", from: "a@example.com" };
        expect(merge("email", { host: "smtp.example.com", port: 587, user: "me", from: "b@example.com" }, stored).password).toBe("pw");
        refused("email", { host: "evil.example.com", port: 587, user: "me" }, stored, LOGIN_FOR_NEW_ADDRESS);
        refused("email", { host: "smtp.example.com", port: 2525, user: "me" }, stored, LOGIN_FOR_NEW_ADDRESS);
    });
});
