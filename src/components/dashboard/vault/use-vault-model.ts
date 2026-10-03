"use client";

import { usePageModel } from "@/hooks/use-page-model";

/**
 * Loads one tab of the Vault page and loads it again after a change. The Vault changes only when
 * someone changes it, so nothing polls.
 */
export function useVaultModel<T>(url: string) {
    return usePageModel<T>(url, "The Vault could not be loaded.");
}
