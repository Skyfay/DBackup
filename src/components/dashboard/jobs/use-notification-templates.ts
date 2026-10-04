"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getNotificationTemplates } from "@/app/actions/templates";
import type { NotificationTemplateItem } from "@/components/templates/notification-model";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ component: "useNotificationTemplates" });

const byName = (a: NotificationTemplateItem, b: NotificationTemplateItem) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** The notification templates, loaded once, and a way to put in one that was made or changed here. */
export function useNotificationTemplates() {
    const [templates, setTemplates] = useState<NotificationTemplateItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        const fail = () => {
            setFailed(true);
            toast.error("The notification templates could not be loaded.");
        };
        getNotificationTemplates()
            .then((res) => {
                if (res.success && res.data) setTemplates(res.data);
                else fail();
            })
            .catch((error: unknown) => {
                log.warn("Notification templates could not be loaded", {}, wrapError(error));
                fail();
            })
            .finally(() => setLoading(false));
    }, []);

    /** A saved template comes without its jobs, which a change does not touch. */
    const saved = (template: NotificationTemplateItem) =>
        setTemplates((list) =>
            [...list.filter((entry) => entry.id !== template.id), { ...template, _count: list.find((entry) => entry.id === template.id)?._count ?? { jobs: 0 } }].sort(byName),
        );

    return { templates, loading, failed, saved };
}
