# Security Policy

DBackup keeps the logins of databases and storage and the keys that encrypt backups. They are stored encrypted in its database, with AES-256-GCM under the `ENCRYPTION_KEY` of the instance. A security report gets priority over everything else.

## Supported Versions

| Version | Security fixes |
| :--- | :--- |
| The latest release | ✅ |
| Older releases | ❌ Update to the latest release |

Fixes ship as a new release. There are no backports to older versions.

## Reporting a Vulnerability

Please **do not** open a public issue, discussion or pull request for a vulnerability.

Report it privately, in one of two ways:

- **GitHub**: [Report a vulnerability](https://github.com/Skyfay/DBackup/security/advisories/new) on the Security tab of the repository. This is the preferred way, since the fix can be prepared in a private advisory.
- **Email**: [security@dbackup.app](mailto:security@dbackup.app)

A good report contains:

- the version of DBackup and how it runs (Docker image, or from source)
- what an attacker can do and what they need for it, like an account, a role or network access
- the steps to reproduce it, ideally with a proof of concept
- the affected files, endpoints or settings, if you know them

Only test against an instance you own. Do not access, change or delete data that is not yours.

## What Happens Next

1. You get a first answer within a few days.
2. The report is confirmed or explained, and its severity agreed with you.
3. The fix is prepared privately and ships in a new release.
4. The advisory is published once the release is out, and you are credited in it and in the changelog if you want to be.

Please keep the details private until the advisory is published.

## Scope

In scope:

- the code in this repository
- the official Docker images `skyfay/dbackup` on Docker Hub and `ghcr.io/skyfay/dbackup`

Out of scope:

- a vulnerability in a dependency that cannot be reached through DBackup. Report it upstream, and tell us if DBackup is affected after all
- attacks that need an already compromised host or an account with every permission
- the setup of your own instance, like running it without HTTPS or exposing it to the internet without a reverse proxy

How DBackup protects its data is described in the [Security Architecture](https://docs.dbackup.app/developer-guide/architecture#security-architecture) of the developer guide.
