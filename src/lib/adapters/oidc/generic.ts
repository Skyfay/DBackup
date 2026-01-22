import { OIDCAdapter, OIDCEndpoints } from "@/lib/core/oidc-adapter";
import { z } from "zod";

export const GenericAdapter: OIDCAdapter = {
  id: "generic",
  name: "Generic OIDC",
  description: "Manual configuration for any OpenID Connect provider",
  
  inputs: [
    {
      name: "issuer",
      label: "Issuer URL",
      type: "url",
      placeholder: "https://auth.example.com",
      required: true,
      description: "The unique identifier of the OIDC provider"
    },
    {
      name: "authorizationEndpoint",
      label: "Authorization Endpoint",
      type: "url",
      placeholder: "https://auth.example.com/oauth/authorize",
      required: true
    },
    {
      name: "tokenEndpoint",
      label: "Token Endpoint",
      type: "url",
      placeholder: "https://auth.example.com/oauth/token",
      required: true
    },
    {
      name: "userInfoEndpoint",
      label: "User Info Endpoint",
      type: "url",
      placeholder: "https://auth.example.com/oauth/userinfo",
      required: true
    },
    {
      name: "jwksEndpoint",
      label: "JWKS Endpoint",
      type: "url",
      placeholder: "https://auth.example.com/oauth/jwks",
      required: false
    }
  ],

  inputSchema: z.object({
    issuer: z.string().url(),
    authorizationEndpoint: z.string().url(),
    tokenEndpoint: z.string().url(),
    userInfoEndpoint: z.string().url(),
    jwksEndpoint: z.string().url().optional().or(z.literal(""))
  }),

  getEndpoints: (config) => {
    return {
      issuer: config.issuer,
      authorizationEndpoint: config.authorizationEndpoint,
      tokenEndpoint: config.tokenEndpoint,
      userInfoEndpoint: config.userInfoEndpoint,
      jwksEndpoint: config.jwksEndpoint || undefined
    };
  }
};
