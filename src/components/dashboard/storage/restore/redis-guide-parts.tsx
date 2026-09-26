"use client";

import { useState } from "react";
import { ChevronDown, Download, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeBlock, type CodeLanguage } from "@/components/ui/code-block";
import { cn } from "@/lib/utils";
import { Section } from "./restore-parts";
import type { GuideCode, GuideStep, RedisEngine } from "./redis-guide-script";

/** A part of the page that opens on demand, for what most readers never need. */
export function FoldSection({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
    const [open, setOpen] = useState(false);
    return (
        <Section
            title={title}
            note={note}
            action={
                <Button variant="ghost" size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>
                    {open ? "Hide" : "Show"}
                    <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
                </Button>
            }
        >
            {open && children}
        </Section>
    );
}

/** A number in a circle, like the steps of the restore page. */
function StepNumber({ n }: { n: number }) {
    return (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground tabular-nums" aria-hidden="true">
            {n}
        </span>
    );
}

/** Code of the guide, named after where it runs. */
export function GuideCodeBlock({ code, place, language }: { code: GuideCode; place: string; language: CodeLanguage }) {
    return <CodeBlock name={place} code={code.code} language={language} icon={<Terminal />} mark={code.marks} />;
}

interface GuideStepsProps {
    steps: GuideStep[];
    place: string;
    language: CodeLanguage;
    engine: RedisEngine;
    canDownload: boolean;
    onDownloadHere: () => void;
}

/** The restore one step at a time, each with its commands filled in. */
export function GuideSteps({ steps, place, language, engine, canDownload, onDownloadHere }: GuideStepsProps) {
    return (
        <ol className="space-y-5">
            {steps.map((step, index) => (
                <li key={step.title} className="flex gap-3">
                    <StepNumber n={index + 1} />
                    <div className="min-w-0 flex-1 space-y-2">
                        <div>
                            <p className="text-sm font-medium">{step.title}</p>
                            <p className="text-sm text-muted-foreground">{step.text}</p>
                        </div>
                        {step.blocks.map((block) => (
                            <GuideCodeBlock key={block.code} code={block} place={place} language={language} />
                        ))}
                        {index === 0 && canDownload && (
                            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                                <Button variant="outline" size="sm" onClick={onDownloadHere}>
                                    <Download />
                                    Download here
                                </Button>
                                <span>Or take it on this computer and copy it to the {engine} host as dump.rdb. That uses a link of its own.</span>
                            </div>
                        )}
                    </div>
                </li>
            ))}
        </ol>
    );
}

/**
 * What to do when Redis writes an append only file, which it would load instead of the dump.
 * Turning it off for one start depends on where Redis gets its settings, so it is said in words.
 */
export function AofSteps({ keep, turnOn, place, language, engine }: { keep: GuideCode; turnOn: GuideCode[]; place: string; language: CodeLanguage; engine: RedisEngine }) {
    const items: { text: string; code: GuideCode[] }[] = [
        { text: `Keep a copy of the file. It is the only full copy of what ${engine} holds now, and before Redis 7 it is appendonly.aof instead of a folder.`, code: [keep] },
        { text: `Set appendonly no where ${engine} gets its settings, like its config file, the command of the container or the compose file, and restart it.`, code: [] },
        { text: "Run the script or the manual steps.", code: [] },
        { text: `Turn the file back on. ${engine} writes a new one from the restored data.`, code: turnOn },
        { text: "Set appendonly yes again where you changed it, so the file stays on after the next restart.", code: [] },
    ];
    return (
        <ol className="space-y-5">
            {items.map((item, index) => (
                <li key={item.text} className="flex gap-3">
                    <StepNumber n={index + 1} />
                    <div className="min-w-0 flex-1 space-y-2">
                        <p className="text-sm">{item.text}</p>
                        {item.code.map((block) => (
                            <GuideCodeBlock key={block.code} code={block} place={place} language={language} />
                        ))}
                    </div>
                </li>
            ))}
        </ol>
    );
}
