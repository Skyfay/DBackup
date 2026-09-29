# SSO / OIDC

Sign in to DBackup through an OpenID Connect provider like Authentik, Authelia, Keycloak or Pocket ID.

## Supported Providers

| Provider | Asks for |
| :--- | :--- |
| **Authelia** | Its URL, every endpoint is read from it |
| **Authentik** | Its base URL and the slug of the DBackup application |
| **Keycloak** | Its URL and the realm of the client |
| **Pocket ID** | Its URL, every endpoint is read from it |
| **Any OpenID Connect provider** | The issuer and every endpoint by hand |

The four named providers read their endpoints from the OpenID configuration of the provider. Any other provider, like Zitadel, Kanidm or Microsoft Entra ID, works with the last one.

## The Sign-in Tab

Open **Users & Groups → Sign-in**. Seeing it needs `settings:read`, adding and changing providers needs `settings:write`.

The strip above the list shows how many providers are on, how many people are linked through them, who has no password or passkey and signs in only through a provider, the sign-ins of the last 30 days, and whether password sign-in is on. The line under the list says whether passkeys are on, which providers the login page shows, and where `OIDC_AUTO_REDIRECT` sends it.

Each provider shows where it signs in, who is linked through it, the last sign-in and what happens to someone new. A click opens it in a panel:

- **In the provider** lists what to set up there, each value with Copy: the redirect URI, the scopes and the client ID. The client secret is only marked as saved, DBackup never sends it to the browser.
- **New people** says whether the provider adds someone on their first sign-in, and to which group.
- **Linked people** lists everyone who signed in through it and when. **No other way in** marks someone without a password, a passkey or another provider that is on.
- **Endpoints** shows what the provider was saved with. **Check connection** reads them again and says when the provider now answers with others.

## Adding a Provider

