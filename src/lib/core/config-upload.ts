/**
 * The largest configuration backup Restore from a file takes. The middleware holds the body of
 * every request for itself and cuts it off after 10 MB (Next.js proxyClientMaxBodySize), so a
 * bigger upload would arrive broken. A bigger file is restored from its destination on the Backups
 * page, which reads it on the server.
 */
export const CONFIG_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** What the files of an upload may take, leaving room for the rest of the form. */
export const CONFIG_UPLOAD_FILES_MAX_BYTES = CONFIG_UPLOAD_MAX_BYTES - 64 * 1024;

export const CONFIG_UPLOAD_TOO_BIG = "The file is larger than 10 MB. Restore it from its destination on the Backups page, under Config backups.";
