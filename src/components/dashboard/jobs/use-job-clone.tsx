"use client";

import { useCallback, useState } from "react";
import { CirclePause, ListChecks } from "lucide-react";
import { toast } from "sonner";
import { CloneDialog } from "@/components/ui/clone-dialog";
import type { JobListItem } from "@/services/jobs/job-list-service";
import { namesLike } from "./use-job-list";

/**
 * Clone of the Jobs page: `start` asks for the name of the copy, `dialog` is the dialog that does.
 * The copy gets a name no job has, which needs the names of the jobs on the other pages too, so
 * they are read from the server first.
 */
export function useJobClone(shownNames: string[], onCloned: () => void) {
    const [target, setTarget] = useState<{ id: string; name: string; names: string[] } | null>(null);
    const [cloningId, setCloningId] = useState<string | null>(null);

    const start = useCallback((job: JobListItem) => {
        namesLike(job.name)
            .catch(() => shownNames)
            .then((names) => setTarget({ id: job.id, name: job.name, names }));
    }, [shownNames]);

    const clone = async (id: string, name: string) => {
        setCloningId(id);
        try {
            const res = await fetch(`/api/jobs/${encodeURIComponent(id)}/clone`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok) {
                toast.success("Job cloned");
                onCloned();
            } else {
                toast.error(data?.error || "The job could not be cloned.");
            }
        } catch {
            toast.error("The job could not be cloned.");
        } finally {
            setCloningId(null);
            setTarget(null);
        }
    };

    const dialog = target && (
        <CloneDialog
            title="Clone job"
            from={target.name}
            noun="job"
            existingNames={target.names}
            facts={[
                { icon: ListChecks, text: `The copy has every setting of ${target.name}, the retention policy of each destination included.` },
                { icon: CirclePause, text: "It starts paused and only runs once you turn it on." },
            ]}
            confirmLabel="Clone job"
            isLoading={cloningId !== null}
            onConfirm={(name) => clone(target.id, name)}
            onClose={() => setTarget(null)}
        />
    );

    return { start, cloningId, dialog };
}
