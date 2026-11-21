### 🐛 Bug Fixes

- **SSO**: Signing in through a provider whose issuer has a path, like Authentik or a Keycloak realm, no longer fails on a private address with `resolves to a non-publicly-routable address`.

### 🧪 Tests

- **e2e**: Browser tests cover signing in with a password, the code of an authenticator app or a backup code as the second factor, a passkey as the first or the second factor, and SSO through a Dex identity provider in the lab. The tests open DBackup at localhost, which a passkey needs, and forward that port to a remote lab host.
