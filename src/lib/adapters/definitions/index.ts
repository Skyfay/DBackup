import { z } from "zod";
import { ADAPTER_CREDENTIAL_REQUIREMENTS } from "@/lib/core/credential-requirements";
import { DEFAULT_S3_UPLOAD_TUNING, type AdapterDefinition } from "./shared";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import {
    MySQLSchema, MariaDBSchema, PostgresSchema, MongoDBSchema,
    SQLiteSchema, MSSQLSchema, AzureSQLSchema, RedisSchema, FirebirdSchema,
} from "./database";
import {
    LocalStorageSchema, S3GenericSchema, S3AWSSchema, S3R2Schema, S3HetznerSchema,
    SFTPSchema, SMBSchema, WebDAVSchema, FTPSchema, RsyncSchema,
    GoogleDriveSchema, DropboxSchema, OneDriveSchema, DockerVolumeSchema,
} from "./storage";
import {
    DiscordSchema, SlackSchema, TeamsSchema, GenericWebhookSchema,
    GotifySchema, NtfySchema, TelegramSchema, TwilioSmsSchema, EmailSchema,
} from "./notification";

// Re-export everything for backward compatibility
export * from "./shared";
export * from "./database";
export * from "./storage";
export * from "./notification";

export const ADAPTER_DEFINITIONS: AdapterDefinition[] = [
    { id: "mysql", type: "database", group: "Relational", name: "MySQL", configSchema: MySQLSchema },
    { id: "mariadb", type: "database", group: "Relational", name: "MariaDB", configSchema: MariaDBSchema },
    { id: "postgres", type: "database", group: "Relational", name: "PostgreSQL", configSchema: PostgresSchema },
    { id: "mongodb", type: "database", group: "Document", name: "MongoDB", configSchema: MongoDBSchema },
    { id: "sqlite", type: "database", group: "File based", name: "SQLite", configSchema: SQLiteSchema },
    { id: "mssql", type: "database", group: "Relational", name: "Microsoft SQL Server", configSchema: MSSQLSchema },
    { id: "azure-sql", type: "database", group: "Relational", name: "Azure SQL Database", beta: true, configSchema: AzureSQLSchema },
    { id: "redis", type: "database", group: "Key value", name: "Redis", configSchema: RedisSchema },
    { id: "valkey", type: "database", group: "Key value", name: "Valkey", configSchema: RedisSchema },
    { id: "firebird", type: "database", group: "Relational", name: "Firebird", beta: true, configSchema: FirebirdSchema },

    { id: "local-filesystem", type: "storage", group: "Local", name: "Local Filesystem", configSchema: LocalStorageSchema },
    {
        id: "docker-volume", type: "storage", group: "Containers", name: "Docker Volumes",
        beta: true, configSchema: DockerVolumeSchema,
        // No primary credential: the Docker socket has no authentication of its own, so
        // reaching the host that owns it is the entire access question.
        credentials: { ssh: "SSH_KEY" },
        // Somewhere to read data out of, never somewhere to put archives.
        supportedRoles: [STORAGE_ROLES.SOURCE],
        // A volume is a name, not a folder. Nothing to expand into, and "back up everything"
        // has to mean "tick them all" rather than a root path the adapter cannot mount.
        flatBrowse: true,
        browseNoun: "volume",
        // Reading a volume is one tar stream and ignores this entirely. Writing one is not:
        // a restore puts each file back with its own API request, so the round trip is the
        // limit exactly as it is over SFTP - and the same measurement applies, where many
        // small files gain roughly linearly up to eight.
        //
        // It was 1 here at first, reasoned only about the read path, which quietly held every
        // restore to one file at a time.
        transferConcurrency: { default: 4, max: 8 },
    },
    // The four S3 adapters share one upload path and one range. The AWS SDK's own defaults are
    // 4 parts of 5 MB, which measured 27 MB/s against R2 on a 10 Gbit link while everything
    // local in the same run moved at over 230 MB/s. See `s3-upload-tuning.ts` for the numbers
    // and for why the two values have to be set together.
    { id: "s3-aws", type: "storage", group: "Cloud Storage (S3)", name: "Amazon S3", configSchema: S3AWSSchema, multipartUpload: DEFAULT_S3_UPLOAD_TUNING },
    { id: "s3-generic", type: "storage", group: "Cloud Storage (S3)", name: "S3 Compatible (Generic)", configSchema: S3GenericSchema, multipartUpload: DEFAULT_S3_UPLOAD_TUNING },
    { id: "s3-r2", type: "storage", group: "Cloud Storage (S3)", name: "Cloudflare R2", configSchema: S3R2Schema, multipartUpload: DEFAULT_S3_UPLOAD_TUNING },
    { id: "s3-hetzner", type: "storage", group: "Cloud Storage (S3)", name: "Hetzner Object Storage", configSchema: S3HetznerSchema, multipartUpload: DEFAULT_S3_UPLOAD_TUNING },
    { id: "google-drive", type: "storage", group: "Cloud Drives", name: "Google Drive", configSchema: GoogleDriveSchema },
    {
        id: "dropbox", type: "storage", group: "Cloud Drives", name: "Dropbox", configSchema: DropboxSchema,
        // Dropbox throttles concurrent writes per account rather than refusing them outright, so
        // some parallelism genuinely pays: measured on a 130-file restore, ten at a time finished
        // in ~64s (with retries along the way) where one at a time took ~219s. Four is the middle
        // ground - most of the speed, far fewer collisions than ten. It is the ceiling as well as
        // the default, because the throttle is per account: no connection setting can raise it,
        // and offering a higher number would only trade throughput for retries.
        transferConcurrency: { default: 4, max: 4 },
    },
    { id: "onedrive", type: "storage", group: "Cloud Drives", name: "Microsoft OneDrive", configSchema: OneDriveSchema },
    {
        id: "sftp", type: "storage", group: "Network", name: "SFTP (SSH)", configSchema: SFTPSchema,
        // Every transfer is a fresh SSH login, and OpenSSH starts refusing connections above
        // `MaxStartups` - ten concurrent unauthenticated ones by default. Eight leaves room for
        // the administrator's own session and anything else logging in at that moment, which a
        // backup quietly taking the last slots would otherwise lock out.
        //
        // The ceiling follows from opening one connection per transfer, not from the protocol -
        // see PERF-SFTP-MULTIPLEX in `src/lib/adapters/storage/sftp.ts`. The reasoning here used
        // to end with "raising it buys little, one transfer already fills a fast link". That
        // holds for large files and is wrong for many small ones, where round trips are the
        // limit: measured over a ~40 ms link, 766 files of ~23 KB took 88s at four and 45s at
        // eight. Linear, with no sign of the link being the constraint.
        transferConcurrency: { default: 4, max: 8 },
    },
    {
        id: "ftp", type: "storage", group: "Network", name: "FTP / FTPS", configSchema: FTPSchema,
        // FTP spends two sockets on every concurrent transfer - a control connection and a
        // separate data connection - and servers commonly cap connections per client address at
        // around five (vsftpd's max_per_ip, ProFTPD's MaxClientsPerHost). Two transfers stay
        // under that on any such server; four needs one configured more generously, which is why
        // it is the ceiling rather than the default.
        transferConcurrency: { default: 2, max: 4 },
    },
    { id: "webdav", type: "storage", group: "Network", name: "WebDAV", configSchema: WebDAVSchema },
    { id: "smb", type: "storage", group: "Network", name: "SMB (Samba)", configSchema: SMBSchema },
    {
        id: "rsync", type: "storage", group: "Network", name: "Rsync (SSH)", configSchema: RsyncSchema,
        // Every transfer is a fresh SSH login, and OpenSSH starts refusing connections above
        // `MaxStartups` - ten concurrent unauthenticated ones by default. Eight leaves room for
        // the administrator's own session and anything else logging in at that moment, which a
        // backup quietly taking the last slots would otherwise lock out. Raising the ceiling buys
        // little in any case: with 64 chunks in flight per file, one transfer already fills a
        // fast link, so past a handful of files the limit is the link rather than the count.
        transferConcurrency: { default: 4, max: 8 },
    },

    { id: "discord", type: "notification", group: "Chat", name: "Discord Webhook", configSchema: DiscordSchema },
    { id: "slack", type: "notification", group: "Chat", name: "Slack Webhook", configSchema: SlackSchema },
    { id: "teams", type: "notification", group: "Chat", name: "Microsoft Teams", configSchema: TeamsSchema },
    { id: "generic-webhook", type: "notification", group: "Webhook", name: "Generic Webhook", configSchema: GenericWebhookSchema },
    { id: "gotify", type: "notification", group: "Push", name: "Gotify", configSchema: GotifySchema },
    { id: "ntfy", type: "notification", group: "Push", name: "ntfy", configSchema: NtfySchema },
    { id: "telegram", type: "notification", group: "Chat", name: "Telegram", configSchema: TelegramSchema },
    { id: "twilio-sms", type: "notification", group: "Email and SMS", name: "SMS (Twilio)", configSchema: TwilioSmsSchema },
    { id: "email", type: "notification", group: "Email and SMS", name: "Email (SMTP)", configSchema: EmailSchema },
];

