/**
 * The largest configuration backup Restore from a file takes. The middleware holds the body of every
 * request for itself up to proxyClientMaxBodySize, which next.config.ts sets a little above this, so
 * a bigger upload reaches the route whole and is refused there instead of arriving cut off. A bigger
 * file is restored from its destination on the Backups page, which reads it on the server.
 */
export const CONFIG_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** What the files of an upload may take, leaving room for the rest of the form. */
export const CONFIG_UPLOAD_FILES_MAX_BYTES = CONFIG_UPLOAD_MAX_BYTES - 64 * 1024;

export const CONFIG_UPLOAD_TOO_BIG = "The file is larger than 10 MB. Restore it from its destination on the Backups page, under Config backups.";
