import Image from "next/image";
import type { PostCover, PostTone } from "@/lib/blog";
import { cn } from "@/lib/utils";

export const TONE_RGB: Record<PostTone, string> = {
  blue: "96 165 250",
  green: "52 211 153",
  violet: "167 139 250",
  cyan: "34 211 238",
  amber: "251 191 36",
};

const TONE_VAR: Record<PostTone, string> = {
  blue: "var(--tone-blue)",
  green: "var(--tone-green)",
  violet: "var(--tone-violet)",
  cyan: "var(--tone-cyan)",
  amber: "var(--tone-amber)",
};

const FALLBACK: PostCover = { badge: "DB", tone: "blue", snippet: "" };

/**
 * The artwork on top of a post card: its illustration when it has one, else a
 * glow, the badge tile and a terminal line.
 */
export function PostCoverArt({
  cover = FALLBACK,
  image,
  className,
}: {
  cover?: PostCover;
  image?: string | null;
  className?: string;
}) {
  const color = TONE_VAR[cover.tone];
  if (image) {
    return (
      <span aria-hidden="true" className={cn("relative block h-[180px] overflow-hidden border-b border-border bg-[#0a0a0b]", className)}>
        <Image src={image} alt="" fill sizes="(min-width: 1024px) 480px, (min-width: 768px) 50vw, 100vw" className="object-cover" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="relative block h-[180px] overflow-hidden border-b border-border bg-background dark:bg-[#0d0d0f]">
      <span className="bg-dot-grid absolute inset-0 [background-size:16px_16px]" />
      <span
        className="absolute -top-[60px] left-1/2 -ml-[130px] h-[180px] w-[260px] rounded-full"
        style={{ background: color, filter: "blur(50px)", opacity: "calc(0.35 * var(--glow-strength))" }}
      />
      {cover.snippet && (
        <span className="absolute inset-x-[18px] bottom-[18px] rounded-[10px] border border-border-strong bg-surface/85 px-3 py-2.5 font-mono text-xs leading-[1.7] whitespace-pre text-subtle">
          {cover.snippet}
        </span>
      )}
      <PostBadge cover={cover} className="absolute top-[18px] left-[18px]" />
    </span>
  );
}

export function PostBadge({ cover = FALLBACK, className }: { cover?: PostCover; className?: string }) {
  const rgb = TONE_RGB[cover.tone];
  return (
    <span
      className={cn("flex size-11 items-center justify-center rounded-xl text-[11px] font-bold tracking-[0.04em]", className)}
      style={{
        background: `rgb(${rgb} / 0.16)`,
        color: TONE_VAR[cover.tone],
        boxShadow: `0 0 24px rgb(${rgb} / 0.35)`,
      }}
    >
      {cover.badge}
    </span>
  );
}

const KIND_TONE: Record<string, string> = {
  Full: "bg-tone-blue/14 text-tone-blue-soft",
  Incr: "bg-tone-violet/14 text-tone-violet",
};

/** The folder of files on the large card of the newest post. */
export function PostFiles({ cover }: { cover: PostCover }) {
  return (
    <span aria-hidden="true" className="relative block h-[280px] overflow-hidden rounded-2xl border border-border bg-background dark:bg-[#0d0d0f]">
      <span className="bg-dot-grid absolute inset-0 [background-size:18px_18px]" />
      <span className="absolute inset-x-6 top-6 flex flex-col gap-2">
        {cover.path && <span className="font-mono text-xs text-faint">{cover.path}</span>}
        {(cover.files ?? []).map((f) => (
          <span
            key={f.name}
            className="flex items-center gap-2.5 rounded-[10px] border border-border bg-surface/90 px-2.5 py-2"
          >
            <span className={cn("w-[38px] rounded-md py-0.5 text-center text-[11px] font-semibold", KIND_TONE[f.kind] ?? KIND_TONE.Full)}>
              {f.kind}
            </span>
            <span className="grow font-mono text-xs text-subtle">{f.name}</span>
            <span className="text-xs text-muted-foreground">{f.size}</span>
          </span>
        ))}
      </span>
      {cover.command && (
        <span className="absolute inset-x-6 bottom-5 truncate rounded-[10px] border border-border bg-surface/80 px-3 py-2 font-mono text-xs whitespace-pre text-tone-green">
          {cover.command.replace(/\s+#.*$/, "")}
          <span className="text-faint">{cover.command.match(/\s+#.*$/)?.[0]}</span>
        </span>
      )}
    </span>
  );
}
