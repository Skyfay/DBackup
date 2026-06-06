"use client";

import { createContext, useContext } from "react";

/**
 * Provides the `secretStatus` map from the adapter list DTO (which sensitive
 * fields already have a stored value) down to individual form fields, so a
 * secret input can render a "saved — leave blank to keep" placeholder instead
 * of looking empty. The API never sends the secret value itself.
 */
const SecretStatusContext = createContext<Record<string, boolean>>({});

export const SecretStatusProvider = SecretStatusContext.Provider;

export function useSecretStatus(): Record<string, boolean> {
    return useContext(SecretStatusContext);
}
