# OIDC Integration Implementation Plan

## 1. Overview
This document outlines the implementation plan for adding OpenID Connect (OIDC) support to the Database Backup Manager.
We will leverage the **`better-auth` SSO Plugin** to handle the protocol complexity, while implementing an **Adapter Pattern** to support various providers (Authentik, PocketID, Generic, etc.) with specific UI presets and default configurations.

## 2. Architecture & Concept

### 2.1. The "Adapter" Concept
Since `better-auth` handles the raw OIDC protocol, our "Adapters" will serve as **Configuration Generators**.
Instead of implementing the auth flow manually, an adapter (e.g., `AuthentikAdapter`) provides:
1.  **Metadata**: Name, Icon, Description.
2.  **Input Fields**: What does the admin need to enter? (e.g., for Authentik just the Base URL + Client ID/Secret, the adapter calculates the endpoints).
3.  **Default Mapping**: How to map the provider's user response to our User model.

### 2.2. User Lifecycle Strategy
We will support two modes for OIDC logins:
1.  **Account Linking (Existing Users)**:
    -   If a user logs in via OIDC and the email matches an existing account, they are linked (security checks typically require email verification).
2.  **Auto-Provisioning (New Users)**:
    -   If enabled in settings, a new user is created upon successful OIDC login.
    -   **Permissions**: New users get **NO** permissions (0 groups) by default (Zero-Trust) unless a "Default Group" is configured in global settings.

## 3. Database Schema
We need to align our existing (unused/partial) schema with `better-auth` SSO requirements.

### Required Changes (`prisma/schema.prisma`)
The `better-auth` SSO plugin requires a model to store provider configs.

```prisma
model SsoProvider {
  id             String   @id @default(cuid())
  providerId     String   @unique // e.g. "authentik-main"
  type           String   @default("oidc") // "oidc" or "saml"

  // OIDC Specific Fields (Managed by Better-Auth)
  issuer         String?
  authorizationEndpoint String?
  tokenEndpoint  String?
  userInfoEndpoint String?
  jwksEndpoint   String?

  // Credentials
  clientId       String?
  clientSecret   String?

  // Custom App Logic
  adapterId      String   // e.g. "authentik", "pocket-id"
  name           String   // Display Name e.g. "Corporate Login"
  enabled        Boolean  @default(true)

  userId         String? // Optional: If linked to a specific user (Account Linking) logic, usually null for global SSO

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@map("sso_provider")
}
```

*Note: The existing `OIDCProvider` model can be migrated or replaced by this standard `sso_provider` model.*

## 4. Implementation Steps (Tasks)

### Phase 1: Core Setup & Schema
- [ ] **Install Plugin**: Add `@better-auth/sso` package.
- [ ] **Update Prisma Schema**:
    -   Add `SsoProvider` model (as defined above).
    -   Run `prisma migrate dev`.
- [ ] **Better-Auth Config**:
    -   Register `sso()` plugin in `src/lib/auth.ts`.
    -   Configure the `sso` plugin to use the prisma adapter.

### Phase 2: Adapter System (Backend)
- [ ] **Interface Definition**: Create `src/lib/core/oidc-adapter.ts`.
    -   Define `OIDCAdapter` interface (`getBetterAuthId()`, `getEndpoints(baseUrl)`, `defaultMappings`).
- [ ] **Implement Adapters**:
    -   `AuthentikAdapter`: Asks for Base URL, generates standard path `/application/o/authorize/` etc.
    -   `PocketIDAdapter`: Specific paths.
    -   `AuraAdapter`: (If applicable).
    -   `GenericAdapter`: User manually enters all URLs.
- [ ] **Adapter Registry**: Create `src/services/oidc-registry.ts` to manage available adapters.

### Phase 3: Administration UI
- [ ] **Settings Integration**:
    -   Add "SSO / OIDC" tab in `Admin > Settings` (or `Users & Groups`).
- [ ] **List View**:
    -   Show configured providers (Name, Adapter Type, Status).
- [ ] **Create/Edit Dialog**:
    -   Step 1: Select Adapter (Grid Layout with Icons).
    -   Step 2: Dynamic Form based on Adapter requirements (using Zod schemas).
    -   Step 3: Save (Server Action -> Writes to `sso_provider` table).

### Phase 4: Authentication Flow (Frontend)
- [ ] **Login Page Update**:
    -   Fetch active SSO providers via client-side helper or server props.
    -   Render "Continue with [Provider Name]" buttons.
    -   Implement `signIn.sso({ providerId })` call.
- [ ] **Profile Linking (Optional/Roadmap)**:
    -   Allow logged-in users to link an SSO provider from their profile settings.

### Phase 5: Permission & Security
- [ ] **Auto-Provisioning Logic**:
    -   Verify how `better-auth` handles new users.
    -   Ensure new users have `isTwoFactorEnabled: false` initially but enforced if policy dictates.
    -   **Crucial**: Check that new users are NOT Admins.

## 5. Development Guidelines
-   **Security**: `clientSecret` must be stored securely. Better-Auth usually handles this, but ensure we don't leak it in API responses to the frontend.
-   **Validation**: Use `zod` for validating the configurations (URLs are valid, Client IDs are present).
-   **Testing**: Test with a local Authentik instance or Keycloak container.

## 6. Adapter Specifications

### Generic Adapter
-   **Inputs**: Client ID, Secret, Issuer URL, Auth Endpoint, Token Endpoint, UserInfo Endpoint.
-   **Logic**: Passes values 1:1.

### Authentik Adapter
-   **Inputs**: Base URL (e.g. `https://auth.company.com`), Slug (optional), Client ID, Secret.
-   **Logic**: Auto-discover endpoints using `.well-known/openid-configuration` or construct standard paths.

### PocketID Adapter
-   **Inputs**: Base URL.
-   **Logic**: Standard OIDC discovery.