1. Click **New provider** and pick the provider.
2. Fill in its fields. Once they are, leaving one reads the OpenID configuration of the provider and shows **Found**, or why it was not reached. Any other OpenID Connect provider takes its endpoints as typed.
3. The box on the right says what to set up in the provider. Create the client there with the callback URL it shows, and copy its client ID and secret into the fields.
4. Leave **Add new people on their first sign-in** on and pick their group, or switch it off, see [New People](#new-people).
5. Click **Create provider**. DBackup reads the endpoints once more and saves them.

The **Provider ID** is the end of the callback URL, like `https://backup.example.com/api/auth/sso/callback/pocket-id`. It can be changed while the provider is new and stays once it is saved.

::: tip The address in the callback URL
The callback URL starts with `BETTER_AUTH_URL`. Set it to the address people open DBackup at, or the provider sends them back to the wrong place.
:::

## Changing a Provider

- **Edit** changes every field but the type and the provider ID. The client secret shows as saved, **Replace** takes a new one. A change applies to the next sign-in.
- **Disable** stops every sign-in through the provider, one already on its way at the provider included. The links stay, so switching it on again lets everyone back in. When someone has no other way in, it asks first and names them.
- **Delete** removes the provider and every link to it. Its dialog lists everyone linked and marks who cannot sign in afterwards, until someone sets a password for them. **Disable instead** keeps the links.

## New People

With **Add new people on their first sign-in**, someone the provider knows gets an account in DBackup when they first sign in, in the group picked for the provider. The audit log says so, like "Signed up through Authentik into the group Operators". With **No group** they sign in but see nothing until someone picks a group for them.

A provider never sends new people into a group that may do more than the group of the person who sets it up, and only a SuperAdmin picks the SuperAdmin group. Whoever controls a provider can add people through it, so it gets no more than its admin has.

Without it only people who already have an account in DBackup sign in through the provider. Their account is linked by its email on their first sign-in, and someone new is turned away.

Deleting a group moves the new people of its providers where its members go, or leaves them without a group.

## Provider Notes

### Authelia

::: warning The client secret is stored hashed in Authelia
Since Authelia 4.38 the `client_secret` in `configuration.yml` has to be a **hash**, while DBackup needs the **plaintext** value. Generate a pair with:

```bash
authelia crypto hash generate pbkdf2 --variant sha512 --random --random.length 72
```

Put the `Digest` in the configuration of Authelia and the `Random Password` into DBackup. Pasting the hash into DBackup ends in `invalid_client` at sign-in.
:::

```yaml
identity_providers:
  oidc:
    clients:
      - client_id: dbackup
        client_name: DBackup
        client_secret: '$pbkdf2-sha512$...'  # the Digest, not the plaintext
        redirect_uris:
          - 'https://backup.example.com/api/auth/sso/callback/authelia'
        scopes: [openid, profile, email]
```

### Authentik

Create an OAuth2/OpenID provider and an application for DBackup. The **Application slug** is the slug of the application, the endpoints come from `{base URL}/application/o/{slug}/.well-known/openid-configuration`.

### Keycloak

Create an OpenID Connect client with **Client authentication** on, and copy its secret from the **Credentials** tab. For Keycloak before version 18, include `/auth` in the URL, like `https://auth.example.com/auth`.

### Any OpenID Connect provider

It asks for the issuer, the authorization, token and user info endpoints, and the JWKS endpoint if the provider has one. The discovery document of the provider, at `{issuer}/.well-known/openid-configuration`, lists all of them.

## Login Page

Every provider that is on shows as a button on the login page. With an **Email domain**, someone who types an email of that domain goes straight to the provider. A provider takes one domain.

Two environment variables change the login page. Both are set on the container rather than in the UI, because either one can lock you out and the lever has to work without signing in.

### Switching off password login

`DISABLE_EMAIL_LOGIN=true` removes the email and password form. Only SSO and passkeys remain, and the endpoints are rejected server-side rather than just hidden. Administrators keep creating users and resetting passwords under **Users**, since an account often has to exist before it can link to an SSO identity. Passkey login has its own switch under **Settings → General**.

::: warning Order matters on a new instance
Create the first administrator and configure your provider **before** setting this. There is no bootstrap exception, on an empty instance it leaves no way to sign in and no way to create an account.
:::

### Skipping the login page entirely

`OIDC_AUTO_REDIRECT` takes a **provider ID** and sends visitors straight to that provider:

```bash
OIDC_AUTO_REDIRECT=authentik
```

The redirect is skipped after a failed sign-in, so the error is readable instead of looping, and on the page load right after signing out, so signing out works. An ID matching no enabled provider logs an error at startup and leaves the redirect off rather than stopping the application.

::: warning No way past it from the browser
While this is set, nothing in the URL reaches the login form. If the provider is unreachable or misconfigured, remove the variable and restart.
:::

## Troubleshooting

### Redirect URI mismatch

The provider refuses the sign-in before it asks for a password. Copy the redirect URI from the panel of the provider into the client at the provider, it has to match exactly.

### invalid_client at sign-in

The client secret is wrong. For Authelia, DBackup needs the plaintext secret, not its hash. Paste the right one with **Edit → Replace**.

### Account not found

The provider does not add new people, and nobody in DBackup has the email the provider sent. Create the user under **Users** first, or switch on **Add new people on their first sign-in**.

### Reached over HTTPS, endpoints over HTTP

```
The provider is reached over HTTPS but names its Authorization and Token endpoint over plain HTTP
```

The reverse proxy in front of the provider does not send `X-Forwarded-Proto`, so the provider believes it runs on plain HTTP. Fix the proxy of the provider, not DBackup.

### The provider could not be reached

DBackup reads the configuration of the provider from the server, not from the browser. Check that the container resolves the host of the provider and trusts its certificate.

## Next Steps

- [User Management](/user-guide/admin/users) - the people and how they sign in
- [Groups & Permissions](/user-guide/admin/permissions) - what the group of new people may do
- [Audit Log](/user-guide/admin/audit-log) - every sign-in, with the provider it came through

Provider logos from [selfh.st/icons](https://selfh.st/icons/) (CC BY 4.0) and [Simple Icons](https://simpleicons.org/) (CC0).
