"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Pencil, SearchCode, Zap } from "lucide-react";
import { toast } from "sonner";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DateDisplay } from "@/components/utils/date-display";
import { logger } from "@/lib/logging/logger";
import { formatBytes } from "@/lib/utils";
import type { ConnectionDetails } from "@/services/adapters/connection-details";
import type { AdapterConfig } from "./types";
import { healthOf, kindNames, statusDetail, type ConnectionKind } from "./connection-columns";
import { connectionAddress, connectionFacts, connectionVersion } from "./connection-summary";
import { DetailStats, FactList, HealthTimeline, IssueBanner, Section, UsageList, type DetailStat } from "./connection-details-sections";

const log = logger.child({ component: "connection-details-sheet" });

const STATUS_CLASS = { ONLINE: "text-success", DEGRADED: "text-warning", OFFLINE: "text-destructive", PENDING: "text-muted-foreground" };
const STATUS_LABEL = { ONLINE: "Online", DEGRADED: "Degraded", OFFLINE: "Offline", PENDING: "Not checked" };

type DetailsResult = { id: string; data: ConnectionDetails } | { id: string; error: string };

interface ConnectionDetailsSheetProps {
    open: boolean;
    /** Stays set while the panel slides out, so its content does not vanish halfway. */
    config: AdapterConfig | null;
    kind: ConnectionKind;
    onClose: () => void;
    /** Runs a connection test with the stored secrets, which needs the edit permission. */
    canTest: boolean;
    canViewHistory: boolean;
    exploreHref?: string;
    onEdit?: () => void;
    /** The remaining actions, as the menu the row shows. */
    menu: React.ReactNode;
}

/** Everything about one connection: what is wrong, how its checks went, what uses it, and how it is set up. */
export function ConnectionDetailsSheet({ open, config, kind, onClose, canTest, canViewHistory, exploreHref, onEdit, menu }: ConnectionDetailsSheetProps) {
    const [result, setResult] = useState<DetailsResult | null>(null);
    const [testing, setTesting] = useState(false);
    const configId = config?.id;

    useEffect(() => {
        if (!configId) return;
        let ignore = false;
        fetch(`/api/adapters/${configId}/details`)
            .then((res) => res.json())
            .then((json) => {
                if (ignore) return;
                setResult(json.success ? { id: configId, data: json.data } : { id: configId, error: json.error || "Failed to load details" });
            })
            .catch((error: unknown) => {
                if (ignore) return;
                log.error("Loading connection details failed", { configId }, error instanceof Error ? error : undefined);
                setResult({ id: configId, error: "Failed to load details" });
            });
        return () => {
            ignore = true;
        };
    }, [configId]);

    const runTest = async (target: AdapterConfig) => {
        setTesting(true);
        try {
            const res = await fetch("/api/adapters/test-connection", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                // The id lets the server fill in the secrets the browser never receives.
                body: JSON.stringify({
                    adapterId: target.adapterId,
                    config: JSON.parse(target.config),
                    configId: target.id,
                    primaryCredentialId: target.primaryCredentialId ?? undefined,
                    sshCredentialId: target.sshCredentialId ?? undefined,
                }),
            });
            const outcome = await res.json();
            if (outcome.success) toast.success(outcome.message || "The connection works.");
            else toast.error(outcome.message || "The connection failed.");
        } catch (error) {
            log.error("Testing a connection failed", { configId: target.id }, error instanceof Error ? error : undefined);
            toast.error("The connection test could not run.");
        } finally {
            setTesting(false);
        }
    };

    // A result for another connection counts as loading, so switching needs no reset.
    const current = result && config && result.id === config.id ? result : null;
    const details = current && "data" in current ? current.data : undefined;
    const loadError = current && "error" in current ? current.error : null;

    return (
        <Sheet open={open && config !== null} onOpenChange={(next) => !next && onClose()}>
            <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
                {config && (
                    <DetailsBody
                        config={config}
                        kind={kind}
                        details={details}
                        loadError={loadError}
                        canTest={canTest}
                        testing={testing}
                        onTest={() => runTest(config)}
                        canViewHistory={canViewHistory}
                        exploreHref={exploreHref}
                        onEdit={onEdit}
                        menu={menu}
                    />
                )}
            </SheetContent>
        </Sheet>
    );
}

interface DetailsBodyProps extends Omit<ConnectionDetailsSheetProps, "open" | "config" | "onClose"> {
    config: AdapterConfig;
    details: ConnectionDetails | undefined;
    loadError: string | null;
    testing: boolean;
    onTest: () => void;
}

