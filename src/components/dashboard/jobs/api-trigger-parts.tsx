"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Copy, KeyRound, Plus } from "lucide-react";
import { CreateApiKeyDialog } from "@/components/api-keys/create-api-key-dialog";
import { ExecutionStatusBadge } from "@/components/dashboard/widgets/execution-status";
import { useCan } from "@/components/permissions/permissions-context";
import { Button } from "@/components/ui/button";
import { CodeBlock, MarkedText, type CodeMark } from "@/components/ui/code-block";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import { PIPELINE_SECRETS, RESPONSE_EXAMPLES, TRIGGER_PERMISSIONS, curlTrigger, statusUrl, triggerUrl, type TriggerExample, type TriggerTarget } from "./api-trigger-examples";

/** A key made in the dialog. It lives only as long as the dialog is open. */
export interface CreatedKey {
    name: string;
    key: string;
}

/** Where the API Keys tab of Access Management opens. */
export const API_KEYS_HREF = "/dashboard/users?tab=apikeys";

const STATUSES = [
    { status: "Pending", meaning: "waits for a slot in the queue" },
    { status: "Running", meaning: "with its progress and stage" },
    { status: "Success", meaning: "done" },
    { status: "Partial", meaning: "done, but part of it failed" },
    { status: "Failed", meaning: "with the error" },
    { status: "Cancelled", meaning: "stopped by hand" },
];

function CopyButton({ value, label }: { value: string; label: string }) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <Button type="button" variant="ghost" className="size-8 shrink-0 p-0" onClick={copy} aria-label={copied ? `${label} copied` : `Copy ${label}`}>
            {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5 text-muted-foreground" />}
        </Button>
    );
}

/** One line of a frame: what it is, the value to copy, and Copy at the end. */
function CopyRow({ lead, value, shown, note, label }: { lead: React.ReactNode; value: string; shown?: React.ReactNode; note?: string; label: string }) {
    return (
        <div className="flex min-w-0 items-center gap-3 py-1.5 pr-1.5 pl-3">
            {lead}
            <span className="min-w-0 flex-1 truncate font-mono text-xs" title={value}>
                {shown ?? value}
            </span>
            {note && <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{note}</span>}
            <CopyButton value={value} label={label} />
        </div>
    );
}

const Method = ({ verb }: { verb: string }) => (
    <span className="inline-flex h-5.5 w-12 shrink-0 items-center justify-center rounded-md border bg-muted font-mono text-[11px] font-semibold">{verb}</span>
);

const RowLabel = ({ children }: { children: React.ReactNode }) => <span className="w-12 shrink-0 text-xs text-muted-foreground">{children}</span>;

const Frame = ({ children }: { children: React.ReactNode }) => <div className="min-w-0 divide-y rounded-lg border">{children}</div>;

const Permission = ({ name }: { name: string }) => <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs">{name}</code>;

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
    return (
        <section className="min-w-0 space-y-2.5">
            <div className="flex items-baseline justify-between gap-3">
                <h4 className="text-sm font-medium">{title}</h4>
                {hint && <span className="min-w-0 truncate text-xs text-muted-foreground">{hint}</span>}
            </div>
            {children}
        </section>
    );
}

const triggerRow = (target: TriggerTarget) => (
    <CopyRow lead={<Method verb="POST" />} value={triggerUrl(target)} note="starts a run" label="the URL that starts a run" />
);

const statusRow = (target: TriggerTarget) => (
    <CopyRow lead={<Method verb="GET" />} value={statusUrl(target.baseUrl)} note="its status" label="the URL of a run's status" />
);

/** The statuses of a run with what each one means. Only the last four end it. */
function StatusList() {
    return (
        <ul className="grid gap-1.5">
            {STATUSES.map(({ status, meaning }) => (
                <li key={status} className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="w-24 shrink-0">
                        <ExecutionStatusBadge status={status} label={status} still />
                    </span>
                    {meaning}
                </li>
            ))}
        </ul>
    );
}

/** The two requests, the key they need and what they answer. */
export function OverviewPart({ target, mark }: { target: TriggerTarget; mark: CodeMark }) {
    const canSeeKeys = useCan(PERMISSIONS.API_KEYS.READ);
    const header = `Authorization: Bearer ${target.apiKey}`;
    return (
        <>
            <Section title="Endpoints">
                <Frame>
                    {triggerRow(target)}
                    {statusRow(target)}
                    <CopyRow lead={<RowLabel>Job</RowLabel>} value={target.jobId} label="the job ID" />
                </Frame>
            </Section>
            <Section title="The key">
                <Frame>
                    <div className="flex items-start gap-3 p-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted" aria-hidden="true">
                            <KeyRound className="size-4" />
                        </span>
                        <div className="grid min-w-0 flex-1 gap-2 text-sm">
                            <p>
                                Every request sends an API key. It needs <Permission name={TRIGGER_PERMISSIONS[0]} /> to start the job and{" "}
                                <Permission name={TRIGGER_PERMISSIONS[1]} /> to follow its run.
                            </p>
                        </div>
                        {canSeeKeys && (
                            <Button asChild variant="outline" size="sm" className="shrink-0">
                                <Link href={API_KEYS_HREF}>
                                    <ArrowUpRight />
                                    API keys
                                </Link>
                            </Button>
                        )}
                    </div>
                    <CopyRow lead={<RowLabel>Header</RowLabel>} value={header} shown={<MarkedText text={header} mark={mark} />} label="the header" />
                </Frame>
            </Section>
            <Section title="Response" hint="then ask until the run has one of the last four">
                <div className="grid items-start gap-4 sm:grid-cols-2">
                    <CodeBlock name="POST …/run" code={RESPONSE_EXAMPLES.trigger} language="json" />
                    <StatusList />
                </div>
            </Section>
        </>
    );
}