// Attach credential requirements to every definition for the client form layer.
for (const def of ADAPTER_DEFINITIONS) {
    const reqs = ADAPTER_CREDENTIAL_REQUIREMENTS[def.id];
    if (reqs) def.credentials = reqs;
}

// Every storage adapter can carry a parallel-transfer count, so the field belongs on all of
// their schemas rather than being repeated in thirteen places. It has to be *in* the schema:
// the connection form validates through zodResolver, and Zod drops keys it does not know - a
// value set on an unlisted field is discarded in the browser and never reaches the server.
//
// Deliberately unbounded here beyond "a whole number of at least one". The real ceiling differs
// per adapter and can be lowered in a later version; a bound baked into validation would then
// make an existing connection unsaveable until its value was corrected by hand. Clamping to the
// adapter's range happens where the value is read, in `resolveTransferConcurrency`.
for (const def of ADAPTER_DEFINITIONS) {
    if (def.type !== "storage") continue;
    def.configSchema = def.configSchema.extend({
        maxConcurrentFiles: z.coerce.number().int().min(1).optional(),
    });
}

// Same reasoning one step narrower: only an adapter that declares multipart upload carries the
// two fields, because on anything else they would be stored and never read. Bounded only by
// what the S3 protocol itself refuses - a part below 5 MB - for the same reason as above, so
// lowering a ceiling in a later version cannot make an existing connection unsaveable.
// Clamping to the adapter's range happens in `resolveS3UploadTuning`.
for (const def of ADAPTER_DEFINITIONS) {
    if (!def.multipartUpload) continue;
    def.configSchema = def.configSchema.extend({
        uploadConcurrency: z.coerce.number().int().min(1).optional(),
        uploadPartSizeMb: z.coerce.number().int().min(5).optional(),
    });
}

export function getAdapterDefinition(id: string) {
    return ADAPTER_DEFINITIONS.find(d => d.id === id);
}
