# Authentication System

This document explains the authentication architecture, which relies on **Better-Auth** to provide a secure, type-safe identity layer including 2FA, Passkeys, and Session Management.

## Architecture Overview

We strictly separate **Server-Side Auth** and **Client-Side Auth**.

### Core Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Server Auth | `src/lib/auth.ts` | Better-Auth instance with Prisma adapter |
| Client Auth | `src/lib/auth-client.ts` | React hooks (`useSession`) |
| Middleware | `src/middleware.ts` | Route protection (Edge) |
| Session Utils | `src/lib/session.ts` | Server-side session helpers |

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Client         │────▶│  Middleware      │────▶│  Server Action  │
│  (React)        │     │  (Edge Runtime)  │     │  or API Route   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                       │                        │
        │                       │                        │
        ▼                       ▼                        ▼
   useSession()           Session Check            checkPermission()
```

## Protection Layers

### Layer 1: Middleware (Edge)

The middleware runs before any component rendering.

**Location**: `src/middleware.ts`

```typescript
export async function middleware(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  // Protect dashboard routes
  if (request.nextUrl.pathname.startsWith('/dashboard')) {
    if (!session) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return NextResponse.next();
}
```

::: warning
Middleware does NOT check fine-grained permissions (RBAC), only authentication status.
:::

### Layer 2: API Route Handlers

Every sensitive API route MUST verify the session explicitly.

```typescript
// src/app/api/jobs/route.ts
export async function POST(req: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  // Proceed with permission check...
  await checkPermission(PERMISSIONS.JOBS.WRITE);

  // Handle request...
}
```

### Layer 3: Server Actions

Server Actions act as the public API for the frontend and must:
1. Validate the session
2. Validate permissions using `checkPermission`

```typescript
// src/app/actions/job.ts
"use server";

export async function createJob(data: JobInput) {
  // 1. Check permission (throws if unauthorized)
  await checkPermission(PERMISSIONS.JOBS.WRITE);

  // 2. Validate input
  const validated = JobSchema.parse(data);

  // 3. Execute business logic
  return jobService.create(validated);
}
```

## Advanced Features

### Two-Factor Authentication (2FA)

We use TOTP (Time-based One-Time Password).

**Enabling 2FA:**
1. User initiates setup in Profile → Security
2. Server generates a secret key
3. User scans QR code with authenticator app
4. User verifies with a code to confirm setup
5. Secret is stored encrypted in the database

**Verification Flow:**
```typescript
// During login, if 2FA is enabled
if (user.twoFactorEnabled) {
  // Return partial session, require 2FA verification
  return { requiresTwoFactor: true, tempToken: "..." };
}
```

### Passkeys (WebAuthn)

Allows passwordless login using biometric sensors (TouchID, FaceID, Windows Hello).

**Registration:**
1. Client generates a public/private key pair
2. Public key is sent to server and stored
3. Private key remains securely on device

**Authentication:**
1. Server sends a "challenge"
2. Client signs it with private key
3. Server verifies signature with stored public key

### SSO / OIDC

See [SSO Integration](./sso.md) for detailed OIDC implementation.

## Session Management

### Configurable Session Duration

Session lifetime is configurable by administrators as **Sessions last** under Settings → Sign-in. The value is stored in the `SystemSetting` table under the key `auth.sessionDuration` (in seconds).

```typescript
// src/lib/auth.ts - Dynamic session expiry via database hook
databaseHooks: {
  session: {
    create: {
      before: async (session) => {
        const duration = await getSessionDuration(); // reads SystemSetting
        const expiresAt = new Date(Date.now() + duration * 1000);
        return { data: { ...session, expiresAt } };
      },
    },
  },
},
```

**Default:** 7 days (604800 seconds). Available options: 1h, 8h, 1d, 3d, 7d, 14d, 30d, 90d.

The `session.expiresIn` config serves as fallback when no database setting exists. The `databaseHooks.session.create.before` hook dynamically overrides `expiresAt` for every new session based on the admin-configured value.

### Session Listing & Revocation

Better Auth provides built-in endpoints for session management:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/auth/list-sessions` | GET | List all sessions for the current user |
| `/api/auth/revoke-session` | POST | Revoke a specific session by token |
| `/api/auth/revoke-other-sessions` | POST | Revoke all sessions except the current one |

Client-side usage:

```typescript
import { authClient } from "@/lib/auth/client";

// List sessions
const { data: sessions } = await authClient.listSessions();

// Revoke a specific session
await authClient.revokeSession({ token: session.token });

// Revoke all other sessions
await authClient.revokeOtherSessions();
```

Each session record includes `ipAddress`, `userAgent`, `createdAt`, `updatedAt`, and `expiresAt` fields, populated automatically by Better Auth.

### Server-Side Session Access

```typescript
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function getServerSession() {
  return auth.api.getSession({
    headers: await headers(),
  });
}
```

### Client-Side Session Access

```typescript
import { useSession } from "@/lib/auth/client";

function ProfileButton() {
  const { data: session, isPending } = useSession();

  if (isPending) return <Skeleton />;
  if (!session) return <LoginButton />;

  return <Avatar user={session.user} />;
}
```

## API Key Authentication

In addition to session-based authentication, DBackup supports stateless API key authentication for programmatic access (CI/CD, cron jobs, external tools).

API keys use `Authorization: Bearer dbackup_xxx` headers and are validated via SHA-256 hash lookup. They have their own permission set and **never** inherit SuperAdmin privileges.

All API routes support both authentication methods through the unified `getAuthContext()` function.

→ See [API Keys & Webhooks](./api-keys.md) for the full architecture, key generation, validation flow, and webhook trigger system.

## Security Best Practices

1. **Never trust client-side checks alone** - Always verify on server
2. **Use `getAuthContext()` + `checkPermissionWithContext()` in API routes** - Supports both session and API key auth
3. **Use `checkPermission()` in Server Actions** - Session-only, defense in depth
4. **Log authentication events** - Use the Audit System
5. **Implement rate limiting** - Prevent brute force attacks
6. **Secure session cookies** - HttpOnly, Secure, SameSite
7. **API keys: hash-only storage** - Never persist raw keys
