import { OIDCAdapter } from "@/lib/core/oidc-adapter";
import { z } from "zod";

export const KeycloakAdapter: OIDCAdapter = {
  id: "keycloak",
  name: "Keycloak",
  description: "Configuration for Keycloak Identity Provider",

  inputs: [
    {
      name: "baseUrl",
      label: "Keycloak URL",
      type: "url",
      placeholder: "https://auth.company.com",
      required: true,
      description: "The root URL of your Keycloak instance"
    },
    {
      name: "realm",
      label: "Realm Name",
      type: "text",
      placeholder: "master",
      required: true,
      description: "The name of the realm to authenticate against"
    }
  ],

  inputSchema: z.object({
    baseUrl: z.string().url(),
    realm: z.string().min(1, "Realm is required")
  }),

  getEndpoints: async (config) => {
    // Remove trailing slash from baseUrl
    const baseUrl = config.baseUrl.replace(/\/$/, "");
    // Default Keycloak Discovery Path
    // Keycloak < 18: /auth/realms/{realm}/.well-known/openid-configuration
    // Keycloak >= 18 (Quarkus): /realms/{realm}/.well-known/openid-configuration
    // We assume the user provides the base URL correctly. If they are on legacy, they might need to include /auth in the base URL input.
    // Standard approach for modern Keycloak:
    const discoveryUrl = `${baseUrl}/realms/${config.realm}/.well-known/openid-configuration`;

    try {
      const response = await fetch(discoveryUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; DatabaseBackupManager/1.0; +https://gitlab.com/Skyfay/database-backup-manager)",
          "Accept": "application/json"
        }
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch OIDC config from ${discoveryUrl}. Status: ${response.status}`);
      }
      const data = await response.json();

      return {
        issuer: data.issuer,
        authorizationEndpoint: data.authorization_endpoint,
        tokenEndpoint: data.token_endpoint,
        userInfoEndpoint: data.userinfo_endpoint,
        jwksEndpoint: data.jwks_uri,
        discoveryEndpoint: discoveryUrl
      };
    } catch (error) {
       console.error("Keycloak discovery failed:", error);
       throw error;
    }
  }
};
