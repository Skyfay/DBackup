"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { NotificationLogRow } from "./notification-log-columns";

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
  const payload = parsePayload(entry.renderedPayload);
  const embed = payload?.embeds
    ? (payload.embeds as Array<Record<string, unknown>>)[0]
    : null;
  const fields = parseFields(entry.fields);
  const color = entry.color || (entry.status === "Success" ? "#00ff00" : "#ff0000");

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
            <span className="text-[#949BA4] text-xs">Today</span>
          </div>
          {/* Embed */}
          <div
            className="rounded bg-[#2B2D31] overflow-hidden"
            style={{ borderLeft: `4px solid ${color}` }}
          >
            <div className="p-3 space-y-2">
              {/* Title */}
              <div className="text-white font-semibold text-sm">
                {(embed?.title as string) || entry.title}
              </div>
              {/* Description */}
              <div className="text-[#DBDEE1] text-sm whitespace-pre-wrap">
                {(embed?.description as string) || entry.message}
              </div>
              {/* Fields */}
              {fields.length > 0 && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {fields.map((field, idx) => (
                    <div
                      key={idx}
                      className={field.inline === false ? "col-span-2" : ""}
                    >
                      <div className="text-[#949BA4] text-xs font-semibold uppercase">
                        {field.name}
                      </div>
                      <div className="text-[#DBDEE1] text-sm">{field.value}</div>
                    </div>
                  ))}
                </div>
              )}
              {/* Timestamp */}
              <div className="text-[#949BA4] text-xs mt-2">
                {new Date(entry.sentAt).toLocaleString()}
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
          <div className="w-9 h-9 rounded bg-emerald-600 flex items-center justify-center text-white font-bold text-xs">
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
    return (
      <div className="bg-white rounded-lg overflow-hidden max-w-xl border border-border">
        <div className="bg-muted/50 border-b border-border px-4 py-2 flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-400" />
            <div className="w-3 h-3 rounded-full bg-yellow-400" />
            <div className="w-3 h-3 rounded-full bg-green-400" />
          </div>
          <span className="text-xs text-muted-foreground ml-2">
            Subject: {entry.title}
          </span>
        </div>
        <iframe
          srcDoc={entry.renderedHtml}
          className="w-full border-0"
          style={{ minHeight: 400 }}
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
            {new Date(entry.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
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

export function NotificationPreview({ entry }: NotificationPreviewProps) {
  const PreviewComponent =
    PREVIEW_COMPONENTS[entry.adapterId] || GenericPreview;
  const fields = parseFields(entry.fields);

  // Determine which tabs to show
  const hasAdapterPreview = entry.adapterId in PREVIEW_COMPONENTS;
  const hasRawPayload = !!entry.renderedPayload || !!entry.renderedHtml;

  const defaultTab = useMemo(() => {
    if (hasAdapterPreview) return "preview";
    return "plain";
  }, [hasAdapterPreview]);

  return (
    <div className="space-y-4">
      {/* Metadata header */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{entry.adapterId}</Badge>
        <Badge
          className={
            entry.status === "Success"
              ? "bg-[hsl(145,78%,45%)] text-white border-transparent"
              : "bg-[hsl(357,78%,54%)] text-white border-transparent"
          }
        >
          {entry.status === "Success" ? "Sent" : "Failed"}
        </Badge>
        {entry.error && (
          <span className="text-xs text-destructive">{entry.error}</span>
        )}
      </div>

      <Tabs defaultValue={defaultTab} className="w-full">
        <TabsList>
          {hasAdapterPreview && (
            <TabsTrigger value="preview">
              {entry.adapterId.charAt(0).toUpperCase() + entry.adapterId.slice(1)} Preview
            </TabsTrigger>
          )}
          <TabsTrigger value="plain">Plain Text</TabsTrigger>
          {hasRawPayload && (
            <TabsTrigger value="raw">Raw Payload</TabsTrigger>
          )}
        </TabsList>

        {hasAdapterPreview && (
          <TabsContent value="preview" className="mt-4">
            <ScrollArea className="max-h-[60vh]">
              <PreviewComponent entry={entry} />
            </ScrollArea>
          </TabsContent>
        )}

        <TabsContent value="plain" className="mt-4">
          <div className="space-y-3">
            <h4 className="font-semibold text-foreground">{entry.title}</h4>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {entry.message}
            </p>
            {fields.length > 0 && (
              <div className="border rounded-md overflow-hidden text-sm">
                {fields.map((field, idx) => (
                  <div key={idx} className="flex border-b last:border-b-0">
                    <div className="w-36 bg-muted px-3 py-2 font-medium text-muted-foreground">
                      {field.name}
                    </div>
                    <div className="flex-1 px-3 py-2 text-foreground">
                      {field.value}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {hasRawPayload && (
          <TabsContent value="raw" className="mt-4">
            <ScrollArea className="max-h-[60vh]">
              <pre className="bg-muted rounded-lg p-4 text-xs font-mono text-foreground whitespace-pre-wrap overflow-x-auto">
                {entry.renderedHtml
                  ? entry.renderedHtml
                  : entry.renderedPayload
                    ? JSON.stringify(JSON.parse(entry.renderedPayload), null, 2)
                    : "No payload available"}
              </pre>
            </ScrollArea>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
