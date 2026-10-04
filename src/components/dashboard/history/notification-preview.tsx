"use client";

import { useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import type { NotificationLogRow } from "./notification-types";

interface NotificationPreviewProps {
  entry: NotificationLogRow;
}

/** Parse JSON fields safely */
function parseFields(
  json?: string | null
): Array<{ name: string; value: string; inline?: boolean }> {
  if (!json) return [];
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

function parsePayload(json?: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ── Discord Embed Preview ──────────────────────────────────────

function DiscordPreview({ entry }: NotificationPreviewProps) {
  const { formatDate } = useDateFormatter();
  const payload = parsePayload(entry.renderedPayload);
  const embed = payload?.embeds
    ? (payload.embeds as Array<Record<string, unknown>>)[0]
    : null;
  const fields = parseFields(entry.fields);
  const color = entry.color || (entry.status === "Success" ? "#00ff00" : "#ff0000");

  // Group consecutive inline fields into rows of max 3, non-inline fields get their own row
  const fieldRows: Array<Array<{ name: string; value: string; inline?: boolean }>> = [];
  let currentInlineRow: Array<{ name: string; value: string; inline?: boolean }> = [];
  for (const field of fields) {
    if (field.inline !== false) {
      currentInlineRow.push(field);
      if (currentInlineRow.length === 3) {
        fieldRows.push(currentInlineRow);
        currentInlineRow = [];
      }
    } else {
      if (currentInlineRow.length > 0) {
        fieldRows.push(currentInlineRow);
        currentInlineRow = [];
      }
      fieldRows.push([field]);
    }
  }
  if (currentInlineRow.length > 0) fieldRows.push(currentInlineRow);

  return (
    <div className="bg-[#313338] rounded-lg p-4 max-w-lg font-sans">
      {/* Discord message wrapper */}
      <div className="flex gap-4">
        {/* Avatar */}
        <div className="shrink-0">
          <div className="w-10 h-10 rounded-full bg-[#5865F2] flex items-center justify-center text-white font-bold text-sm">
            DB
          </div>
        </div>
        <div className="flex-1 min-w-0">
          {/* Username + timestamp */}
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-white font-medium text-sm">Backup Manager</span>
            <span className="bg-[#5865F2] text-white text-[10px] font-semibold px-1 py-px rounded">APP</span>
            <span className="text-[#949BA4] text-xs">{formatDate(entry.sentAt, "p")}</span>
          </div>
          {/* Embed */}
          <div
            className="rounded overflow-hidden bg-[#2B2D31] mt-1"
            style={{ borderLeft: `4px solid ${color}` }}
          >
            <div className="p-4 space-y-2">
              {/* Title */}
              <div className="text-white font-semibold text-base">
                {(embed?.title as string) || entry.title}
              </div>
              {/* Description */}
              <div className="text-[#DBDEE1] text-sm whitespace-pre-wrap">
                {(embed?.description as string) || entry.message}
              </div>
              {/* Fields */}
              {fieldRows.length > 0 && (
                <div className="mt-3 space-y-3">
                  {fieldRows.map((row, rowIdx) => (
                    <div
                      key={rowIdx}
                      className="grid gap-2"
                      style={{ gridTemplateColumns: row.length > 1 ? `repeat(${row.length}, minmax(0, 1fr))` : "1fr" }}
                    >
                      {row.map((field, idx) => (
                        <div key={idx} className="min-w-0">
                          <div className="text-[#B5BAC1] text-xs font-bold">
                            {field.name}
                          </div>
                          <div className="text-[#DBDEE1] text-sm mt-0.5 wrap-break-word">{field.value}</div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {/* Timestamp */}
              <div className="text-[#949BA4] text-xs mt-3">
                {formatDate(entry.sentAt, "Pp")}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Slack Preview ──────────────────────────────────────────────

function SlackPreview({ entry }: NotificationPreviewProps) {
  const fields = parseFields(entry.fields);
  const color = entry.color || (entry.status === "Success" ? "#00ff00" : "#ff0000");

  return (
    <div className="bg-white dark:bg-[#1A1D21] rounded-lg p-4 max-w-lg font-sans">
      <div className="flex gap-3">
        {/* App icon */}
        <div className="shrink-0">
          <div className="w-9 h-9 rounded bg-[#2EB67D] flex items-center justify-center text-white font-bold text-xs">
            DB
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-foreground font-bold text-sm">DBackup</span>
            <span className="text-muted-foreground text-xs">APP</span>
          </div>
          {/* Message with color bar */}
          <div
            className="border-l-4 pl-3 py-1 space-y-2"
            style={{ borderColor: color }}
          >
            <div className="text-foreground font-bold text-sm">{entry.title}</div>
            <div className="text-muted-foreground text-sm whitespace-pre-wrap">
              {entry.message}
            </div>
            {fields.length > 0 && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {fields.map((field, idx) => (
                  <div key={idx} className={field.inline === false ? "col-span-2" : ""}>
                    <span className="text-foreground font-semibold text-xs">
                      {field.name}:
                    </span>{" "}
                    <span className="text-muted-foreground text-xs">{field.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Email HTML Preview ─────────────────────────────────────────

function EmailPreview({ entry }: NotificationPreviewProps) {
  if (entry.renderedHtml) {
    // Replace external logo URL with local path for preview rendering
    const previewHtml = entry.renderedHtml.replace(
      /https:\/\/docs\.dbackup\.app\/logo\.png/g,
      "/logo.svg"
    );
    return (
      <div className="bg-card rounded-lg overflow-hidden max-w-xl border border-border">
        <div className="bg-muted/50 border-b border-border px-4 py-2 flex items-center gap-2">
          {/* The buttons of a mail window, neutral, since they stand for no state. */}
          <div className="flex gap-1.5" aria-hidden="true">
            <div className="size-3 rounded-full bg-muted-foreground/25" />
            <div className="size-3 rounded-full bg-muted-foreground/25" />
            <div className="size-3 rounded-full bg-muted-foreground/25" />
          </div>
          <span className="text-xs text-muted-foreground ml-2">
            Subject: {entry.title}
          </span>
        </div>
        <iframe
          srcDoc={previewHtml}
          className="h-160 w-full border-0 bg-white"
          sandbox="allow-same-origin"
          title="Email Preview"
        />
      </div>
    );
  }

  // Fallback: plain text
  const fields = parseFields(entry.fields);
  return (
    <div className="bg-white dark:bg-card rounded-lg p-6 max-w-xl border border-border space-y-4">
      <h3 className="text-lg font-semibold text-foreground">{entry.title}</h3>
      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{entry.message}</p>
      {fields.length > 0 && (
        <div className="border rounded-md overflow-hidden">
          {fields.map((field, idx) => (
            <div
              key={idx}
              className="flex border-b last:border-b-0 text-sm"
            >
              <div className="w-36 bg-muted px-3 py-2 font-medium text-muted-foreground">
                {field.name}
              </div>
              <div className="flex-1 px-3 py-2 text-foreground">{field.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Telegram Preview ───────────────────────────────────────────

function TelegramPreview({ entry }: NotificationPreviewProps) {
  const { formatDate } = useDateFormatter();
  const fields = parseFields(entry.fields);
  return (
    <div className="bg-[#0E1621] rounded-lg p-4 max-w-sm">
      <div className="flex gap-3">
        <div className="shrink-0">
          <div className="w-8 h-8 rounded-full bg-[#64B5F6] flex items-center justify-center text-white text-xs font-bold">
            DB
          </div>
        </div>
        <div className="bg-[#182533] rounded-lg px-3 py-2 max-w-xs">
          <div className="text-[#64B5F6] text-sm font-semibold mb-1">DBackup Bot</div>
          <div className="text-white text-sm font-bold">{entry.title}</div>
          <div className="text-[#AAAAAA] text-sm mt-1 whitespace-pre-wrap">{entry.message}</div>
          {fields.length > 0 && (
            <div className="mt-2 space-y-1">
              {fields.map((field, idx) => (
                <div key={idx} className="text-xs">
                  <span className="text-[#64B5F6]">{field.name}:</span>{" "}
                  <span className="text-white">{field.value}</span>
                </div>
              ))}
            </div>
          )}
          <div className="text-[#6D7F8F] text-[10px] mt-2 text-right">
            {formatDate(entry.sentAt, "p")}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Teams Preview ──────────────────────────────────────────────

function TeamsPreview({ entry }: NotificationPreviewProps) {
  const fields = parseFields(entry.fields);
  const color = entry.color || (entry.status === "Success" ? "#00ff00" : "#ff0000");

  return (
    <div className="bg-white dark:bg-[#292929] rounded-lg max-w-lg border border-border overflow-hidden">
      <div style={{ borderTop: `4px solid ${color}` }} className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-[#6264A7] flex items-center justify-center text-white text-xs font-bold">
            DB
          </div>
          <div>
            <div className="text-foreground font-semibold text-sm">DBackup</div>
            <div className="text-muted-foreground text-xs">Connector</div>
          </div>
        </div>
        <h3 className="text-foreground font-semibold">{entry.title}</h3>
        <p className="text-muted-foreground text-sm whitespace-pre-wrap">{entry.message}</p>
        {fields.length > 0 && (
          <div className="space-y-1 text-sm">
            {fields.map((field, idx) => (
              <div key={idx} className="flex gap-2">
                <span className="text-muted-foreground font-medium min-w-24">{field.name}:</span>
                <span className="text-foreground">{field.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Generic / Plain Text Preview ───────────────────────────────

function GenericPreview({ entry }: NotificationPreviewProps) {
  const fields = parseFields(entry.fields);
  return (
    <div className="bg-card rounded-lg p-4 max-w-lg border border-border space-y-3">
      <h3 className="text-foreground font-semibold">{entry.title}</h3>
      <p className="text-muted-foreground text-sm whitespace-pre-wrap">{entry.message}</p>
      {fields.length > 0 && (
        <div className="border rounded-md overflow-hidden text-sm">
          {fields.map((field, idx) => (
            <div key={idx} className="flex border-b last:border-b-0">
              <div className="w-36 bg-muted px-3 py-2 font-medium text-muted-foreground">
                {field.name}
              </div>
              <div className="flex-1 px-3 py-2 text-foreground">{field.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Adapter Preview Map ────────────────────────────────────────

const PREVIEW_COMPONENTS: Record<
  string,
  React.FC<NotificationPreviewProps>
> = {
  discord: DiscordPreview,
  email: EmailPreview,
  slack: SlackPreview,
  telegram: TelegramPreview,
  teams: TeamsPreview,
};

// ── Main Preview Component ─────────────────────────────────────

/** The name of a channel on the tab of its look. */
const CHANNEL_NAMES: Record<string, string> = { discord: "Discord", email: "Email", slack: "Slack", telegram: "Telegram", teams: "Teams" };

/** The payload as it went out, indented when it is JSON and as it is when it is not. */
function rawText(entry: NotificationLogRow): string {
  if (entry.renderedHtml) return entry.renderedHtml;
  if (!entry.renderedPayload) return "No payload available";
  const parsed = parsePayload(entry.renderedPayload);
  return parsed ? JSON.stringify(parsed, null, 2) : entry.renderedPayload;
}

/** The scroll height of a view, on the viewport, where a max height takes effect. */
const VIEW_HEIGHT = "*:data-[slot=scroll-area-viewport]:max-h-[60vh]";

/**
 * What a notification said, as its channel shows it, as plain text and as the payload that went
 * out. The panel around it names the channel, whether it arrived and why not, so this starts with
 * the message itself.
 */
export function NotificationPreview({ entry }: NotificationPreviewProps) {
  const PreviewComponent = PREVIEW_COMPONENTS[entry.adapterId] || GenericPreview;
  const fields = parseFields(entry.fields);

  // Determine which tabs to show
  const hasAdapterPreview = entry.adapterId in PREVIEW_COMPONENTS;
  const hasRawPayload = !!entry.renderedPayload || !!entry.renderedHtml;

  const defaultTab = useMemo(() => {
    if (hasAdapterPreview) return "preview";
    return "plain";
  }, [hasAdapterPreview]);

  return (
    <Tabs defaultValue={defaultTab} className="w-full">
      <TabsList className="h-8">
        {hasAdapterPreview && (
          <TabsTrigger value="preview" className="px-2.5 text-xs">{CHANNEL_NAMES[entry.adapterId] ?? "Preview"}</TabsTrigger>
        )}
        <TabsTrigger value="plain" className="px-2.5 text-xs">Plain text</TabsTrigger>
        {hasRawPayload && <TabsTrigger value="raw" className="px-2.5 text-xs">Raw payload</TabsTrigger>}
      </TabsList>

      {hasAdapterPreview && (
        <TabsContent value="preview" className="mt-4">
          <ScrollArea className={VIEW_HEIGHT}>
            <PreviewComponent entry={entry} />
          </ScrollArea>
        </TabsContent>
      )}

      <TabsContent value="plain" className="mt-4">
        <div className="space-y-3">
          <h4 className="font-semibold text-foreground">{entry.title}</h4>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{entry.message}</p>
          {fields.length > 0 && (
            <div className="border rounded-md overflow-hidden text-sm">
              {fields.map((field, idx) => (
                <div key={idx} className="flex border-b last:border-b-0">
                  <div className="w-36 bg-muted px-3 py-2 font-medium text-muted-foreground">{field.name}</div>
                  <div className="flex-1 px-3 py-2 text-foreground">{field.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </TabsContent>

      {hasRawPayload && (
        <TabsContent value="raw" className="mt-4">
          {/* Wraps a long token like a key instead of scrolling sideways, the view scrolls down. */}
          <ScrollArea className={VIEW_HEIGHT}>
            <pre className="rounded-lg bg-muted p-4 font-mono text-xs text-foreground whitespace-pre-wrap wrap-anywhere">{rawText(entry)}</pre>
          </ScrollArea>
        </TabsContent>
      )}
    </Tabs>
  );
}
