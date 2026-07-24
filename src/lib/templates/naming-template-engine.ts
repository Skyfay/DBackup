import { formatInTimeZone } from "date-fns-tz";
import { format } from "date-fns";

export interface NamingTokenInfo {
  token: string;
  description: string;
}

export interface NamingTokenGroup {
  group: string;
  tokens: NamingTokenInfo[];
}

export const NAMING_TOKEN_GROUPS: NamingTokenGroup[] = [
  {
    group: "Job Info",
    tokens: [
      { token: "{job_name}", description: "Job name (sanitized)" },
      { token: "{db_name}", description: "Database name(s)" },
    ],
  },
  {
    group: "Date",
    tokens: [
      { token: "yyyy", description: "4-digit year (2026)" },
      { token: "MM", description: "2-digit month (01-12)" },
      { token: "MMM", description: "Short month name (Jan)" },
      { token: "MMMM", description: "Full month name (January)" },
      { token: "dd", description: "2-digit day (01-31)" },
    ],
  },
  {
    group: "Time",
    tokens: [
      { token: "HH", description: "Hour, 24h (00-23)" },
      { token: "mm", description: "Minute (00-59)" },
      { token: "ss", description: "Second (00-59)" },
    ],
  },
  {
    group: "Chain",
    tokens: [
      { token: "{chain}", description: "Position in an incremental chain (full-000, inc-001). Empty for other jobs - an adjacent _ or - is dropped with it" },
    ],
  },
];

/**
 * How a chain member is written into a filename: type plus zero-padded position.
 *
 * Zero-padded so a plain `ls` lists a chain in order, and shared with the upload step so the
 * name it prepends when a template has no {chain} token is identical to what the token
 * produces.
 */
export function chainSegment(type: "full" | "incremental", index: number): string {
  return `${type === "full" ? "full" : "inc"}-${String(index).padStart(3, "0")}`;
}

/**
 * Substitutes {chain}, taking one adjacent separator with it when there is nothing to insert.
 *
 * Without this a pattern like `{job_name}_HH-mm-ss_{chain}` would leave a trailing underscore
 * on every non-incremental backup. Only `_` and `-` count as separators - a `.` is left alone
 * because it usually belongs to the extension that follows.
 *
 * A token between two separators keeps exactly one, so `A_{chain}_B` collapses to `A_B`
 * rather than `A__B`. Separators the user wrote anywhere else are untouched.
 */
function applyChainToken(pattern: string, chain: string): string {
  return pattern.replace(/([_-]?)\{chain\}([_-]?)/g, (_match, lead: string, trail: string) =>
    chain ? `${lead}${chain}${trail}` : (lead && trail ? lead : "")
  );
}

function applyDateTokens(
  pattern: string,
  date: Date,
  timezone?: string
): string {
  const fmt = (token: string) =>
    timezone ? formatInTimeZone(date, timezone, token) : format(date, token);

  // Process longer tokens first to avoid partial matches (MMMM before MMM before MM)
  return pattern
    .replace(/MMMM/g, fmt("MMMM"))
    .replace(/MMM/g, fmt("MMM"))
    .replace(/yyyy/g, fmt("yyyy"))
    .replace(/MM/g, fmt("MM"))
    .replace(/dd/g, fmt("dd"))
    .replace(/HH/g, fmt("HH"))
    .replace(/mm/g, fmt("mm"))
    .replace(/ss/g, fmt("ss"));
}

/** True when the pattern positions the chain segment itself, so nothing has to be prepended. */
export function patternUsesChain(pattern: string): boolean {
  return /\{chain\}/.test(pattern);
}

export function applyNamingPattern(
  pattern: string,
  jobName: string,
  dbName: string,
  date: Date,
  timezone: string = "UTC",
  chain: string = ""
): string {
  // Apply date tokens first so that date-like substrings in job/db names
  // (e.g. 'mm' in 'Immich') are never misinterpreted as format tokens.
  const withDates = applyDateTokens(pattern, date, timezone);

  const result = applyChainToken(withDates, chain)
    .replace(/{job_name}/g, jobName)
    .replace(/{db_name}/g, dbName);

  // A pattern of nothing but {chain} resolves to an empty name on a non-incremental run,
  // which would produce a file called just ".tar". Fall back to something addressable. An
  // empty pattern is left alone - that is the caller's own contract, not a collapse.
  if (pattern.trim() && !result.trim()) {
    return `${jobName}_${applyDateTokens("yyyy-MM-dd_HH-mm-ss", date, timezone)}`;
  }
  return result;
}

export function previewPattern(pattern: string, chain: string = ""): string {
  try {
    const withDates = applyDateTokens(pattern, new Date());

    const result = applyChainToken(withDates, chain)
      .replace(/{job_name}/g, "JobName")
      .replace(/{db_name}/g, "mydb");

    if (pattern.trim() && !result.trim()) {
      return `JobName_${applyDateTokens("yyyy-MM-dd_HH-mm-ss", new Date())}`;
    }
    return result;
  } catch {
    return "Invalid pattern";
  }
}
