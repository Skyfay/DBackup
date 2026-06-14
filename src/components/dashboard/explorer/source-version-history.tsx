"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ArrowUp, ArrowDown, History, AlertTriangle, Server } from "lucide-react";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { compareVersions } from "@/lib/utils";

interface VersionHistoryEntry {
    id: string;
    previousVersion: string | null;
    newVersion: string;
    edition: string | null;
    detectedAt: string;
}

interface SourceVersionHistoryProps {
    sourceId: string;
    currentVersion: string | null;
}

const chartConfig = {
    versionIndex: {
        label: "Version",
        color: "hsl(225, 79%, 54%)",
    },
} satisfies ChartConfig;

export function SourceVersionHistory({ sourceId, currentVersion }: SourceVersionHistoryProps) {
    const { formatDate } = useDateFormatter();
    const [history, setHistory] = useState<VersionHistoryEntry[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!sourceId) return;

        let cancelled = false;

        async function load() {
            setIsLoading(true);
            setError(null);
            try {
                const res = await fetch(`/api/adapters/${sourceId}/version-history?limit=200`);
                const data = await res.json();
                if (cancelled) return;
                if (data.success && Array.isArray(data.history)) {
                    setHistory(data.history);
                } else {
                    setError(data.message || "Failed to load version history");
                }
            } catch {
                if (!cancelled) setError("Failed to load version history");
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        }

        load();

        return () => {
            cancelled = true;
        };
    }, [sourceId]);

    // Build chart data from oldest -> newest so the line progresses left to right.
    // Each unique `newVersion` is mapped to a numeric Y position (0..n-1)
    // because recharts cannot plot string values on a numeric axis.
    const ordered = [...history].reverse();
    const versionSet = new Set<string>();
    for (const entry of ordered) versionSet.add(entry.newVersion);
    const versionOrder = [...versionSet].sort((a, b) => compareVersions(a, b));
    const chartData = ordered.map((entry) => ({
        detectedAt: entry.detectedAt,
        versionIndex: versionOrder.indexOf(entry.newVersion),
        version: entry.newVersion,
    }));

    return (
        <div className="space-y-4">
            {/* Current Version Badge */}
            <Card>
                <CardContent className="py-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-md bg-primary/10">
                            <Server className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">Current Version</p>
                            <p className="text-lg font-semibold">
                                {currentVersion ? `v${currentVersion}` : "Unknown"}
                            </p>
                        </div>
                        <div className="ml-auto text-right">
                            <p className="text-sm text-muted-foreground">Recorded Changes</p>
                            <p className="text-lg font-semibold">{history.length}</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Chart */}
            {chartData.length >= 2 && (
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">Version Timeline</CardTitle>
                        <CardDescription>
                            Detected engine versions over time (oldest left, newest right).
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ChartContainer config={chartConfig} className="h-55 w-full">
                            <LineChart data={chartData} accessibilityLayer>
                                <CartesianGrid vertical={false} />
                                <XAxis
                                    dataKey="detectedAt"
                                    tickLine={false}
                                    axisLine={false}
                                    fontSize={12}
                                    tickFormatter={(value: string) => formatDate(value, "P")}
                                />
                                <YAxis
                                    dataKey="versionIndex"
                                    tickLine={false}
                                    axisLine={false}
                                    allowDecimals={false}
                                    fontSize={12}
                                    width={80}
                                    domain={[0, Math.max(0, versionOrder.length - 1)]}
                                    ticks={versionOrder.map((_, i) => i)}
                                    tickFormatter={(value: number) => versionOrder[value] ?? ""}
                                />
                                <ChartTooltip
                                    content={
                                        <ChartTooltipContent
                                            labelFormatter={(value) => formatDate(String(value), "Pp")}
                                            formatter={(_v, _n, item) => {
                                                const v = (item?.payload as { version?: string })?.version;
                                                return [v ?? "", "Version"];
                                            }}
                                        />
                                    }
                                />
                                <Line
                                    type="stepAfter"
                                    dataKey="versionIndex"
                                    stroke="var(--color-versionIndex)"
                                    strokeWidth={2}
                                    dot={{ r: 4 }}
                                />
                            </LineChart>
                        </ChartContainer>
                    </CardContent>
                </Card>
            )}

            {/* Table */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                        <History className="h-4 w-4" />
                        Change Log
                    </CardTitle>
                    <CardDescription>
                        New entries are recorded by the &ldquo;Update Database Versions&rdquo; system task
                        whenever the detected engine version differs from the previous check.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="space-y-2">
                            {[...Array(3)].map((_, i) => (
                                <Skeleton key={i} className="h-10 w-full" />
                            ))}
                        </div>
                    ) : error ? (
                        <div className="flex items-center gap-3 text-destructive py-4">
                            <AlertTriangle className="h-5 w-5 shrink-0" />
                            <p className="text-sm">{error}</p>
                        </div>
                    ) : history.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            <History className="h-10 w-10 mx-auto mb-3 opacity-30" />
                            <p className="text-sm">No version changes recorded yet.</p>
                            <p className="text-xs mt-1">
                                The first entry appears after the next run of the &ldquo;Update Database Versions&rdquo; task.
                            </p>
                        </div>
                    ) : (
                        <div className="border rounded-md overflow-hidden">
                            <Table>
                                <TableHeader className="bg-muted/50">
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead>Detected At</TableHead>
                                        <TableHead>Change</TableHead>
                                        <TableHead>Edition</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {history.map((entry) => (
                                        <TableRow key={entry.id}>
                                            <TableCell className="text-muted-foreground">
                                                {formatDate(entry.detectedAt, "Pp")}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    {entry.previousVersion ? (() => {
                                                        const isDowngrade = compareVersions(entry.previousVersion, entry.newVersion) > 0;
                                                        return isDowngrade ? (
                                                            <>
                                                                <Badge variant="outline">{entry.previousVersion}</Badge>
                                                                <ArrowDown className="h-3.5 w-3.5 text-orange-500" />
                                                                <Badge className="bg-orange-500 hover:bg-orange-500/90">{entry.newVersion}</Badge>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Badge variant="outline">{entry.previousVersion}</Badge>
                                                                <ArrowUp className="h-3.5 w-3.5 text-green-500" />
                                                                <Badge>{entry.newVersion}</Badge>
                                                            </>
                                                        );
                                                    })() : (
                                                        <>
                                                            <span className="text-xs text-muted-foreground">Initial:</span>
                                                            <Badge>{entry.newVersion}</Badge>
                                                        </>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-muted-foreground text-sm">
                                                {entry.edition ?? "-"}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
