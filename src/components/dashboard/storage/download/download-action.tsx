"use client";

import { Download, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { commandFor, commandMark, type Tool } from "./download-model";
import { LinkLine } from "./link-line";
import type { DownloadLink } from "./use-download-link";

export type Where = "here" | "server";

const TOOLS: { value: Tool; label: string }[] = [
    { value: "curl", label: "curl" },
    { value: "wget", label: "wget" },
    { value: "powershell", label: "PowerShell" },
];

interface DownloadActionProps {
    title: string;
    note: string;
    where: Where;
    onWhere: (where: Where) => void;
    tool: Tool;
    onTool: (tool: Tool) => void;
    /** Why nothing can be downloaded yet, or null once something can. */
    blocked: string | null;
    hereLabel: string;
    onHere: () => void;
    link: DownloadLink;
    onLink: () => void;
    canDownload: boolean;
    /** The name the file gets, which PowerShell has to be told. */
    fileName: string;
}

/**
 * The foot of the download dialog: what is picked, and the one action for it, here in the
 * browser or as a command for another host with a link that works for one download.
 */
export function DownloadAction(props: DownloadActionProps) {
    const { title, note, where, onWhere, tool, onTool, blocked, hereLabel, onHere, link, onLink, canDownload, fileName } = props;
    const usable = !!link.url && !link.expired && !link.fetched;
    const command = commandFor(tool, link.url, link.fileName ?? fileName);

    return (
        <div className="space-y-3 rounded-lg border bg-page/40 p-4">
            <Tabs value={where} onValueChange={(value) => onWhere(value as Where)} className="gap-0">
                <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{title}</p>
                        <p className="text-xs text-muted-foreground">{note}</p>
                    </div>
                    <TabsList className="h-8" aria-label="Where the download goes">
                        <TabsTrigger value="here" className="px-2.5 text-xs">This computer</TabsTrigger>
                        <TabsTrigger value="server" className="px-2.5 text-xs">A server</TabsTrigger>
                    </TabsList>
                </div>
            </Tabs>

            {where === "here" ? (
                <div className="flex flex-wrap items-center gap-3">
                    <Button variant="outline" size="sm" onClick={onHere} disabled={!!blocked} className="flex-1 sm:flex-none">
                        <Download />
                        {hereLabel}
                    </Button>
                    <p className="min-w-0 flex-1 text-xs text-muted-foreground">{blocked ?? "Your browser saves it like any other download."}</p>
                </div>
            ) : (
                <div className="space-y-3">
                    <Tabs value={tool} onValueChange={(value) => onTool(value as Tool)} className="gap-0">
                        <TabsList className="h-8" aria-label="The tool of the command">
                            {TOOLS.map((entry) => (
                                <TabsTrigger key={entry.value} value={entry.value} className="px-2.5 text-xs">
                                    {entry.label}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>
                    <LinkLine link={link} canDownload={canDownload} holder="the command" onCreate={onLink} blocked={blocked} />
                    <CodeBlock name="on the server" code={command} language={tool === "powershell" ? "powershell" : "bash"} icon={<Terminal />} mark={commandMark(link.url, usable)} />
                </div>
            )}
        </div>
    );
}
