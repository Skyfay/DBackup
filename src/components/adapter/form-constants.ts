export const STORAGE_CONNECTION_KEYS = [
    'host', 'port',
    'endpoint', 'region',
    'accountId', 'bucket', 'basePath',
    'address', 'domain', 'url',
    'user', 'username',
    'password', 'accessKeyId', 'secretAccessKey',
    'privateKey', 'passphrase'
];

export const STORAGE_CONFIG_KEYS = ['pathPrefix', 'storageClass', 'forcePathStyle', 'maxProtocol', 'options'];

export const PLACEHOLDERS: Record<string, string> = {
    "email.from": "\"Backup Service\" <backup@example.com>",
    "email.host": "smtp.example.com",
    "email.user": "user@example.com",
    "from": "name@example.com",
    "to": "admin@example.com",
    "host": "localhost",
    // DB Ports
    "mysql.port": "3306",
    "postgres.port": "5432",
    "mongodb.port": "27017",
    "email.port": "587",
    "mongodb.uri": "mongodb://user:password@localhost:27017/db?authSource=admin",
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
};
