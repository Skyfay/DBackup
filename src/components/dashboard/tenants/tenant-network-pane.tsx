"use client";

import { useId, useState } from "react";
import { Network, Plus, X } from "lucide-react";
import { SwitchList, SwitchRow } from "@/components/adapter/setting-switches";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_ALLOWED_RANGES, MAX_RANGE_LENGTH, parseCidr } from "@/lib/network/local-network";
import { cn } from "@/lib/utils";
import type { TenantRow } from "@/services/tenant/tenant-service";
import { Note } from "./tenant-edit-panes";

type TenantNetwork = TenantRow["network"];

/** What the field of a new range holds: a range to add in its short form, or why it cannot be added. Both null while it is empty. */
export function rangeDraft(input: string, allowed: readonly string[]): { range: string | null; problem: string | null } {
    if (!input.trim()) return { range: null, problem: null };
    const parsed = parseCidr(input);
    if (!parsed.ok) return { range: null, problem: parsed.error };
    if (allowed.includes(parsed.text)) return { range: null, problem: `${parsed.text} is in the list already.` };
    if (allowed.length >= MAX_ALLOWED_RANGES) return { range: null, problem: `A tenant has at most ${MAX_ALLOWED_RANGES} allowed ranges. Allow a wider range instead.` };
    return { range: parsed.text, problem: null };
}

interface NetworkPaneProps {
    tenant: Pick<TenantRow, "name">;
    value: TenantNetwork;
    onChange: (next: TenantNetwork) => void;
    disabled: boolean;
}

/**
 * Whether the connections of a customer reach the local network of the server DBackup runs on, and
 * the ranges they reach anyway, each checked as it is typed. Saved with Save changes.
 */
export function NetworkPane({ tenant, value, onChange, disabled }: NetworkPaneProps) {
    const fieldId = useId();
    const [draft, setDraft] = useState("");
    const { range, problem } = rangeDraft(draft, value.allowed);

    const add = () => {
        if (!range) return;
        onChange({ ...value, allowed: [...value.allowed, range] });
        setDraft("");
    };
    const remove = (entry: string) => onChange({ ...value, allowed: value.allowed.filter((allowed) => allowed !== entry) });

    return (
        <div className="space-y-4">
            <SwitchList>
                <SwitchRow
                    title="Block the local network"
                    description="Its connections reach no loopback, private, link-local or VPN address, like 127.0.0.1, 10.0.0.5 or 100.64.0.1, outside the ranges below. Over SSH only the SSH server counts, what lies behind it is reached from there."
                    checked={value.blocks}
                    onCheckedChange={(blocks) => onChange({ ...value, blocks })}
                    disabled={disabled}
                />
            </SwitchList>
            <Note>
                {value.blocks
                    ? "Saving, testing and every run check the addresses its hosts resolve to. A connection that reaches a blocked address stops working at its next run."
                    : `Off, the connections of ${tenant.name} reach the network of the server DBackup runs on, the servers of the platform too.`}
            </Note>

            <section className="space-y-3 border-t pt-4">
                <div className="space-y-1">
                    <h4 className="text-sm font-medium">Allowed ranges</h4>
                    <p className="text-xs text-muted-foreground">{value.blocks ? "Its connections reach these addresses anyway." : "They count while the block is on."}</p>
                </div>
                {!disabled && (
                    <div className="space-y-2">
                        <Label htmlFor={fieldId} className="sr-only">Range to allow</Label>
                        <div className="flex gap-2">
                            <Input
                                id={fieldId}
                                value={draft}
                                maxLength={MAX_RANGE_LENGTH}
                                placeholder="10.10.10.0/24"
                                onChange={(event) => setDraft(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key !== "Enter") return;
                                    event.preventDefault();
                                    add();
                                }}
                                autoComplete="off"
                                spellCheck={false}
                                className="font-mono"
                                aria-invalid={problem ? true : undefined}
                                aria-describedby={`${fieldId}-message`}
                            />
                            <Button type="button" tone="create" onClick={add} disabled={!range}>
                                <Plus />
                                Add
                            </Button>
                        </div>
                        <p id={`${fieldId}-message`} className={cn("text-xs", problem ? "text-destructive" : "text-muted-foreground")}>
                            {problem ?? "A range like 10.10.10.0/24 or fd00:1::/64, or one address like 10.0.0.5."}
                        </p>
                    </div>
                )}
                {value.allowed.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{value.blocks ? `None, ${tenant.name} reaches no address of the local network.` : "None."}</p>
                ) : (
                    <ul className="divide-y rounded-lg border" aria-label="Allowed ranges">
                        {value.allowed.map((entry) => (
                            <li key={entry} className="flex min-w-0 items-center gap-3 px-3 py-1.5">
                                <Network className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                <span className={cn("min-w-0 flex-1 truncate font-mono text-sm", !value.blocks && "text-muted-foreground")}>{entry}</span>
                                {!disabled && (
                                    <Button type="button" variant="ghost" size="icon-sm" className="shrink-0" onClick={() => remove(entry)} aria-label={`Remove ${entry}`}>
                                        <X />
                                    </Button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}
