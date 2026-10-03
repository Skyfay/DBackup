import type { Ref } from "react";
import type { TablePreferences } from "@/lib/core/table-preferences";
import type { TemplatesModel } from "@/services/templates/templates-types";

/** What the page around a tab can start, New beside the tabs. */
export interface TemplateTabHandle {
    openCreate: () => void;
}

/** What every tab of the Templates page gets from the page. */
export interface TemplateTabProps {
    ref?: Ref<TemplateTabHandle>;
    /** Null while the templates load. */
    model: TemplatesModel | null;
    isLoading: boolean;
    refresh: () => void;
    /** After a change, the rows and the counts beside the tabs load again. */
    afterChange: () => void;
    cards: boolean;
    /** Everything but looking needs the right to write templates. */
    canManage: boolean;
    initialLayout: TablePreferences | null;
}
