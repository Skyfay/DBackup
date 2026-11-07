import { LogEntry } from "@/lib/core/logs";
import { SENSITIVE_KEYS } from "@/lib/crypto";

const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6_PATTERN = /\b(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}\b/g;
const CONNECTION_STRING_PATTERN = /((?:mongodb(?:\+srv)?|mysql|postgres(?:ql)?|redis|ftp|sftp):\/\/)[^@\s]+(@)/gi;
/**
 * The userinfo of a URI of SQL Server, HTTP(S), SMB and AMQP. It ends at the last `@` before the
 * path, so an `@` in the path of a web address, like `https://host/@user`, is no login.
 */
const URI_USERINFO_PATTERN = /((?:mssql|sqlserver|https?|smb|amqps?):\/\/)[^\s/?#]+(@)/gi;

function redactString(value: string): string {
  return value
    .replace(CONNECTION_STRING_PATTERN, "$1[CREDENTIALS REDACTED]$2")
    .replace(URI_USERINFO_PATTERN, "$1[CREDENTIALS REDACTED]$2")
    .replace(IPV4_PATTERN, "[IP REDACTED]")
    .replace(IPV6_PATTERN, "[IP REDACTED]");
}

function redactContext(ctx: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ctx)) {
    if (SENSITIVE_KEYS.includes(key)) {
      result[key] = "[REDACTED]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = redactContext(value as Record<string, unknown>);
    } else if (typeof value === "string") {
      result[key] = redactString(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function sanitizeLogs(logs: LogEntry[]): LogEntry[] {
  return logs.map((entry) => ({
    ...entry,
    message: redactString(entry.message),
    details: entry.details ? redactString(entry.details) : entry.details,
    context: entry.context ? redactContext(entry.context) : entry.context,
  }));
}
