import { OIDCAdapter } from "@/lib/core/oidc-adapter";
import { z } from "zod";

export const AuthentikAdapter: OIDCAdapter = {
  id: "authentik",
  name: "Authentik",
  description: "Configuration for Authentik Identity Provider",
  
  inputs: [
    {
      name: "baseUrl",
      label: "Authentik Base URL",
      type: "url",
      placeholder: "https://auth.company.com",
      required: true,
      description: "The root URL of your Authentik instance"
    },
    {
      name: "slug",
      label: "Application Slug",
      type: "text",
      placeholder: "database-backup",
      required: true,
      description: "The URL slug of the Application in Authentik"
    }
  ],

  inputSchema: z.object({
    baseUrl: z.string().url(),
    slug: z.string().min(1)
  }),

  getEndpoints: async (config) => {
    // Construct discovery URL
    // Remove trailing slash from baseUrl if present
    const baseUrl = config.baseUrl.replace(/\/$/, "");
    const discoveryUrl = `${baseUrl}/application/o/${config.slug}/.well-known/openid-configuration`;

    try {
      const response = await fetch(discoveryUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch OIDC config from ${discoveryUrl}. Status: ${response.status}`);
      }
      const data = await response.json();

      if (!data.authorization_endpoint || !data.token_endpoint || !data.userinfo_endpoint) {
          throw new Error("Invalid OIDC configuration received: missing endpoints.");
      }

      return {
        issuer: data.issuer,
        authorizationEndpoint: data.authorization_endpoint,
        tokenEndpoint: data.token_endpoint,
        userInfoEndpoint: data.userinfo_endpoint,
        jwksEndpoint: data.jwks_uri
      };
    } catch (error) {
       console.error("Authentik discovery failed:", error);
       // Fallback or re-throw? Re-throwing ensures the admin sees the error during setup.
       throw error;
    }
  }
};
