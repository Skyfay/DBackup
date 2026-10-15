> ⚠️ **Before updating:** This version moves everything an installation holds into its first tenant and cannot be taken back to an earlier version. The first start after the update keeps a copy of the database beside it.

### ✨ Features

- **tenants**: One instance serves several tenants, each with its own connections, jobs, backups, keys, templates, API keys and audit log. People work in a tenant through a group, and the head of the sidebar switches between the tenants someone may open.
- **tenants**: Platform admins see every tenant at once in All tenants, with the jobs, connections, backups, runs and accounts of all of them. A record opens in its tenant to be changed.
- **tenants**: Every tenant has its own groups, starting with Admin and Viewer, and its admins manage them.
- **tenants**: With more than one tenant the section Platform holds the tenants, every account and the settings of the instance. Administration holds the open tenant, with its own settings for its name, logo and notifications.
- **tenants**: Platform groups give the people of the MSP rights on the platform and rights in all tenants or selected ones, on top of their own groups. Platform admin is the built-in platform group with every right.
- **tenants**: A tenant admin adds people with an invitation link that works once, for an existing account or a new one.
- **SSO**: A sign-in provider can belong to a tenant. It is reached by the email domain instead of a button, and the people it adds join that tenant.
- **tenants**: Single databases of a shared server in the home tenant can be given to another tenant, by hand, by name patterns or through the API. That tenant sees, downloads and restores the backups of its own database only, under Backups > Shared with you.
- **tenants**: A shared database can move to another server and keeps its older backups for its tenant. When the connection of a shared server is deleted, its tenants keep downloading their backups.
- **tenants**: The tenant of a shared database can start a backup of it alone, as often a day as the home tenant allows.

### 🐛 Bug Fixes

- **backups**: The Destinations timeline of the Backups page follows the search and the filters of the list.

### 🎨 Improvements

- **api**: Pages, Server Actions and API routes read the database only through the services.
- **docker**: A start that applies database migrations first keeps a copy of the database beside it. The three newest copies stay.

### 🔄 Changed

- **auth**: The SuperAdmin group became the group Admin with every permission, and its members became platform admins. Only platform admins manage the sign-in providers, restore a configuration and download the database.
- **auth**: Restoring from Recently deleted and deleting for good need the new permission Tenant settings. Groups that could change the settings get it with the update.

### 📝 Documentation

- **docs**: New guides for tenants and shared databases, for admins and for developers. The guides of users, groups, permissions, API keys, SSO and the audit log describe platform admins and tenants.

### 🧪 Tests

- **lint**: Lint guards keep direct database queries out of the routes and Next.js out of the services.
- **tenants**: Tests against a real database prove that no tenant reads, changes or deletes the rows of another. Invitation links and shared databases have tests of their own.
