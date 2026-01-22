import { OIDCAdapter } from "@/lib/core/oidc-adapter";
import { z } from "zod";

export const PocketIDAdapter: OIDCAdapter = {
  id: "pocket-id",
  name: "PocketID",
  description: "Configuration for PocketID",
  
  inputs: [
    {
      name: "baseUrl",
      label: "PocketID URL",
      type: "url",
      placeholder: "https://pid.company.com",
      required: true,
      description: "The root URL of your PocketID instance"
    }
  ],

  inputSchema: z.object({
    baseUrl: z.string().url()
  }),

  getEndpoints: async (config) => {
    const baseUrl = config.baseUrl.replace(/\/$/, "");
    const discoveryUrl = `${baseUrl}/.well-known/openid-configuration`;

    try {
      const response = await fetch(discoveryUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch OIDC config from ${discoveryUrl}. Status: ${response.status}`);
      }
      const data = await response.json();

      return {
        issuer: data.issuer,
        authorizationEndpoint: data.authorization_endpoint,
        tokenEndpoint: data.token_endpoint,
        userInfoEndpoint: data.userinfo_endpoint,
        jwksEndpoint: data.jwks_uri
      };
    } catch (error) {
       console.error("PocketID discovery failed:", error);
       throw error;
    }
  }
};
