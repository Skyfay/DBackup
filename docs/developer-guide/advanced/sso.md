# SSO / OIDC Integration

Single sign-on runs on the **SSO plugin of better-auth**, which speaks the protocol. DBackup adds adapters that turn a few fields into the endpoints of a provider, stores the providers, and decides on the server who may sign in through which one.

## Where It Lives

| File | Does |
| :--- | :--- |
| `src/lib/core/oidc-adapter.ts` | The `OIDCAdapter` interface |
| `src/lib/adapters/oidc/` | One adapter per provider type: `authelia`, `authentik`, `keycloak`, `pocket-id`, `generic` |
| `src/services/sso/oidc-registry.ts` | `OIDC_ADAPTERS`, the list the dialogs offer |
| `src/services/sso/oidc-discovery.ts` | `discoverEndpoints`: checks the fields of a type and reads its endpoints |
| `src/services/sso/oidc-provider-service.ts` | Creates, changes, switches and deletes providers, encrypting the credentials |
| `src/services/sso/sso-providers-model.ts` | The Sign-in tab of Users & Groups, never the client secret |
| `src/lib/auth/sso-guard.ts` | The hooks that refuse a provider that is off, refuse unwanted sign-ups and place new people in a group |
| `src/components/oidc/provider-logos.ts` | The logos of the provider types |

## Database Schema

```prisma
model SsoProvider {
  id                String   @id @default(cuid())
  providerId        String   @unique  // The end of the callback URL, never changes
  type              String   @default("oidc")
  domain            String?  // An email of this domain goes straight to it from the login page
  domainVerified    Boolean  @default(false)
  oidcConfig        String?  // What better-auth reads, with the encrypted credentials inside
  samlConfig        String?
  issuer                String?
  authorizationEndpoint String?
  tokenEndpoint         String?
  userInfoEndpoint      String?
  jwksEndpoint          String?
  clientId          String?  // Encrypted
  clientSecret      String?  // Encrypted
  adapterId         String   // The provider type
  adapterConfig     String?  // JSON of the fields of the type, like { baseUrl, realm }
  name              String
  enabled           Boolean  @default(true)
  allowProvisioning Boolean  @default(true)  // Adds someone new on their first sign-in
  defaultGroupId    String?  // The group they start in, null for none
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

`defaultGroupId` has no foreign key. Deleting a group moves it to the group its members move to, or clears it, in `group-service.ts`, and a group that is gone anyway leaves new people without one.

### The client secret

The credentials are encrypted with `ENCRYPTION_KEY`, and the extension of the Prisma client in `src/lib/prisma.ts` decrypts `clientId`, `clientSecret` and the credentials inside `oidcConfig` on **every read**, so better-auth gets them in plain text. A whole row is therefore a secret. Anything that leaves the server selects its fields, like `PROVIDER_SELECT` of the tab, and never `clientSecret` or `oidcConfig`. Edit keeps the saved secret when the field stays empty.

## Signing In

1. The login page posts `/api/auth/sign-in/sso` with the provider ID and `requestSignUp` set to `allowProvisioning` of the provider.
2. better-auth sends the browser to the provider, which returns it to `/api/auth/sso/callback/{providerId}`. `BETTER_AUTH_URL` is the start of that URL.
3. better-auth reads the user info. An account linked before signs in. An existing user of the same email is linked, since every provider that is on is a trusted provider (`loadTrustedProviders` in `src/lib/auth/index.ts`). Anyone else is added or turned away.

The hooks in `sso-guard.ts` decide what the browser cannot:

| Hook | Refuses or does |
| :--- | :--- |
| `refuseDisabledProvider`, before every endpoint | Starting a sign-in through a provider that is off, and its callback, which goes back to the login page. Hiding it on the login page is not enough, the endpoints are public |
| `refuseSsoSignUp`, before a user is created | Someone new through a provider that is off or does not add new people, whatever `requestSignUp` said |
| `placeSsoUser`, after a user is created | Puts them into `defaultGroupId` and writes `CREATE USER` with `via: "sso"` to the audit log |

The sign-in itself is written as `LOGIN` with `method: "sso"`, the provider name and its ID, see [Audit Log](/developer-guide/advanced/audit).

## Changing Providers

`GET /api/sso-providers` needs `settings:read` and returns the tab: every provider with its linked people and the ways they have in besides it, the numbers, and for someone with `settings:write` the groups new people can start in.

The Server Actions in `src/app/actions/auth/oidc.ts` need `settings:write`:

| Action | Does |
| :--- | :--- |
| `checkSsoConnection` | Reads the endpoints of a type from its fields, for the dialog and the panel |
| `createSsoProvider` | Reads the endpoints, then saves the provider |
| `updateSsoProvider` | The same without the type and the provider ID, which stay. An empty secret keeps the saved one |
| `toggleSsoProvider`, `deleteSsoProvider` | Switches a provider, deletes it with every link to it |

Whoever controls a provider can add people through it, so a provider never sends new people into a group that may do more than the group of the caller, and only a SuperAdmin picks the SuperAdmin group. A group that stays as it was is not checked again. The rule is `groupLockReason` in `sso-providers-types.ts`, which the dialog uses too.

## Implementing an Adapter

```typescript
export interface OIDCAdapter {
  id: string;
  name: string;
  description: string;
  /** The fields the dialog asks for */
  inputs: OIDCInput[];
  inputSchema: z.ZodObject<any>;
  /** The endpoints from the fields, usually read from the discovery document */
  getEndpoints: (config: Record<string, any>) => Promise<OIDCEndpoints> | OIDCEndpoints;
}
```

1. Add the adapter to `src/lib/adapters/oidc/` and to `OIDC_ADAPTERS`.
2. Call `validateOutboundUrl` before every `fetch`, it keeps the discovery away from cloud metadata endpoints.
3. Return `discoveryEndpoint` too. better-auth calls it in the callback, and providers like Authentik keep it at an unusual path.
4. Add its logo to `provider-logos.ts` and its line and setup steps to `src/components/dashboard/sign-in/sign-in-adapters.ts`.

`discoverEndpoints` runs the schema, calls `getEndpoints`, and refuses a provider without authorization, token or user info endpoint, or one reached over HTTPS that names them over plain HTTP.

## Testing Locally

Run a provider in Docker, like Pocket ID or Keycloak, and use `http://localhost:3000/api/auth/sso/callback/{providerId}` as its redirect URI. The panel of the provider shows the exact URL with Copy.
