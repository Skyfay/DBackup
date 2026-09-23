"use client";

import { useFormContext } from "react-hook-form";
import { SwitchList } from "@/components/adapter/setting-switches";
import { NamingTemplatePicker } from "@/components/templates/naming-template-picker";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PG_LEVELS, type JobFormValues } from "./job-form-schema";

const ALGORITHMS: { value: JobFormValues["pgCompressionAlgo"]; label: string; since?: number }[] = [
    { value: "LEGACY", label: "Gzip, level 6 · the default" },
    { value: "NONE", label: "None" },
    { value: "GZIP", label: "Gzip" },
    { value: "LZ4", label: "LZ4 · PostgreSQL 14 and up", since: 14 },
    { value: "ZSTD", label: "Zstd · PostgreSQL 16 and up", since: 16 },
];

interface AdvancedPartProps {
    isPostgres: boolean;
    pgMajorVersion: number | null;
    /** PostgreSQL compresses the dump itself, so compressing it again only costs time. */
    nativeCompression: boolean;
}

/** Compression, file names, incremental backups and integrity checks. */
export function AdvancedPart({ isPostgres, pgMajorVersion, nativeCompression }: AdvancedPartProps) {
    const form = useFormContext<JobFormValues>();
    const mode = form.watch("sourceMode");
    const algo = form.watch("pgCompressionAlgo");
    const incremental = form.watch("backupMode") === "INCREMENTAL";
    const withFolders = mode !== "db";
    const levels = PG_LEVELS[algo];

    return (
        <>
            <FormField
                control={form.control}
                name="compression"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>Compression</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange} disabled={nativeCompression && !withFolders}>
                            <FormControl>
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                <SelectItem value="NONE">None · fastest</SelectItem>
                                <SelectItem value="GZIP">Gzip · small and fast</SelectItem>
                                <SelectItem value="BROTLI">Brotli · smallest, slower</SelectItem>
                            </SelectContent>
                        </Select>
                        <FormDescription>
                            {nativeCompression && !withFolders
                                ? "PostgreSQL compresses the dump itself, set below."
                                : nativeCompression
                                    ? "For the folders. The PostgreSQL dump keeps its own compression, set below."
                                    : "Smaller backups for a little more work on every run."}
                        </FormDescription>
                    </FormItem>
                )}
            />

            {isPostgres && (
                <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
                    <FormField
                        control={form.control}
                        name="pgCompressionAlgo"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>PostgreSQL compression</FormLabel>
                                <Select
                                    value={field.value}
                                    onValueChange={(value) => {
                                        field.onChange(value);
                                        const range = PG_LEVELS[value];
                                        if (range) form.setValue("pgCompressionLevel", range.default);
                                    }}
                                >
                                    <FormControl>
                                        <SelectTrigger className="w-full">
                                            <SelectValue />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        {ALGORITHMS.map((option) => (
                                            <SelectItem key={option.value} value={option.value} disabled={option.since !== undefined && pgMajorVersion !== null && pgMajorVersion < option.since}>
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <FormDescription>
                                    pg_dump compresses the dump while it writes it{pgMajorVersion !== null ? `, this server runs PostgreSQL ${pgMajorVersion}` : ""}.
                                </FormDescription>
                            </FormItem>
                        )}
                    />
                    {levels && (
                        <FormField
                            control={form.control}
                            name="pgCompressionLevel"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Level</FormLabel>
                                    <Select value={String(field.value)} onValueChange={(value) => field.onChange(parseInt(value, 10))}>
                                        <FormControl>
                                            <SelectTrigger className="w-full">
                                                <SelectValue />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {levels.values.map((level) => (
                                                <SelectItem key={level} value={String(level)}>
                                                    {level}
                                                    {level === levels.default && " · default"}
                                                    {level === levels.values[levels.values.length - 1] && " · smallest"}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormDescription>Higher is smaller and slower.</FormDescription>
                                </FormItem>
                            )}
                        />
                    )}
                </div>
            )}

            <FormField
                control={form.control}
                name="namingTemplateId"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>File names</FormLabel>
                        <FormControl>
                            <NamingTemplatePicker value={field.value || null} onChange={(id) => field.onChange(id || undefined)} allowNone placeholder="The default template" />
                        </FormControl>
                        <FormDescription>How the backup files are named. Templates live under Templates.</FormDescription>
                        <FormMessage />
                    </FormItem>
                )}
            />

            <SwitchList>
                {withFolders && (
                    <FormField
                        control={form.control}
                        name="backupMode"
                        render={({ field }) => (
                            <FormItem className="flex items-center gap-4 px-4 py-3">
                                <div className="grid min-w-0 flex-1 gap-0.5">
                                    <FormLabel>Incremental backups</FormLabel>
                                    <p className="text-xs text-muted-foreground">
                                        Folders only store what changed since the last run. A backup then depends on the full one its chain starts with.
                                        {mode === "both" && " The database is always dumped in full."}
                                    </p>
                                </div>
                                <FormControl>
                                    <Switch checked={field.value === "INCREMENTAL"} onCheckedChange={(on) => field.onChange(on ? "INCREMENTAL" : "FULL")} />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                )}
                {withFolders && incremental && (
                    <FormField
                        control={form.control}
                        name="verifyByHash"
                        render={({ field }) => (
                            <FormItem className="flex items-center gap-4 px-4 py-3">
                                <div className="grid min-w-0 flex-1 gap-0.5">
                                    <FormLabel>Detect changes by content</FormLabel>
                                    <p className="text-xs text-muted-foreground">
                                        Reads every file instead of trusting its size and time. Only needed where those can stay the same after a change.
                                    </p>
                                </div>
                                <FormControl>
                                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                )}
                <FormField
                    control={form.control}
                    name="skipVerification"
                    render={({ field }) => (
                        <FormItem className="flex items-center gap-4 px-4 py-3">
                            <div className="grid min-w-0 flex-1 gap-0.5">
                                <FormLabel>Integrity checks</FormLabel>
                                <p className="text-xs text-muted-foreground">Includes the backups of this job in the scheduled integrity check.</p>
                            </div>
                            <FormControl>
                                <Switch checked={!field.value} onCheckedChange={(on) => field.onChange(!on)} />
                            </FormControl>
                        </FormItem>
                    )}
                />
            </SwitchList>

            {withFolders && incremental && (
                <FormField
                    control={form.control}
                    name="fullEveryDays"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Full backup every</FormLabel>
                            <div className="flex items-center gap-2">
                                <FormControl>
                                    <Input
                                        type="number"
                                        min={1}
                                        max={365}
                                        className="w-24"
                                        value={Number.isNaN(field.value) ? "" : field.value}
                                        onChange={(event) => field.onChange(event.target.valueAsNumber)}
                                    />
                                </FormControl>
                                <span className="text-sm text-muted-foreground">days</span>
                            </div>
                            <FormDescription>Starts a new chain this often. Shorter chains use more space and lose less when a full backup is damaged.</FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            )}
        </>
    );
}
