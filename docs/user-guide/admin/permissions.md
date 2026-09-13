# Groups & Permissions

Configure role-based access control (RBAC) for users.

## Overview

DBackup uses a group-based permission system:
- **Groups** contain sets of permissions
- **Users** are assigned to groups
- Users inherit all permissions from their group

## Permission Model

```
User → Group → Permissions
                  │
                  ├── sources:read
                  ├── sources:write
                  ├── jobs:execute
                  └── ...
```

### No Group = No Access

Users without a group have **no permissions** by default:
- Cannot view any resources
- Cannot perform any actions
- Only access their profile

## Managing Groups

### View Groups

1. Go to **Users** → **Groups** tab
2. See all defined groups
3. View permission counts

### Create Group

1. Click **Create Group**
2. Enter group name
3. Select permissions
4. Save

### Edit Group

1. Click on a group
2. Modify permissions
3. Save

Changes apply immediately to all members.

### Delete Group

1. Click group's menu (⋮)
2. Select **Delete**
3. Confirm

::: warning Members Lose Access
Users in deleted group lose all permissions until reassigned.
:::

## Permission Reference

### Users & Groups

| Permission | Description |
| :--- | :--- |
| `users:read` | View user list and details |
| `users:write` | Create, edit, delete users |
| `groups:read` | View groups and permissions |
| `groups:write` | Create, edit, delete groups |

### Database Sources

| Permission | Description |
| :--- | :--- |
| `sources:view` | View configured sources |
| `sources:read` | Browse Database Explorer (tables and data) |
| `sources:write` | Add, edit, delete sources |

### Storage Destinations

| Permission | Description |
| :--- | :--- |
| `destinations:read` | View configured destinations |
| `destinations:write` | Add, edit, delete destinations |

### Backup Jobs

| Permission | Description |
| :--- | :--- |
| `jobs:read` | View backup jobs |
| `jobs:write` | Create, edit, delete jobs |
| `jobs:execute` | Manually run jobs |

### Storage & History

| Permission | Description |
| :--- | :--- |
| `storage:read` | Access Storage Explorer |
| `storage:download` | Download backup files |
| `storage:restore` | Restore from backups |
| `storage:delete` | Delete backup files |
| `history:read` | View execution history |

### Dashboard

| Permission | Description |
| :--- | :--- |
| `dashboard:read` | Read the overview statistics through the API (`GET /api/dashboard/stats`) |

The dashboard overview page itself needs no permission. `dashboard:read` exists so an API key for a homepage widget can read the totals without access to jobs, history, or storage.

### Notifications

| Permission | Description |
| :--- | :--- |
| `notifications:read` | View notification configs |
| `notifications:write` | Manage notification configs |

### User Profile

| Permission | Description |
| :--- | :--- |
| `profile:update_name` | Change own display name |
| `profile:update_email` | Change own email |
| `profile:update_password` | Change own password |
| `profile:manage_2fa` | Enable/disable 2FA |
| `profile:manage_passkeys` | Add/remove passkeys |

### Credentials

| Permission | Description |
| :--- | :--- |
| `credentials:read` | View credential profiles |
| `credentials:write` | Create and edit credential profiles |
| `credentials:delete` | Delete credential profiles |
| `credentials:reveal` | View decrypted credential secrets |

### API Keys

| Permission | Description |
| :--- | :--- |
| `api-keys:read` | View API keys |
| `api-keys:write` | Create, delete, and rotate API keys |

### Templates

| Permission | Description |
| :--- | :--- |
| `templates:read` | View naming and retention templates |
| `templates:write` | Create, edit, and delete templates |

### System

| Permission | Description |
| :--- | :--- |
| `vault:read` | View encryption profiles |
| `vault:write` | Manage encryption profiles |
| `settings:read` | View system settings |
| `settings:write` | Modify system settings |
| `audit:read` | View audit logs |

## Recommended Groups

### Administrator

Full access to everything:
- All permissions enabled
- Typically for IT/DevOps leads

### Operator

Can run and monitor backups:
```
sources:view
destinations:read
jobs:read
jobs:execute
storage:read
storage:download
storage:restore
history:read
notifications:read
profile:*
```

### Viewer

Read-only access:
```
sources:view
destinations:read
jobs:read
storage:read
history:read
```

### Developer

Access to test/staging resources:
```
sources:view
sources:read
jobs:read
jobs:execute
storage:read
storage:download
history:read
profile:*
```

## Permission Inheritance

Permissions are **additive**:
- User gets all permissions in their group
- No permission = denied
- No negative permissions (deny rules)

### Example

```
"Backup Operator" group has:
├── jobs:read      ✓ Can view jobs
├── jobs:execute   ✓ Can run jobs
└── (no jobs:write)
                   ✗ Cannot edit jobs
```

## Best Practices

### Least Privilege

Give minimum permissions needed:
1. Start with viewer role
2. Add only what's required
3. Review regularly

### Group Naming

Clear, descriptive names:
- ✅ "Backup Operators"
- ✅ "Database Admins"
- ❌ "Group 1"
- ❌ "Users"

### Separation of Duties

Split critical functions:
- Backup execution: Operators
- Job configuration: Admins
- Key management: Security team

### Regular Audits

Periodically review:
1. Who has access to what
2. Unused permissions
3. Group memberships
4. Access to sensitive operations

## UI Behavior

### Missing Permissions

When user lacks permission:
- UI elements are hidden
- Direct URLs return 403
- Actions are blocked

### Permission Check Flow

```
User Action → Check Permission → Allow/Deny
                   │
              getUserPermissions()
                   │
              Group.permissions[]
```

## Troubleshooting

### User Can't Access Feature

**Check**:
1. User is in a group
2. Group has required permission
3. Permission name is correct
4. User logged in recently (session might be stale)

### Permission Changes Not Applied

**Try**:
1. User logs out and back in
2. Clear browser cache
3. Verify group changes saved

### Need Different Access Levels

**Consider**:
1. Create new group with specific permissions
2. Don't modify existing groups that work
3. Use meaningful group names

## API Reference

### Permission Format

```
{resource}:{action}

Examples:
- sources:read
- jobs:write
- storage:delete
```

### Group Structure

```json
{
  "id": "uuid",
  "name": "Backup Operators",
  "permissions": [
    "sources:read",
    "destinations:read",
    "jobs:read",
    "jobs:execute",
    "storage:read",
    "history:read"
  ]
}
```

## Next Steps

- [User Management](/user-guide/admin/users) - Manage user accounts
- [SSO/OIDC](/user-guide/admin/sso) - Enterprise authentication
