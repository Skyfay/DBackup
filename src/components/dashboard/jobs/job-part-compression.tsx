"use client";

import { useFormContext } from "react-hook-form";
import { Info } from "lucide-react";
import { ChoiceCards, type ModeOption } from "@/components/adapter/connection-mode-choice";
import { FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Slider } from "@/components/ui/slider";
import { PG_LEVELS, type JobFormValues, type PgCompressionAlgo } from "./job-form-schema";
import { PartSection } from "./job-part-section";

type DumpAlgo = Exclude<PgCompressionAlgo, "LEGACY">;

/** What pg_dump can compress with, and the PostgreSQL each one needs. */
const DUMP: { value: DumpAlgo; title: string; description: string; since?: number }[] = [
    { value: "GZIP", title: "Gzip", description: "The usual pick, works everywhere" },
    { value: "LZ4", title: "LZ4", description: "Fastest, a little larger", since: 14 },
    { value: "ZSTD", title: "Zstd", description: "Small and fast", since: 16 },
    { value: "NONE", title: "None", description: "DBackup compresses the backup instead" },
];

/** What DBackup itself compresses a backup with. */
const ARCHIVE: ModeOption[] = [
    { value: "NONE", title: "None", description: "Fastest, keeps the full size" },
    { value: "GZIP", title: "Gzip", description: "Small and fast, the usual pick" },
    { value: "BROTLI", title: "Brotli", description: "Smallest, takes longer" },
];

interface CompressionPartProps {
    isPostgres: boolean;
    pgMajorVersion: number | null;
}

/**
 * How the backups are made smaller: pg_dump compresses a PostgreSQL dump itself, DBackup
 * compresses everything else, and the part says which of them does what. Every option is a card
 * with what it is good for, the level of pg_dump a slider between faster and smaller.
 */
export function CompressionPart({ isPostgres, pgMajorVersion }: CompressionPartProps) {
    const form = useFormContext<JobFormValues>();
    const withFolders = form.watch("sourceMode") !== "db";
    const algo = form.watch("pgCompressionAlgo");
    // The default of older jobs lets pg_dump use gzip at level 6, which is what Gzip at 6 does too.
    const dumpAlgo: DumpAlgo = algo === "LEGACY" ? "GZIP" : algo;
    const levels = PG_LEVELS[dumpAlgo];
    const native = isPostgres && dumpAlgo !== "NONE";

    const dumpOptions: ModeOption[] = DUMP.map((option) => {
        const tooOld = option.since !== undefined && pgMajorVersion !== null && pgMajorVersion < option.since;
        return {
            value: option.value,
            title: option.title,
            description: option.description,
            badge: tooOld ? `Needs PostgreSQL ${option.since}` : option.value === "GZIP" ? "Default" : undefined,
            disabled: tooOld,
        };
    });

    const pickDump = (value: string) => {
        const next = value as DumpAlgo;
        form.setValue("pgCompressionAlgo", next, { shouldDirty: true });
        const range = PG_LEVELS[next];
        if (range) form.setValue("pgCompressionLevel", range.default, { shouldDirty: true });
    };

    return (
        <>
            {isPostgres && (
                <PartSection title="The dump" hint={pgMajorVersion !== null ? `pg_dump · PostgreSQL ${pgMajorVersion}` : "pg_dump"}>
                    <ChoiceCards value={dumpAlgo} onValueChange={pickDump} options={dumpOptions} aria-label="How pg_dump compresses the dump" />
                    {levels && (
                        <FormField
                            control={form.control}
                            name="pgCompressionLevel"
                            render={({ field }) => {
                                const value = algo === "LEGACY" ? 6 : field.value;
                                const low = levels.values[0];
                                const high = levels.values[levels.values.length - 1];
                                return (
                                    <FormItem className="gap-2.5 pt-2">
                                        <div className="flex items-baseline justify-between gap-3">
                                            <FormLabel>
                                                Level {value}
                                                {value === levels.default && <span className="font-normal text-muted-foreground"> · the default</span>}
                                            </FormLabel>
                                            <span className="text-xs text-muted-foreground">
                                                {low} to {high}
                                            </span>
                                        </div>
                                        <FormControl>
                                            <Slider
                                                min={low}
                                                max={high}
                                                step={1}
                                                value={[value]}
                                                mark={levels.default}
                                                onValueChange={([next]) => {
                                                    // A job on the old default moves to Gzip, the same thing with a level of its own.
                                                    if (algo === "LEGACY") form.setValue("pgCompressionAlgo", "GZIP", { shouldDirty: true });
                                                    field.onChange(next);
                                                }}
                                                aria-label="Level"
                                            />
                                        </FormControl>
                                        <div className="flex justify-between text-xs text-muted-foreground">
                                            <span>Faster</span>
                                            <span>Smaller</span>
                                        </div>
                                        {dumpAlgo === "ZSTD" && value > 19 && (
                                            <p className="text-xs text-muted-foreground">Levels above 19 need a lot of memory, when the backup is made and when it is restored.</p>
                                        )}
                                    </FormItem>
                                );
                            }}
                        />
                    )}
                </PartSection>
            )}

            {(!native || withFolders) && (
                <FormField
                    control={form.control}
                    name="compression"
                    render={({ field }) => (
                        <FormItem>
                            <PartSection title={native ? "The folders" : "The backup"} hint={isPostgres && !native ? "compressed by DBackup instead" : "compressed by DBackup"}>
                                <FormControl>
                                    <ChoiceCards
                                        value={field.value}
                                        onValueChange={field.onChange}
                                        options={ARCHIVE}
                                        className="sm:grid-cols-3"
                                        aria-label={native ? "How DBackup compresses the folders" : "How DBackup compresses the backup"}
                                    />
                                </FormControl>
                            </PartSection>
                        </FormItem>
                    )}
                />
            )}

            {native && (
                <p className="flex gap-2.5 text-sm text-muted-foreground">
                    <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    {withFolders
                        ? "pg_dump compresses the dump while it writes it, DBackup compresses the folders."
                        : "pg_dump compresses the dump while it writes it, so DBackup does not compress it a second time."}
                </p>
            )}
        </>
    );
}
