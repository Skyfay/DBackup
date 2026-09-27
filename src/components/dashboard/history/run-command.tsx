"use client";

import { useState } from "react";
import { Check, ChevronRight, Copy } from "lucide-react";
import { toast } from "sonner";
import { isStatement, parseCommand, statementLines, type CommandArg } from "@/lib/logs/line-source";
import { cn } from "@/lib/utils";

function Arg({ arg }: { arg: CommandArg }) {
    const joined = arg.flag?.endsWith("=") || arg.flag?.endsWith(":");
    return (
        <>
            {arg.flag && <span className="text-muted-foreground">{arg.flag}</span>}
            {arg.flag && arg.value && !joined && " "}
            {arg.value && <span className="text-foreground">{arg.value}</span>}
        </>
    );
}

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    const copy = () => navigator.clipboard.writeText(text)
        .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        })
        .catch(() => toast.error("The command could not be copied"));
    return (
        <button
            type="button"
            onClick={copy}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 font-sans text-xs font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
            {copied ? <Check className="size-3" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
            {copied ? "Copied" : "Copy"}
        </button>
    );
}

/**
 * A command a step ran. Closed it is one line with how many options it has, open every option
 * stands on a line of its own and a long value wraps, so nothing of it is cut off. A statement
 * for the server opens broken before its clauses instead.
 */
export function CommandBlock({ command, className }: { command: string; className?: string }) {
    const [open, setOpen] = useState(false);
    const statement = isStatement(command);
    const parsed = statement ? null : parseCommand(command);
    const lines = statement ? statementLines(command) : [];
    const label = statement ? "statement" : parsed ? `${parsed.args.length} ${parsed.args.length === 1 ? "option" : "options"}` : null;

    return (
        <div className={cn("min-w-0 rounded-lg border bg-muted/40 font-mono text-xs leading-5", className)}>
            <div className="flex min-w-0 items-center gap-2 py-1 pr-1 pl-2">
                <button
                    type="button"
                    aria-expanded={open}
                    aria-label={open ? "Close the command" : "Open the whole command"}
                    onClick={() => setOpen((value) => !value)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                    <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">
                        {statement ? (
                            <span className="text-foreground">{open ? lines[0]?.text : command}</span>
                        ) : parsed ? (
                            <>
                                <span className="text-muted-foreground/70 select-none">$ </span>
                                <span className="font-semibold text-foreground">{parsed.binary}</span>
                                {!open && parsed.args.map((arg, index) => <span key={index}> <Arg arg={arg} /></span>)}
                            </>
                        ) : command}
                    </span>
                </button>
                {label && <span className="shrink-0 font-sans text-[11px] text-muted-foreground">{label}</span>}
                <CopyButton text={command} />
            </div>
            {open && (
                <div className="pr-3 pb-2">
                    {statement
                        ? lines.slice(1).map((line, index) => (
                            <div key={index} className={cn("break-words", line.indent > 1 ? "pl-14" : "pl-10")}>{line.text}</div>
                        ))
                        : parsed?.args.map((arg, index) => (
                            <div key={index} className="pl-[3.1rem] -indent-4 [overflow-wrap:anywhere]"><Arg arg={arg} /></div>
                        ))}
                </div>
            )}
        </div>
    );
}
