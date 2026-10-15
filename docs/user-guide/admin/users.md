# User Management

Manage the people who sign in to DBackup, how they sign in and what their group lets them do.

## First User

The first account becomes the administrator:
1. Open the login page of the new DBackup
2. Pick **Start fresh**
3. Create your account
4. This account is a platform admin, in the group with every permission, **Admin**

::: warning First User Only
Self-registration is only available for the first user. Once it exists, DBackup refuses every other sign-up, also one sent to its API directly. Additional users are created by an admin, join through an [invitation](/user-guide/admin/tenants#invitations), or are added by a sign-in provider.
:::

## The Users Tab

Go to **Users & Groups** in the sidebar. The **Users** tab lists the people of the open [tenant](/user-guide/admin/tenants), every user while there is only one tenant:

| Column | Shows |
| :--- | :--- |
| **User** | Name and email. Your own row is marked **You**, a platform admin **Platform admin** |
| **Group** | The group of the user in the open tenant, or **No group** in amber |
| **Signs in with** | Password, passkeys and the SSO providers linked to the account |
| **2FA** | **App** or **Passkey** when DBackup asks for a second factor, **Via SSO** for a user who only signs in through SSO, **Off** otherwise |
| **Last sign-in** | When and with which browser, from the audit log and the sessions |
| **Sessions** | Browsers signed in as the user right now |
| **API keys** | Keys the user owns |

The numbers above the list count the users without a group, the users who sign in with a password alone, who signed in during the last 30 days and the open sessions. The quick filters **No second factor** and **No group** find the users that need a look. On a phone the users show as cards.

## Create a User

1. Click **New user**
2. Enter the name and the email
3. Enter a password, or click **Generate** for one that follows the rules under **Settings → Passwords**, which then shows so you can hand it on. The rules tick off under the field as they hold
4. Pick the group from the list. Each row says what the group lets its members do, and the search finds a group by its name or by those words
5. Click **Create user**

The user joins the open tenant with that group, can sign in right away and changes the password under **Profile → Security**. An email that has an account already cannot get a second one, invite that person instead.

::: info No group and platform admins
**No group** creates a user who signs in but sees and does nothing until someone picks a group. Such an account belongs to no tenant and shows in the home tenant, so pick a group when you create one in another tenant. The list leaves out every group that may do more than you may. Only a platform admin makes someone a platform admin, on the page [Tenants](/user-guide/admin/tenants#members).
:::

## Invite Someone

**Invite** beside **New user** makes a link that lets one person join the open tenant with a group, with the account they have or a new one. The links nobody used yet show above the list, with **Revoke**. See [Invitations](/user-guide/admin/tenants#invitations).

## The Details of a User

A click on a user opens a panel:

- **Access** says in words what the group lets the user see, do and change, and how many of the 39 permissions that is
- **Signs in with** lists the password with the date it was set, the authenticator app, the passkeys and the linked SSO providers
- **Sessions** lists the browsers signed in as the user, with the address and when each signed in
- **API keys** lists the keys the user owns, whether they work and when they were last used
- **Activity** shows the newest entries of the audit log written by the user

**Edit**, the menu beside it and the right click on a row offer the actions below.

## Admin Actions

All of them need the permission to manage users and are written to the audit log. An account belongs to every tenant it works in, so its password, second factor, sessions, name and email change, and the account is deleted, only by a platform admin when it also works in another tenant. The account of a platform admin is changed by a platform admin only.

### Set a New Password

1. Click **Set a new one** in the panel, or **Set a new password** in the menu
2. Enter a password or click **Generate**, under the rules of **Settings → Passwords**
3. Leave **Sign them out everywhere** on, so the old password stops working at once
4. Click **Set password**

A user who signs in only through SSO gets a password as a second way in. Your own password changes under **Profile → Security**, which asks for the current one.

### Reset 2FA

**Reset 2FA** removes the authenticator app and the passkey as second factor after asking. The user signs in with the password alone until they set up a second factor again under **Profile → Security**.

### Sign Out

**Sign out** in the panel ends one session, **Sign out everywhere** ends all of them. On your own account it reads **Sign out other sessions** and keeps the browser you use. API keys keep working.

### Change the Group

Click **Edit** or **Change group** and pick another card. The group applies in the open tenant, and permissions change with the next request of the user. **No group** takes the user out of the tenant, the account stays. Nobody changes their own group, gives a group that may do more than they may, or takes one away from someone whose group may do more than they may.

### Delete a User

Click **Delete** in the menu of the user and confirm. Their sessions end at once and they cannot sign in anymore, while the audit log keeps what they did under their name. Tick several rows to delete them together.

A deleted user waits in [Recently deleted](/user-guide/admin/recently-deleted) for 30 days and comes back from there with their password, second factor, passkeys and API keys. With the right to change the settings, tick **Delete it permanently now** for an account that has to be gone at once. Your own account, the last platform admin and the last account cannot be deleted. Only a platform admin deletes or restores the account of a platform admin or one that also works in another tenant.

## Every Account of the Instance

With more than one tenant, **Users & Groups** under **Administration** is about the open tenant, and a platform admin finds every account of the instance under **Platform → Users & Groups**. The same list opens in [All tenants](/user-guide/admin/tenants#all-tenants). It shows every account once. The column **Tenants** names each tenant the account works in with its group there, and **No tenant** marks an account that works in none.

- **New user** asks for the tenant and the group the account starts with. Outside the home tenant a group is required.
- **Edit** changes the name and the email. The section **Tenants** of a user adds them to a tenant, changes their group in each tenant or removes them from one.
- Deleting a group moves its members to the group you pick in every tenant. **No group** is not offered there, since it would take people out of tenants they work in.
- A group change that would leave a tenant without anyone who manages its members is refused, also inside a tenant, unless a platform admin makes it.

The API keys and the audit log list the keys and entries of every tenant with their tenant. A new API key belongs to one tenant, so **New API key** asks which.

## Authentication

### Password Login

Passwords are hashed by Better Auth with scrypt. What a new one needs is set under [Settings → Passwords](/user-guide/admin/settings#passwords), Standard on a new instance with 12 characters, an upper and a lower case letter and a number. Users change their own under **Profile → Security**.

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

The user has no group in the open tenant. Open the user and click **Change group**.

### "This account also works in other tenants"

The account works in another tenant as well, so only a platform admin changes it. See [People in a Tenant](/user-guide/admin/tenants#people-in-a-tenant).

## Next Steps

- [Groups & Permissions](/user-guide/admin/permissions) - Configure access
- [Tenants](/user-guide/admin/tenants) - Customers, platform admins and invitations
- [SSO/OIDC](/user-guide/admin/sso) - Enterprise authentication