function Step({ number, title, text, done = false, children }: { number: number; title: string; text: string; done?: boolean; children: React.ReactNode }) {
    return (
        <li className="flex gap-3.5">
            <span
                className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                    done ? "border-success/50 bg-success/12 text-success" : "bg-muted",
                )}
                aria-hidden="true"
            >
                {done ? <Check className="size-3.5" strokeWidth={2.5} /> : number}
            </span>
            <div className="grid min-w-0 flex-1 gap-2.5 pt-1">
                <div className="grid gap-0.5">
                    <p className={cn("text-sm font-semibold", done && "text-success")}>{title}</p>
                    <p className="text-sm text-muted-foreground">{text}</p>
                </div>
                {children}
            </div>
        </li>
    );
}

interface SetupPartProps {
    target: TriggerTarget;
    mark: CodeMark;
    jobName: string;
    created: CreatedKey | null;
    onCreated: (key: CreatedKey) => void;
    icon: React.ReactNode;
}

/** A key, the request that starts the job and the one that follows its run, one step each. */
export function SetupPart({ target, mark, jobName, created, onCreated, icon }: SetupPartProps) {
    const canCreate = useCan(PERMISSIONS.API_KEYS.WRITE);
    const canSeeKeys = useCan(PERMISSIONS.API_KEYS.READ);
    const [creating, setCreating] = useState(false);

    return (
        <>
            <ol className="grid gap-6">
                {created ? (
                    <Step number={1} done title={`Key ${created.name} created`} text="It may start jobs and read their runs, nothing else.">
                        <div className="overflow-hidden rounded-lg border border-success/35 bg-success/5">
                            <div className="flex min-w-0 items-center gap-3 py-1.5 pr-1.5 pl-3">
                                <span className="min-w-0 flex-1 truncate font-mono text-xs text-success">{created.key}</span>
                                <CopyButton value={created.key} label="the new key" />
                            </div>
                            <p className="border-t border-success/25 px-3 py-2 text-xs text-muted-foreground">
                                DBackup shows it only this once. The examples use it until this dialog closes.
                            </p>
                        </div>
                    </Step>
                ) : (
                    <Step
                        number={1}
                        title="An API key"
                        text={`Scripts sign in with a key that may start this job and follow its run.${canCreate ? " Create key makes one with both rights." : ""}`}
                    >
                        <div className="flex flex-wrap items-center gap-2">
                            {TRIGGER_PERMISSIONS.map((permission) => (
                                <Permission key={permission} name={permission} />
                            ))}
                        </div>
                        {(canCreate || canSeeKeys) && (
                            <div className="flex flex-wrap items-center gap-2">
                                {canCreate && (
                                    <Button type="button" tone="create" size="sm" onClick={() => setCreating(true)}>
                                        <Plus />
                                        Create key
                                    </Button>
                                )}
                                {canSeeKeys && (
                                    <Button asChild variant="ghost" size="sm">
                                        <Link href={API_KEYS_HREF}>
                                            <ArrowUpRight />
                                            API keys
                                        </Link>
                                    </Button>
                                )}
                            </div>
                        )}
                    </Step>
                )}
                <Step number={2} title="Start the job" text="One request starts a run and answers with its executionId.">
                    <Frame>{triggerRow(target)}</Frame>
                    <CodeBlock name="curl" code={curlTrigger(target)} language="bash" icon={icon} mark={mark} />
                </Step>
                <Step number={3} title="Wait for the result" text="Ask for the run every few seconds until it is Success, Partial, Failed or Cancelled.">
                    <Frame>{statusRow(target)}</Frame>
                    <div className="flex flex-wrap gap-1.5">
                        {STATUSES.map(({ status }) => (
                            <ExecutionStatusBadge key={status} status={status} label={status} still />
                        ))}
                    </div>
                </Step>
            </ol>
            {canCreate && (
                <CreateApiKeyDialog
                    open={creating}
                    onOpenChange={setCreating}
                    defaults={{ name: `API trigger for ${jobName}`, permissions: TRIGGER_PERMISSIONS }}
                    onCreated={({ name, rawKey }) => onCreated({ name, key: rawKey })}
                />
            )}
        </>
    );
}

/** A script or a pipeline: what it needs, its files, and the secrets a pipeline reads. */
export function ExamplePart({ example, target, mark, icon }: { example: TriggerExample; target: TriggerTarget; mark: CodeMark; icon: React.ReactNode }) {
    return (
        <>
            {example.files.map((file, index) => (
                <div key={index} className="min-w-0 space-y-2">
                    {file.title && <h4 className="text-sm font-medium">{file.title}</h4>}
                    <CodeBlock name={file.name} code={file.code(target)} language={file.language} icon={icon} mark={mark} />
                    {file.note && <p className="text-xs text-muted-foreground">{file.note}</p>}
                </div>
            ))}
            {example.secrets && (
                <Section title="Its secrets" hint="the key never goes into the file">
                    <Frame>
                        <CopyRow lead={<span className="w-32 shrink-0 font-mono text-xs text-muted-foreground">{PIPELINE_SECRETS[0]}</span>} value={target.baseUrl} label="the address" />
                        <CopyRow
                            lead={<span className="w-32 shrink-0 font-mono text-xs text-muted-foreground">{PIPELINE_SECRETS[1]}</span>}
                            value={target.apiKey}
                            shown={<MarkedText text={target.apiKey} mark={mark} />}
                            label="the key"
                        />
                    </Frame>
                </Section>
            )}
            {example.group === "script" && example.id !== "curl" && (
                <p className="text-xs text-muted-foreground">Ends with 0 after Success, 2 after Partial and 1 after Failed or Cancelled, so whatever runs it can tell them apart.</p>
            )}
        </>
    );
}
