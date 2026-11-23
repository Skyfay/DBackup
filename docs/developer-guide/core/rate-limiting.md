# Rate Limiting

The rate limiting system protects the application from abuse by limiting how many requests a client can send within a configurable time window.

## Architecture

The proxy in `src/proxy.ts` runs before every request, in the Node.js runtime of the server process. It counts each request against one of three limiters and answers 429 once a limit is reached.

```
┌───────────────────────────────────────────────────────┐
│  Server process                                       │
│                                                       │
│  startServer() / saving Settings > Rate limits        │
│      │ reloadRateLimits(): reads SystemSetting        │
│      ▼                                                │
│  limiters of the process (globalThis)                 │
│      ▲                                                │
│      │ getAuthLimiter() / getApiLimiter() / ...       │
│  src/proxy.ts: consumes a point per request           │
└───────────────────────────────────────────────────────┘
```

Next.js builds the proxy as a bundle of its own, with its own copy of every module it imports. The limiters therefore live on `globalThis` under `Symbol.for("dbackup.rateLimiters")`, not in the module, so the start, the server action that saves the limits and the proxy share one set of limiters and counters. The proxy never asks the server for its limits over the network.

## Key Files

```
src/lib/rate-limit/
├── index.ts    → Limiters of the process, config constants, getters (applyRateLimitConfig, RATE_LIMIT_DEFAULTS, RATE_LIMIT_KEYS)
└── server.ts   → Server-only functions: reloadRateLimits(), getRateLimitConfig() (uses Prisma)
src/proxy.ts                                           → Enforcement: consume limits
src/app/actions/settings/rate-limit-settings.ts        → Server action: save the limits
src/services/system/rate-limit-settings-service.ts     → Writes the keys and reloads the limiters
src/components/dashboard/settings/rate-limits-part.tsx → The Rate limits part of the Settings page, with the save bar
```

## Rate Limit Module (`src/lib/rate-limit/`)

### Exports

| Export | Context | Description |
| :--- | :--- | :--- |
| `getAuthLimiter()` | Any | Returns the `RateLimiterMemory` instance for auth |
| `getApiLimiter()` | Any | Returns the `RateLimiterMemory` instance for API reads |
| `getMutationLimiter()` | Any | Returns the `RateLimiterMemory` instance for mutations |
| `applyRateLimitConfig(config)` | Any | Rebuilds the limiters whose limit changed, the others keep their counters |
| `reloadRateLimits()` | Server only | Reads DB via Prisma, rebuilds local limiters |
| `getRateLimitConfig()` | Server only | Reads DB and returns config for UI display |
| `RATE_LIMIT_DEFAULTS` | Any | Default values: auth 5/60s, api 100/60s, mutation 20/60s |
| `RATE_LIMIT_KEYS` | Any | SystemSetting key constants |

### Config Flow

1. **Server startup** - `startServer()` calls `reloadRateLimits()` → reads DB → `applyRateLimitConfig()` rebuilds the limiters of the process
2. **Settings change** - the server action saves the keys and calls `reloadRateLimits()` again, which the proxy counts with from the next request on
3. **Request** - the proxy reads the limiters through the getters and consumes one point of the client address

A new `RateLimiterMemory` starts counting from zero, so `applyRateLimitConfig()` keeps a limiter whose points and duration are the ones it already has. Saving one limit leaves the counters of the others alone.

## Proxy Integration

`src/proxy.ts` picks the limiter by the path and method: `auth` for `/api/auth/sign-in*` and the Server Actions of an invitation (`POST /invite`), `api` for other `GET` and `HEAD` requests under `/api/`, `mutation` for any other method there.

### The Address of a Client

Every limiter counts per client address, the key `rateLimitKey(clientAddress(headers))` from `src/lib/core/client-address.ts`, which takes an IPv6 address by its `/64` network. Neither the proxy nor a route can see the socket of a request, so the custom server works the address out and passes it on:

1. `custom-server.ts` calls `clientAddressOf()` of `server/client-address.ts` for every request, with the remote address of the socket, `X-Forwarded-For`, `X-Real-IP`, the proxies of `TRUSTED_PROXIES` and the header of `TRUSTED_PROXY_HEADER`.
2. Only a peer in a trusted network has a forwarded header read, and only the one `TRUSTED_PROXY_HEADER` names, `X-Forwarded-For` by default. A proxy passes on whatever the client sent in the header it does not write, so the other one never counts. `X-Forwarded-For` is read from the right to the first address that is no trusted proxy. The left end is whatever the client wrote and never counts on its own. `X-Real-IP` counts when it holds one address.
3. The result goes into the header `x-dbackup-client-address`, replacing a value the client sent.
4. The proxy, the audit log, the sign-in records and better-auth (`advanced.ipAddress.ipAddressHeaders`) read that header only.

Only the custom server replaces that header, so the app trusts it only while `DBACKUP_CUSTOM_SERVER` is `1`, which `custom-server.ts` sets before it creates the app. Without it, under `pnpm dev` or a plain `next start`, `clientAddress()` answers `null`, every request shares one bucket, and the proxy drops a header the client sent before the app and better-auth read it. `pnpm start` runs the custom server for that reason, `next start` is not supported. `tests/unit/lint-guards/client-address.test.ts` fails when code under `src/` reads `X-Forwarded-For` or `X-Real-IP` itself.

## Database Storage

Rate limit values are stored in the `SystemSetting` table (key-value store):

| Key | Example Value | Description |
| :--- | :--- | :--- |
| `rateLimit.auth.points` | `5` | Auth: max requests |
| `rateLimit.auth.duration` | `60` | Auth: window in seconds |
| `rateLimit.api.points` | `100` | API read: max requests |
| `rateLimit.api.duration` | `60` | API read: window in seconds |
| `rateLimit.mutation.points` | `20` | Mutation: max requests |
| `rateLimit.mutation.duration` | `60` | Mutation: window in seconds |

If no values exist in the DB, the defaults from `RATE_LIMIT_DEFAULTS` are used.

## Server Action

The server action in `src/app/actions/settings/rate-limit-settings.ts` follows the standard pattern:

```typescript
export async function updateRateLimitSettings(data: RateLimitFormData) {
    const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);
    // Zod validation → saveRateLimitConfig() ($transaction of upserts, reloadRateLimits()) → audit → revalidatePath
}
```

**Reset to defaults** in the part puts the defaults into its fields, which the save bar saves like any other change.

## Adding New Rate Limit Categories

1. Add default values to `RATE_LIMIT_DEFAULTS` in `src/lib/rate-limit/index.ts`
2. Add `SystemSetting` keys to `RATE_LIMIT_KEYS`
3. Add a new `RateLimiterMemory` instance in `freshState()`
4. Add a getter function (e.g., `getNewLimiter()`)
5. Update `rebuildLimiters()` to include the new limiter
6. Add the matching `consume()` call in `src/proxy.ts`
7. Add form fields in `src/components/settings/rate-limit-settings.tsx`
8. Add entries in the server action schema and upsert logic
