export const STORAGE_CONNECTION_KEYS = [
    'host', 'port',
    'endpoint', 'region',
    'accountId', 'bucket', 'basePath',
    'address', 'domain', 'url',
    'user', 'username',
    'password', 'accessKeyId', 'secretAccessKey',
    'authType',
    'privateKey', 'passphrase',
    'clientId', 'clientSecret',
];

export const STORAGE_CONFIG_KEYS = ['pathPrefix', 'storageClass', 'forcePathStyle', 'maxProtocol', 'tls', 'options', 'folderId', 'folderPath'];

export const NOTIFICATION_CONNECTION_KEYS = [
    'webhookUrl',
    'host', 'port', 'secure',
    'user', 'password',
    'method', 'contentType', 'authHeader',
    'serverUrl', 'appToken', 'accessToken', 'topic',
    'botToken', 'chatId',
    'accountSid', 'authToken', 'from', 'to',
];

export const NOTIFICATION_CONFIG_KEYS = ['from', 'to', 'username', 'avatarUrl', 'channel', 'iconEmoji', 'customHeaders', 'payloadTemplate', 'priority', 'parseMode', 'disableNotification'];

export const PLACEHOLDERS: Record<string, string> = {
    "email.from": "\"Backup Service\" <backup@example.com>",
    "email.host": "smtp.example.com",
    "email.user": "user@example.com",
    "from": "name@example.com",
    "to": "admin@example.com",
    "host": "localhost",
    // DB Ports
    "mysql.port": "3306",
    "mariadb.port": "3306",
    "postgres.port": "5432",
    "mongodb.port": "27017",
    "mssql.port": "1433",
    "redis.port": "6379",
    "email.port": "587",
    "mongodb.uri": "mongodb://user:password@localhost:27017/db?authSource=admin",

    // MSSQL Paths, SSH & Timeout
    "mssql.backupPath": "/var/opt/mssql/backup",
    "mssql.localBackupPath": "/tmp",
    "mssql.requestTimeout": "300000",
    "mssql.sshPort": "22",
    "mssql.sshPrivateKey": "-----BEGIN RSA PRIVATE KEY-----\n\n\n-----END RSA PRIVATE KEY-----",
    // Options Examples
    "mysql.options": "--single-transaction --quick",
    "postgres.options": "--clean --if-exists",
    "mongodb.options": "--gzip --oplog",

    // SQLite
    "sqlite.port": "22",
    "sqlite.privateKey": "-----BEGIN RSA PRIVATE KEY-----\n\n\n-----END RSA PRIVATE KEY-----",

    // S3 Placeholders
    "bucket": "my-backup-bucket",
    "pathPrefix": "backups/prod",
    "accessKeyId": "AKIA...",
    "secretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",

    // AWS Specific
    "s3-aws.region": "us-east-1",

    // S3 Generic
    "s3-generic.endpoint": "https://s3.custom-provider.com",
    "s3-generic.region": "us-east-1",

    // R2 Specific
    "s3-r2.accountId": "32c49e7943c49e7943c49e7943c49e79",

    // Hetzner Specific (Enum default handles region, but just in case)
    "s3-hetzner.pathPrefix": "server1/mysql",

    // SFTP
    "sftp.host": "sftp.example.com",
    "sftp.port": "22",
    "sftp.username": "backup-user",
    "sftp.password": "secure-password",
    "sftp.privateKey": "-----BEGIN RSA PRIVATE KEY-----\n\n\n-----END RSA PRIVATE KEY-----",
    "sftp.pathPrefix": "/home/backup/uploads",

    // SMB
    "smb.address": "//fileserver/backups",
    "smb.username": "backupuser",
    "smb.password": "secure-password",
    "smb.domain": "WORKGROUP",
    "smb.pathPrefix": "server1/mysql",

    // WebDAV
    "webdav.url": "https://nextcloud.example.com/remote.php/dav/files/user/",
    "webdav.username": "backupuser",
    "webdav.password": "secure-password",
    "webdav.pathPrefix": "backups/server1",

    // FTP
    "ftp.host": "ftp.example.com",
    "ftp.port": "21",
    "ftp.username": "backup-user",
    "ftp.password": "secure-password",
    "ftp.pathPrefix": "/backups/server1",

    // Rsync
    "rsync.host": "backup-server.example.com",
    "rsync.port": "22",
    "rsync.username": "backup-user",
    "rsync.password": "secure-password",
    "rsync.privateKey": "-----BEGIN RSA PRIVATE KEY-----\n\n\n-----END RSA PRIVATE KEY-----",
    "rsync.pathPrefix": "/backups/server1",
    "rsync.options": "--bwlimit=5000 --compress",

    // Google Drive
    "google-drive.clientId": "123456789-abc.apps.googleusercontent.com",
    "google-drive.clientSecret": "GOCSPX-...",
    "google-drive.folderId": "1AbCdEfGhIjKlMnOpQrStUvWxYz (optional)",

    // Dropbox
    "dropbox.clientId": "your-app-key",
    "dropbox.clientSecret": "your-app-secret",
    "dropbox.folderPath": "/backups (optional)",

    // OneDrive
    "onedrive.clientId": "00000000-0000-0000-0000-000000000000",
    "onedrive.clientSecret": "your-client-secret",
    "onedrive.folderPath": "/backups (optional)",

    // Slack
    "slack.webhookUrl": "https://hooks.slack.com/services/T.../B.../...",
    "slack.channel": "#backups",
    "slack.username": "DBackup",
    "slack.iconEmoji": ":shield:",

    // Teams
    "teams.webhookUrl": "https://xxx.webhook.office.com/webhookb2/...",

    // Generic Webhook
    "generic-webhook.webhookUrl": "https://example.com/webhook",
    "generic-webhook.authHeader": "Bearer your-token-here",
    "generic-webhook.customHeaders": "X-Custom: value",
    "generic-webhook.payloadTemplate": "{\"text\": \"{{title}}: {{message}}\"}",

    // Gotify
    "gotify.serverUrl": "https://gotify.example.com",
    "gotify.appToken": "AbCdEf12345",
    "gotify.priority": "5",

    // ntfy
    "ntfy.serverUrl": "https://ntfy.sh",
    "ntfy.topic": "dbackup-alerts",
    "ntfy.accessToken": "tk_...",
    "ntfy.priority": "3",

    // Telegram
    "telegram.botToken": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
    "telegram.chatId": "-1001234567890",

    // Twilio SMS
    "twilio-sms.accountSid": "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "twilio-sms.authToken": "your-auth-token",
    "twilio-sms.from": "+1234567890",
    "twilio-sms.to": "+0987654321",
};
