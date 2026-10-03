"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { transferConcurrencyRange } from "@/lib/adapters/transfer-concurrency";
import { s3UploadTuningRange, s3UploadMemoryBudget, S3_MIN_PART_SIZE_MB } from "@/lib/adapters/s3-upload-tuning";
import { formatBytes } from "@/lib/utils";

/** A whole number from an input, or null while the field holds something that is not one yet. */
function parseCount(text: string): number | null {
    const parsed = parseInt(text, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * How many files this connection transfers at once, bounded by what the adapter allows.
 *
 * Belongs to the connection rather than to a global setting because the right number depends on
 * the server at the other end - the same installation can hold a NAS that welcomes sixteen
 * parallel transfers and a cloud drive that rate-limits above four.
 */
export function ParallelTransfersField({ adapterId, value, onChange }: {
    adapterId: string;
    value: number | undefined;
    onChange: (value: number) => void;
}) {
    const id = useId();
    const range = transferConcurrencyRange(adapterId);
    // Clamped for display, not just on input: a ceiling lowered in a later version leaves stored
    // values above it, and the runtime clamps them anyway. Showing the stored number would claim
    // a parallelism the connection will never actually use.
    const current = Math.min(range.max, value ?? range.default);

    return (
        <div className="grid gap-2">
            <Label htmlFor={id}>Parallel transfers</Label>
            <Input
                id={id}
                type="number"
                min={1}
                max={range.max}
                value={current}
                disabled={range.max <= 1}
                className="w-24"
                onChange={(event) => {
                    const parsed = parseCount(event.target.value);
                    if (parsed !== null) onChange(Math.min(range.max, Math.max(1, parsed)));
                }}
            />
            <p className="text-xs text-muted-foreground">
                {range.max === range.default
                    ? `Files read at the same time. This provider rate-limits concurrent transfers, so ${range.max} is both the default and the maximum.`
                    : `Files read at the same time, 1 to ${range.max}, default ${range.default}. More helps over a high-latency link, too many can exhaust a server's connection limit.`}
            </p>
        </div>
    );
}

/**
 * How one archive is split across parallel connections on the way to an object store.
 *
 * Separate from `ParallelTransfersField` above, which counts whole files and only means
 * something for a directory source. A backup destination receives one archive per run, so the
 * parallelism has to happen inside that single upload instead.
 *
 * The two inputs sit together and show their product because they are meaningless apart: the
 * peak memory of an upload is the parts in flight times their size, so the same step in
 * parallelism costs eight times as much on 64 MB parts as on 8 MB ones.
 *
 * The part size is asked for as a maximum rather than a value, because the size that performs
 * depends on how large the archive turns out to be and the archive differs every run. What the
 * user can actually decide is how much memory to spend, which is what a ceiling expresses.
 * `resolveS3UploadTuning` picks the largest size at or below it that still keeps every
 * connection busy.
 */
export function ParallelUploadFields({ adapterId, concurrency, partSizeMb, onConcurrencyChange, onPartSizeChange }: {
    adapterId: string;
    concurrency: number | undefined;
    partSizeMb: number | undefined;
    onConcurrencyChange: (value: number) => void;
    onPartSizeChange: (value: number) => void;
}) {
    const concurrencyId = useId();
    const partSizeId = useId();
    const range = s3UploadTuningRange(adapterId);
    if (!range) return null;

    // Clamped for display for the same reason as the parallel transfers above.
    const currentConcurrency = Math.min(range.concurrency.max, concurrency ?? range.concurrency.default);
    const currentPartSize = Math.min(range.partSizeMb.max, Math.max(S3_MIN_PART_SIZE_MB, partSizeMb ?? range.partSizeMb.default));

    return (
        <div className="grid gap-3">
            <div className="grid gap-0.5">
                <p className="text-sm font-medium">Parallel upload parts</p>
                <p className="text-xs text-muted-foreground">
                    A backup is uploaded as several parts at once. More parts use more of a fast link, at the cost of memory while the upload runs.
                </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                    <Label htmlFor={concurrencyId}>Parts at once</Label>
                    <Input
                        id={concurrencyId}
                        type="number"
                        min={1}
                        max={range.concurrency.max}
                        value={currentConcurrency}
                        onChange={(event) => {
                            const parsed = parseCount(event.target.value);
                            if (parsed !== null) onConcurrencyChange(Math.min(range.concurrency.max, Math.max(1, parsed)));
                        }}
                    />
                </div>
                <div className="grid gap-2">
                    <Label htmlFor={partSizeId}>Largest part (MB)</Label>
                    <Input
                        id={partSizeId}
                        type="number"
                        min={S3_MIN_PART_SIZE_MB}
                        max={range.partSizeMb.max}
                        value={currentPartSize}
                        onChange={(event) => {
                            const parsed = parseCount(event.target.value);
                            if (parsed !== null) onPartSizeChange(Math.min(range.partSizeMb.max, Math.max(S3_MIN_PART_SIZE_MB, parsed)));
                        }}
                    />
                </div>
            </div>
            <p className="text-xs text-muted-foreground">
                Uses up to <span className="font-medium text-foreground">{formatBytes(s3UploadMemoryBudget(currentConcurrency, currentPartSize))}</span> of
                memory per upload. Smaller backups use smaller parts on their own, so every connection still gets one. Defaults
                are {range.concurrency.default} parts of {range.partSizeMb.default} MB, at most {range.concurrency.max} parts
                of {range.partSizeMb.max} MB.
            </p>
        </div>
    );
}
