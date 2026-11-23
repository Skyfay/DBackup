### 🐛 Bug Fixes

- **SSO**: A sign-in through a provider that fails, and the connect of a provider in the profile, lead back to the address the browser used. They no longer lead to the address the server listens on inside its container, like `0.0.0.0:3000`.
- **SSO**: A sign-in or a **Link** under **Profile** that the provider cannot link, since it does not mark the email as verified, says so with **Email not confirmed**. It ended on the login page or the dashboard without a word before.

### 🔒 Security

- **deps**: Better Auth moves to 1.7 and minimatch to 11, and MSAL, `systeminformation`, `gaxios` and `deepmerge-ts`, which other packages pull in, to patched releases, so `pnpm audit` finds nothing. None of the advisories they close reached DBackup, which uses neither the Better Auth plugins nor the options they concern.

### 📝 Documentation

- **SSO**: The guide names the two settings of Pocket ID a sign-in needs, the allowed user groups of the client and verified emails.
