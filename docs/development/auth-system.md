# Authentication & Security System

This document explains the authentication architecture, which relies on **Better-Auth** (formerly standard next-auth patterns) to provide a secure, type-safe identity layer including 2FA, Passkeys, and Session Management.

## 1. Architecture Overview

We strictly separate **Server-Side Auth** and **Client-Side Auth**.

### Core Components
*   **`src/lib/auth.ts`**: The Server entry point. Initializes the Better-Auth instance with Prisma adapter and plugins (2FA, Passkeys).
*   **`src/lib/auth-client.ts`**: The Client entry point. Used in React components (hooks like `useSession`).
*   **`src/middleware.ts`**: The first line of defense. Intercepts requests to `/dashboard/*` and `/api/*`.

## 2. Protection Layers

### Layer 1: Middleware (Edge)
The middleware runs before any component rendering.
*   Checks for active session cookie.
*   Redirects unauthenticated users to `/login`.
*   **Note**: Middleware does NOT check fine-grained permissions (RBAC), only authentication status.

### Layer 2: API Route Handlers
Every sensitive API route MUST verify the session explicitly.

```typescript
// Pattern needed in /src/app/api/...
export async function POST(req: Request) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // ... proceed to permission check
}
```

### Layer 3: Server Actions
Server Actions (`src/app/actions/*.ts`) acts as the public API for the frontend.
*   They must validate the session.
*   They must validate permissions using `checkPermission`.

## 3. Advanced Features

### Two-Factor Authentication (2FA)
We use TOTP (Time-based One-Time Password).
*   **Enabling**: Generates a secret key, stored encrypted/hashed in the DB.
*   **Verification**: Middleware or Auth logic challenges the user for a refined token if 2FA is enabled but not yet verified for the session.

### Passkeys (WebAuthn)
Allows passwordless login using biometric sensors (TouchID, FaceID, Windows Hello).
*   **Registration**: Client generates a public/private key pair. Public key is sent to server.
*   **Authentication**: Server sends a "challenge", client signs it with private key.

## 4. User Service & RBAC integration
While Better-Auth handles *Identity* (Who are you?), our internal logic handles *Access* (What can you do?).
*   **Roles**: Admin, User, Viewer (stored in `User` table).
*   **Permissions**: Defined in `src/lib/permissions.ts`.
*   **Access Control**: `src/lib/access-control.ts` maps Roles -> Permissions.
