# User Management

Manage the people who sign in to DBackup, how they sign in and what their group lets them do.

## First User

The first user to sign up becomes the administrator:
1. Open DBackup login page
2. Click **Sign Up**
3. Create your account
4. This account has full permissions

::: warning First User Only
Self-registration is only available for the first user. Additional users must be created by an admin.
:::

## The Users Tab

Go to **Users & Groups** in the sidebar. The **Users** tab lists every user:

| Column | Shows |
| :--- | :--- |
| **User** | Name and email. Your own row is marked **You** |
| **Group** | The group of the user, or **No group** in amber |
| **Signs in with** | Password, passkeys and the SSO providers linked to the account |
| **2FA** | **App** or **Passkey** when DBackup asks for a second factor, **Via SSO** for a user who only signs in through SSO, **Off** otherwise |
| **Last sign-in** | When and with which browser, from the audit log and the sessions |
| **Sessions** | Browsers signed in as the user right now |
| **API keys** | Keys the user owns |

The numbers above the list count the users without a group, the users who sign in with a password alone, who signed in during the last 30 days and the open sessions. The quick filters **No second factor** and **No group** find the users that need a look. On a phone the users show as cards.

## Create a User

1. Click **New user**
2. Enter the name and the email
3. Enter a password, or click **Generate** for one of 16 characters, which then shows so you can hand it on
4. Pick the group from the list. Each row says what the group lets its members do, and the search finds a group by its name or by those words
5. Click **Create user**

The user can sign in right away and changes the password under **Profile → Security**.

::: info No group and SuperAdmin
**No group** creates a user who signs in but sees and does nothing until someone picks a group. Only a SuperAdmin can make someone a SuperAdmin.
:::

## The Details of a User

A click on a user opens a panel:

- **Access** says in words what the group lets the user see, do and change, and how many of the 39 permissions that is
- **Signs in with** lists the password with the date it was set, the authenticator app, the passkeys and the linked SSO providers
- **Sessions** lists the browsers signed in as the user, with the address and when each signed in
- **API keys** lists the keys the user owns, whether they work and when they were last used
- **Activity** shows the newest entries of the audit log written by the user

**Edit**, the menu beside it and the right click on a row offer the actions below.

## Admin Actions

All of them need the permission to manage users and are written to the audit log.

### Set a New Password

1. Click **Set a new one** in the panel, or **Set a new password** in the menu
2. Enter a password or click **Generate**
3. Leave **Sign them out everywhere** on, so the old password stops working at once
4. Click **Set password**

A user who signs in only through SSO gets a password as a second way in. Your own password changes under **Profile → Security**, which asks for the current one. Only a SuperAdmin sets the password of a SuperAdmin.

### Reset 2FA

**Reset 2FA** removes the authenticator app and the passkey as second factor after asking. The user signs in with the password alone until they set up a second factor again under **Profile → Security**.

### Sign Out

**Sign out** in the panel ends one session, **Sign out everywhere** ends all of them. On your own account it reads **Sign out other sessions** and keeps the browser you use. API keys keep working.

### Change the Group

Click **Edit** or **Change group** and pick another card. Permissions change with the next request of the user. Nobody changes their own group, and only a SuperAdmin moves a SuperAdmin into another group.

### Delete a User

Click **Delete** in the menu of the user and confirm. Their sessions end at once and their API keys are deleted with them, while the audit log keeps what they did under their name. Tick several rows to delete them together.

::: danger Cannot Undo
Deleting a user is permanent. Your own account, the last SuperAdmin and the last account cannot be deleted, and only a SuperAdmin deletes a SuperAdmin.
:::

## Authentication

### Password Login

Passwords are hashed by Better Auth with scrypt and need at least 8 characters, with no other rules. Users change their own under **Profile → Security**.

### Two-Factor Authentication (2FA)

Users can enable TOTP-based 2FA:
1. Go to **Profile** → **Security**
2. Click **Enable 2FA**
3. Scan QR code with authenticator app
4. Enter verification code
5. Save recovery codes

### Passkeys (WebAuthn)

Hardware security key or biometric:
1. Go to **Profile** → **Security**
2. Click **Add Passkey**
3. Follow browser prompts
4. Name the passkey

A passkey can also serve as the second factor after the password.

### SSO/OIDC

See [SSO/OIDC](/user-guide/admin/sso) for enterprise authentication.

::: tip Keep access tight
Give each person their own account, put them in the smallest group that covers their work and check the **No second factor** filter from time to time.
:::

## Troubleshooting

### Can't Login

**Check**:
1. Email is correct
2. Password is correct, or set a new one for the user
3. 2FA code is current (30-second window)

### 2FA Not Working

**Causes**:
- Clock sync issues
- Wrong authenticator app
- Recovery codes used

**Solutions**:
1. Check device time is synced
2. Use a recovery code
3. An admin resets 2FA from the details of the user

### A User Sees Nothing

The user has no group. Open the user and click **Change group**.

## Next Steps

- [Groups & Permissions](/user-guide/admin/permissions) - Configure access
- [SSO/OIDC](/user-guide/admin/sso) - Enterprise authentication
