import { isValidElement, type ReactNode } from "react";
import { Info, TriangleAlert } from "lucide-react";
import { CodeBlock } from "@/components/site/code-block";
import { slugify } from "@/lib/blog";
import { cn } from "@/lib/utils";

// Components the blog posts can use in their MDX. Props are plain strings,
// since next-mdx-remote leaves out JavaScript expressions in MDX.

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

function H2({ children }: { children?: ReactNode }) {
  return <h2 id={slugify(textOf(children))}>{children}</h2>;
}

/** A side by side table of a chunk store and DBackup. */
function Compare({ left, right, children }: { left: string; right: string; children?: ReactNode }) {
  return (
    <div className="not-prose my-8 overflow-x-auto rounded-[18px] border border-border bg-card">
      <div className="min-w-[520px]">
        <div className="grid grid-cols-[minmax(140px,200px)_1fr_1fr] border-b border-border text-[13px] font-semibold">
          <span className="px-4 py-3.5 font-medium text-faint">Compared</span>
          <span className="flex items-center gap-2 px-4 py-3.5">
            <span className="size-2 rounded-full bg-muted-foreground" />
            {left}
          </span>
          <span className="flex items-center gap-2 bg-post/6 px-4 py-3.5">
            <span className="size-2 rounded-full bg-post shadow-[0_0_8px_var(--post-tone)]" />
            {right}
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

function Row({ label, left, right }: { label: string; left: string; right: string }) {
  return (
    <div className="grid grid-cols-[minmax(140px,200px)_1fr_1fr] border-b border-border text-sm last:border-b-0">
      <span className="px-4 py-3 text-muted-foreground">{label}</span>
      <span className="px-4 py-3 text-subtle">{left}</span>
      <span className="bg-post/6 px-4 py-3">{right}</span>
    </div>
  );
}

/** A folder holding one backup chain. */
function Chain({ path, note, children }: { path: string; note?: string; children?: ReactNode }) {
  return (
    <div className="not-prose relative my-8 overflow-hidden rounded-[18px] border border-border bg-background p-[22px] dark:bg-[#0d0d0f]">
      <span aria-hidden="true" className="bg-dot-grid absolute inset-0 [background-size:18px_18px]" />
      <div className="relative mb-3.5 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs text-faint">{path}</span>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </div>
      <div className="relative flex flex-col gap-2">{children}</div>
    </div>
  );
}

function ChainFile({ kind, name, note, size }: { kind: string; name: string; note?: string; size: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border border-border bg-surface/90 px-3 py-2.5">
      <span
        className={cn(
          "w-10 shrink-0 rounded-md py-0.5 text-center text-[11px] font-semibold",
          kind === "Full" ? "bg-tone-blue/14 text-tone-blue-soft" : "bg-tone-violet/14 text-tone-violet"
        )}
      >
        {kind}
      </span>
      <span className="min-w-[110px] font-mono text-[13px] text-subtle">{name}</span>
      <span className="grow text-[13px] text-muted-foreground">{note}</span>
      <span className="text-[13px] text-subtle tabular-nums">{size}</span>
    </div>
  );
}

/** A warning box whose list items become numbered cases. */
function Costs({ title, note, children }: { title: string; note?: string; children?: ReactNode }) {
  return (
    <div className="post-costs not-prose my-8 overflow-hidden rounded-[18px] border border-tone-amber/25 bg-tone-amber/4">
      <div className="flex items-center gap-3 border-b border-tone-amber/20 bg-tone-amber/8 px-[18px] py-3.5">
        <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-tone-amber/14 text-tone-amber">
          <TriangleAlert className="size-4" />
        </span>
        <div>
          <div className="font-semibold">{title}</div>
          {note && <div className="text-xs font-medium text-tone-amber">{note}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

function Callout({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="post-callout not-prose relative my-8 flex gap-3.5 overflow-hidden rounded-[14px] border border-post/25 bg-post/6 py-4 pr-[18px] pl-[22px]">
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-post shadow-[0_0_12px_var(--post-tone)]" />
      <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-post/14 text-post">
        <Info className="size-4" />
      </span>
      <div className="text-[15px] leading-relaxed text-subtle">
        {title && <strong className="font-semibold text-foreground">{title} </strong>}
        {children}
      </div>
    </div>
  );
}

export const MDX_COMPONENTS = {
  h2: H2,
  pre: CodeBlock,
  Compare,
  Row,
  Chain,
  ChainFile,
  Costs,
  Callout,
};
