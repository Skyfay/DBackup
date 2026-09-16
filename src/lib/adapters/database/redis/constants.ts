/**
 * Name of the single database entry a Redis or Valkey backup holds.
 *
 * An RDB snapshot always contains every logical database of the server, so it cannot be
 * split into one entry per database the way a SQL dump can. The archive stores it once,
 * under this name. Client-safe, the restore wizard derives the download name from it.
 */
export const REDIS_SNAPSHOT_ENTRY = "dump";
