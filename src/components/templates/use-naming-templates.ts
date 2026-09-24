"use client";

import { useEffect, useState } from "react";
import type { NamingTemplate } from "@prisma/client";
import { toast } from "sonner";
import { getNamingTemplates } from "@/app/actions/templates";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ component: "useNamingTemplates" });

/** A naming template with how many jobs name their backups by it. */
export type ListedNamingTemplate = NamingTemplate & { _count?: { jobs: number } };

const byName = (a: NamingTemplate, b: NamingTemplate) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** The naming templates, loaded once, and a way to put in one that was made or changed here. */
export function useNamingTemplates() {
    const [templates, setTemplates] = useState<ListedNamingTemplate[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fail = () => toast.error("The naming templates could not be loaded.");
        getNamingTemplates()
            .then((res) => {
                if (res.success && res.data) setTemplates(res.data);
                else fail();
            })
            .catch((error: unknown) => {
                log.warn("Naming templates could not be loaded", {}, wrapError(error));
                fail();
            })
            .finally(() => setLoading(false));
    }, []);

    /** A saved template comes without its jobs, which a change does not touch. */
    const saved = (template: NamingTemplate) =>
        setTemplates((list) =>
            [...list.filter((entry) => entry.id !== template.id), { ...template, _count: list.find((entry) => entry.id === template.id)?._count ?? { jobs: 0 } }].sort(byName),
        );

    return { templates, loading, saved };
}
