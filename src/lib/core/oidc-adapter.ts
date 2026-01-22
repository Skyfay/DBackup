import { z } from "zod";

export interface OIDCInput {
  name: string;
  label: string;
  type: "text" | "password" | "url";
  placeholder?: string;
  required?: boolean;
  description?: string;
  defaultValue?: string;
}

export type OIDCEndpoints = {
  issuer?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userInfoEndpoint: string;
  jwksEndpoint?: string;
};

export interface OIDCAdapter {
  id: string;
  name: string;
  description: string;
  icon?: string; // We can use Lucide icon names or SVG strings later
  
  /**
   * Fields required from the user configuration
   */
  inputs: OIDCInput[];

  /**
   * Validation schema for the inputs
   */
  inputSchema: z.ZodObject<any>;

  /**
   * Generates the standard OIDC endpoints based on user input (e.g. Base URL)
   */
  getEndpoints: (config: Record<string, any>) => Promise<OIDCEndpoints> | OIDCEndpoints;
}
