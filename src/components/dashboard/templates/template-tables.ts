/**
 * The tabs of the Templates page and the names of their tables, under which each user's column
 * layout is saved. A plain module, so the server page can use them without importing client code.
 */
export const TEMPLATE_TABS = ["retention", "naming", "schedules", "notifications", "excludes"] as const;

export type TemplateTab = (typeof TEMPLATE_TABS)[number];

export const TEMPLATE_TABLE_IDS: Record<TemplateTab, string> = {
    retention: "templates.retention",
    naming: "templates.naming",
    schedules: "templates.schedules",
    notifications: "templates.notifications",
    excludes: "templates.excludes",
};
