### 🐛 Bug Fixes

- **SSO**: A sign-in through a provider that fails, and the connect of a provider in the profile, lead back to the address the browser used. They no longer lead to the address the server listens on inside its container, like `0.0.0.0:3000`.

### 🔒 Security

- **deps**: Better Auth moves to 1.7 and minimatch to 11, and MSAL, `systeminformation`, `gaxios` and `deepmerge-ts`, which other packages pull in, to patched releases, so `pnpm audit` finds nothing. None of the advisories they close reached DBackup, which uses neither the Better Auth plugins nor the options they concern.