function DetailsBody({ config, kind, details, loadError, canTest, testing, onTest, canViewHistory, exploreHref, onEdit, menu }: DetailsBodyProps) {
    const overview = config.overview;
    const health = healthOf(config);
    const version = connectionVersion(config.metadata);
    const address = connectionAddress(config.adapterId, config.config);
    const typeName = kindNames.get(config.adapterId) ?? config.adapterId;
    const notification = kind === "notification";

    const stats: DetailStat[] = notification
        ? [
              { label: "Used by", value: overview?.usedBy.jobs ?? "-", extra: "jobs" },
              { label: "Templates", value: overview?.usedBy.templates ?? "-", extra: "send through it" },
              { label: "Last sent", value: overview?.lastSent ? <RelativeTime date={overview.lastSent.at} /> : "Never", extra: overview?.lastSent?.status },
          ]
        : [
              { label: "Status", value: STATUS_LABEL[health], extra: statusDetail(config, health), className: STATUS_CLASS[health] },
              { label: "Health, 24h", value: overview?.checksPassed != null ? `${overview.checksPassed}%` : "-", extra: "of checks passed" },
              { label: "Used by", value: overview?.usedBy.jobs ?? "-", extra: overview?.usedBy.jobs === 1 ? "job" : "jobs" },
              { label: "Last backup", value: overview?.lastBackup ? <RelativeTime date={overview.lastBackup.at} /> : "Never", extra: overview?.lastBackup?.status },
          ];

    const previous = details?.versions.find((entry) => entry.previous);
    const facts: { label: string; value: React.ReactNode }[] = [
        ...connectionFacts(config.config),
        ...(overview?.credentialName ? [{ label: "Credential", value: overview.credentialName }] : []),
        ...(version ? [{ label: "Version", value: version }] : []),
        ...(previous ? [{ label: "Previous version", value: <>{previous.previous}, until <DateDisplay date={previous.at} format="P" /></> }] : []),
        ...(overview?.retentionName ? [{ label: "Default retention", value: overview.retentionName }] : []),
        ...(overview?.stored ? [{ label: "Stored", value: `${formatBytes(overview.stored.size, 1)}, ${overview.stored.count.toLocaleString()} backups` }] : []),
        { label: "Added", value: <DateDisplay date={config.createdAt} format="P" /> },
    ];

    return (
        <>
            <SheetHeader className="gap-4 border-b p-5 pr-12">
                <div className="flex min-w-0 items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
                        <AdapterIcon adapterId={config.adapterId} className="size-5" />
                    </span>
                    <div className="min-w-0">
                        <SheetTitle className="truncate text-lg">{config.name}</SheetTitle>
                        <SheetDescription className="truncate">
                            {typeName}
                            {version && ` ${version}`}
                            {address && ` · ${address}`}
                        </SheetDescription>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {canTest && (
                        <Button variant="outline" size="sm" onClick={onTest} disabled={testing}>
                            {testing ? <Loader2 className="animate-spin" /> : <Zap />}
                            Test connection
                        </Button>
                    )}
                    {exploreHref && (
                        <Button asChild variant="outline" size="sm">
                            <Link href={exploreHref}>
                                <SearchCode />
                                Explore
                            </Link>
                        </Button>
                    )}
                    {onEdit && (
                        <Button variant="outline" size="sm" onClick={onEdit}>
                            <Pencil />
                            Edit
                        </Button>
                    )}
                    {menu}
                </div>
            </SheetHeader>

            <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-6 p-5">
                    {(health === "OFFLINE" || health === "DEGRADED") && (
                        <IssueBanner status={health} error={config.lastError} failures={config.consecutiveFailures} lastPassedAt={details?.lastPassedAt} />
                    )}

                    <DetailStats stats={stats} />

                    {!notification && overview && (
                        <Section
                            title="Health, last 24 hours"
                            aside={details?.averageLatencyMs != null ? `avg ${details.averageLatencyMs} ms` : undefined}
                        >
                            <HealthTimeline buckets={overview.health} />
                        </Section>
                    )}

                    <Section title="Used by">
                        {loadError ? (
                            <p className="text-sm text-destructive">{loadError}</p>
                        ) : (
                            <UsageList usage={details?.usage} counts={overview?.usedBy} canViewHistory={canViewHistory} />
                        )}
                    </Section>

                    <Section title="Settings">
                        <FactList facts={facts} />
                    </Section>
                </div>
            </ScrollArea>
        </>
    );
}
