"use client";

import { usePageModel } from "@/hooks/use-page-model";
import type { TemplatesModel } from "@/services/templates/templates-types";

/**
 * Loads every template with what uses it, once for all five tabs, and again after a change.
 * Templates change only when someone changes them, so nothing polls.
 */
export function useTemplatesModel() {
    return usePageModel<TemplatesModel>("/api/templates", "The templates could not be loaded.");
}
