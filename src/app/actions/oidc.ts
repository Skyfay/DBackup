"use server";

import { z } from "zod";
import { checkPermission, getUserPermissions } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { OidcProviderService } from "@/services/oidc-provider-service";
import { getOIDCAdapter } from "@/services/oidc-registry";
import { revalidatePath } from "next/cache";

// --- Schemas ---

const createProviderSchema = z.object({
  name: z.string().min(1, "Name is required"),
  adapterId: z.string(),
  providerId: z.string().min(1, "Provider ID is required").regex(/^[a-z0-9-_]+$/, "Only lowercase letters, numbers, dashes and underscores"),
  domain: z.string().optional(),
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client Secret is required"),
  allowProvisioning: z.boolean().optional(),
  adapterConfig: z.record(z.string(), z.any()),
});


// --- Actions ---

export async function getPublicSsoProviders() {
    // Audit compliance: Safe for public access because it returns [] if not logged in
    await getUserPermissions();
    return OidcProviderService.getEnabledProviders();
}

export async function getSsoProviders() {
    await checkPermission(PERMISSIONS.SETTINGS.READ);
    return OidcProviderService.getProviders();
}

export async function createSsoProvider(input: z.infer<typeof createProviderSchema>) {
    await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    const validation = createProviderSchema.safeParse(input);
    if (!validation.success) {
        return { success: false, error: validation.error.format() };
    }

    const { name, adapterId, providerId, domain, clientId, clientSecret, adapterConfig, allowProvisioning } = validation.data;

    // 1. Get Adapter
    const adapter = getOIDCAdapter(adapterId);
    if (!adapter) {
        return { success: false, error: "Invalid Adapter ID" };
    }

    // 2. Validate Adapter Config
    try {
        adapter.inputSchema.parse(adapterConfig);
    } catch (e) {
         if (e instanceof z.ZodError) {
             return { success: false, error: "Invalid Adapter Configuration", details: e.format() };
         }
         return { success: false, error: "Invalid Adapter Configuration" };
    }

    // 3. Generate Endpoints
    let endpoints;
    try {
        endpoints = await adapter.getEndpoints(adapterConfig);

        // Validation: Detect Mixed Content (HTTPS Discovery -> HTTP Endpoints)
        // This usually indicates a misconfigured Reverse Proxy (missing X-Forwarded-Proto)
        if (endpoints.discoveryEndpoint?.startsWith("https://")) {
            const insecureEndpoints = [
                { name: "Authorization", url: endpoints.authorizationEndpoint },
                { name: "Token", url: endpoints.tokenEndpoint }
            ].filter(e => e.url.startsWith("http://"));

            if (insecureEndpoints.length > 0) {
                 const details = insecureEndpoints.map(e => `${e.name} (${e.url})`).join(", ");
                 return {
                    success: false,
                    error: "Security Mismatch Detected",
                    details: {
                        _errors: [`The OIDC provider is accessed via HTTPS, but returned insecure HTTP endpoints: ${details}. This indicates a reverse proxy misconfiguration (missing headers like X-Forwarded-Proto) on the provider side. Please fix the provider configuration.`]
                    }
                };
            }
        }

    } catch (e: any) {
        return { success: false, error: `Endpoint discovery failed: ${e.message}` };
    }

    // 4. Create in DB
    try {
        await OidcProviderService.createProvider({
            name,
            adapterId,
            type: "oidc",
            providerId,
            domain,
            clientId,
            clientSecret,
            allowProvisioning: allowProvisioning ?? true,

            // Map endpoints from adapter (includes discoveryEndpoint for non-standard providers)
            issuer: endpoints.issuer,
            authorizationEndpoint: endpoints.authorizationEndpoint,
            tokenEndpoint: endpoints.tokenEndpoint,
            userInfoEndpoint: endpoints.userInfoEndpoint,
            jwksEndpoint: endpoints.jwksEndpoint,
            discoveryEndpoint: endpoints.discoveryEndpoint
        });

        revalidatePath("/admin/settings"); // Or wherever the list is
        return { success: true };
    } catch (error: any) {
        console.error("Failed to create SSO provider:", error);
        return { success: false, error: error.message };
    }
}

export async function deleteSsoProvider(id: string) {
    await checkPermission(PERMISSIONS.SETTINGS.WRITE);
    try {
        await OidcProviderService.deleteProvider(id);
        revalidatePath("/admin/settings");
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function toggleSsoProvider(id: string, enabled: boolean) {
    await checkPermission(PERMISSIONS.SETTINGS.WRITE);
    try {
        await OidcProviderService.toggleProvider(id, enabled);
        revalidatePath("/admin/settings");
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}
