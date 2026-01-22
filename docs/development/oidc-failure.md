# OIDC/SSO Integration - Problem Documentation

## Summary

Integration of an OIDC Provider with better-auth v1.4.17 encountered several cascading issues that required sequential debugging and fixes.

---

## Problem 1: `Cannot read properties of undefined (reading 'startsWith')`

### Symptom
```
TypeError: Cannot read properties of undefined (reading 'startsWith')
```
HTTP 500 error on SSO callback.

### Root Cause
In `@better-auth/sso` (line 1710), `betterFetch(config.discoveryEndpoint)` is **always** called - even when `skipDiscovery: true` is set. If `discoveryEndpoint` is `undefined`, the internal URL parser crashes.

### Solution
`discoveryEndpoint` must **ALWAYS** be set in the `oidcConfig`:

```typescript
// src/services/oidc-provider-service.ts
const discoveryEndpoint = data.issuer
    ? `${data.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
    : undefined;

const oidcConfig = {
    // ... other fields
    discoveryEndpoint,  // REQUIRED - even with skipDiscovery!
    skipDiscovery: true,
};
```

---

## Problem 2: `account not linked` Error

### Symptom
```
location: 'http://localhost:3000/api/auth/error/error?error=account not linked'
```
HTTP 302 redirect to error page after successful IdP authentication.

### Root Cause
Better-auth's account linking logic in `handleOAuthUserInfo` (line 21 in `link-account.mjs`):

```javascript
if (
    (!isTrustedProvider && !userInfo.emailVerified) ||
    c.context.options.account?.accountLinking?.enabled === false
) {
    return { error: "account not linked", data: null };
}
```

**Conditions for successful linking:**
1. `accountLinking.enabled !== false` (default: true) ✅
2. EITHER `isTrustedProvider === true` OR `userInfo.emailVerified === true`

**How is `isTrustedProvider` determined? (OIDC - line 1766):**
```javascript
const isTrustedProvider =
    "domainVerified" in provider &&
    provider.domainVerified === true &&
    validateEmailDomain(userInfo.email, provider.domain);
```

This means:
- Provider must have `domainVerified: true`
- **AND** the user's email domain must match `provider.domain`!

### Why It Failed

| Scenario | Email | Provider Domain | domainVerified | emailVerified (IdP) | Result |
|----------|-------|-----------------|----------------|---------------------|--------|
| Locally created user | user@example.com | idp.example.org | true | false | ❌ Domain mismatch |
| Locally created user | user@example.com | example.com | true | false | ❌ IdP sends emailVerified=false |
| No user exists | user@example.com | example.com | true | false | ✅ New user created |

### The Real Solution

**The problem wasn't the linking itself, but rather:**
1. A local user existed with `emailVerified: false`
2. The IdP sent `emailVerified: false`
3. The domain configuration didn't match the email

**Solution: No existing user → OAuth creates new user directly**

When NO user with the email exists, better-auth creates a new user without linking checks.

---

## Problem 3: Local Users + SSO Compatibility

### The Core Problem

When an admin creates a user in the dashboard:
- User has `emailVerified: false`
- No SSO account is linked

When this user tries to log in via SSO:
- Better-auth finds existing user
- Attempts account linking
- **Fails** because neither `isTrustedProvider` nor `emailVerified` is true

### Difference: OAuth-created vs. Dashboard-created User

| Property | OAuth-created User | Dashboard-created User |
|----------|-------------------|------------------------|
| emailVerified | `true` (if IdP confirms) | `false` |
| SSO Account | Automatically linked | Not present |
| Can log in via SSO | ✅ Yes | ❌ No (without fix) |

---

## Problem 4: Array Reference Bug in `trustedProviders`

### Symptom
Despite `trustedProviders: ['my-provider']` being logged correctly at startup, account linking still failed with "account not linked".

### Root Cause
JavaScript array reference behavior:

```javascript
let trustedProvidersCache = [];
// ... async load happens ...
trustedProvidersCache = providers.map(p => p.providerId); // NEW array!

// But betterAuth() was called with the OLD empty array reference
const auth = betterAuth({
    account: {
        accountLinking: {
            trustedProviders: getTrustedProviders(), // Returns old empty []
        }
    }
});
```

When you **reassign** an array variable (`arr = newArr`), you create a new array reference. But the original empty array reference was already captured in the config object.

### Solution
**MUTATE** the array instead of reassigning:

```typescript
// src/lib/auth.ts
const trustedProvidersCache: string[] = []; // Single instance, never reassigned

async function loadTrustedProviders(): Promise<void> {
    try {
        const providers = await prisma.ssoProvider.findMany({
            where: { enabled: true },
            select: { providerId: true }
        });
        // MUTATE the array, don't reassign!
        trustedProvidersCache.splice(0, trustedProvidersCache.length);
        trustedProvidersCache.push(...providers.map(p => p.providerId));
        console.log("[Auth] Loaded trusted SSO providers:", trustedProvidersCache);
    } catch (error) {
        console.warn("[Auth] Could not load trusted providers:", error);
        trustedProvidersCache.splice(0, trustedProvidersCache.length);
    }
}

// Initialize on module load
loadTrustedProviders();

function getTrustedProviders(): string[] {
    return trustedProvidersCache; // Same array reference always
}
```

> ⚠️ **IMPORTANT:** After adding a new SSO provider, the server must be restarted!
> The `trustedProviders` list is loaded from the database at server startup and cached.
> New providers are only recognized as "trusted" after a restart.

---

## Implemented Solutions

### 1. Auto-generate `discoveryEndpoint`
See `src/services/oidc-provider-service.ts`

### 2. `trustEmailVerified: true` in SSO Plugin
```typescript
sso({
    trustEmailVerified: true,
})
```

### 3. `accountLinking.allowDifferentEmails: true`
```typescript
account: {
    accountLinking: {
        enabled: true,
        allowDifferentEmails: true,
    }
}
```

### 4. Load `trustedProviders` dynamically from DB (with array mutation)
```typescript
// src/lib/auth.ts
const trustedProvidersCache: string[] = [];

async function loadTrustedProviders(): Promise<void> {
    const providers = await prisma.ssoProvider.findMany({
        where: { enabled: true },
        select: { providerId: true }
    });
    // Clear and repopulate the SAME array
    trustedProvidersCache.splice(0, trustedProvidersCache.length);
    trustedProvidersCache.push(...providers.map(p => p.providerId));
}

// Load on module init
loadTrustedProviders();

// In auth config
account: {
    accountLinking: {
        enabled: true,
        allowDifferentEmails: true,
        trustedProviders: getTrustedProviders(), // Same array reference
    }
}
```

---

## Future Improvements

### TODO: Set emailVerified=true when admin creates user
When an admin creates a user, `emailVerified: true` should be set so SSO linking works without needing `trustedProviders`.

---

## References

- Better-Auth SSO Plugin: `node_modules/@better-auth/sso/dist/index.mjs`
- Account Linking Logic: `node_modules/better-auth/dist/oauth2/link-account.mjs`
- `validateEmailDomain` Function: Line 946 in SSO Plugin
