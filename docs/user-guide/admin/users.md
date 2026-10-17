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

The user joins the open tenant with that group, can sign in right away and changes the password under **Profile → Security**. An email that has an account already cannot get a second one, invite that person instead. An email whose domain the sign-in provider of another tenant claims is refused, unless you are a platform admin or hold `platform-accounts:write`, see [People in a Tenant](/user-guide/admin/tenants#people-in-a-tenant). The same holds for Edit and for the own profile.

::: info No group and platform admins
**No group** creates a user who signs in but sees and does nothing until someone picks a group. Such an account belongs to no tenant and shows in the home tenant, so pick a group when you create one in another tenant. The list leaves out every group that may do more than you may. Only a platform admin makes someone a platform admin, on the page [Tenants](/user-guide/admin/tenants#members).
:::

## Invite Someone

**Invite** beside **New user** makes a link that lets one person join the open tenant with a group, with the account they have or a new one. The links nobody used yet show above the list, with **Revoke**. See [Invitations](/user-guide/admin/tenants#invitations).

## The Details of a User

A click on a user opens a panel:

- **Access** says in words what the group lets the user see, do and change, and how many of the 41 permissions that is
- **Signs in with** lists the password with the date it was set, the authenticator app, the passkeys and the linked SSO providers
- **Sessions** lists the browsers signed in as the user, with the address and when each signed in
- **API keys** lists the keys the user owns, whether they work and when they were last used
- **Activity** shows the newest entries of the audit log written by the user

**Edit**, the menu beside it and the right click on a row offer the actions below.

## Admin Actions

All of them need the permission to manage users, or to manage the accounts of the platform (`platform-accounts:write`), and are written to the audit log. An account belongs to every tenant it works in, so the admin of a tenant changes its password, second factor, sessions, name and email, and deletes it, only while it works in that tenant alone. An account that also works in another tenant is changed by a platform admin or by whoever holds `platform-accounts:write`. The account of a platform admin is changed by a platform admin only, and an account of a [platform group](/user-guide/admin/tenants#platform-groups) by a platform admin or by someone with `platform-accounts:write` who may give that platform group.

Your own account follows your profile: Edit changes your own name and email only as far as the **Own profile** permissions of your group allow, whatever else it gives, and your own second factor changes under **Profile → Security**, never with **Reset 2FA**.

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

Click **Edit** or **Change group** and pick another card. The group applies in the open tenant, and permissions change with the next request of the user. **No group** takes the user out of the tenant, the account stays, and its sessions that worked there pick another tenant. Nobody changes their own group, gives a group that may do more than they may, or takes one away from someone whose group may do more than they may. A group of the tenant goes only to its people, its members and in the home tenant the accounts of no tenant, and only a platform admin gives one to a platform admin. Anyone else joins with an [invitation](/user-guide/admin/tenants#invitations).

### Delete a User

Click **Delete** in the menu of the user and confirm. Their sessions end at once and they cannot sign in anymore, while the audit log keeps what they did under their name. Tick several rows to delete them together.

A deleted user waits in [Recently deleted](/user-guide/admin/recently-deleted) for 30 days and comes back from there with their password, second factor, passkeys and API keys. With the right to change the tenant settings, tick **Delete it permanently now** for an account that has to be gone at once. Your own account, the last platform admin and the last account cannot be deleted. Only a platform admin restores or deletes for good from Recently deleted the account of a platform admin, of a platform group or of someone who also worked in another tenant.

## Every Account of the Instance

With more than one tenant, **Users & Groups** under **Administration** is about the open tenant, and every account of the instance is under **Platform → Users & Groups**, for a platform admin and whoever holds `platform-accounts:read`. In [All tenants](/user-guide/admin/tenants#all-tenants) the **Users & Groups** of Administration asks for the tenant to open and links there. The list shows every account once. The column **Tenants** names each tenant the account works in with its group there, and **No tenant** marks an account that works in none.

- **New user** asks for the tenant and the group the account starts with. Outside the home tenant a group is required. Someone of a platform group picks only a tenant they may open.
- **Edit** changes the name and the email. The section **Tenants** of a user adds them to a tenant, changes their group in each tenant or removes them from one, under the rules of [Members](/user-guide/admin/tenants#members).
- The groups of every tenant show read only, each with its tenant. **Open in its tenant** switches there, where the admins of that tenant change and delete its groups.
- A group change that would leave a tenant without anyone who manages its members is refused, also inside a tenant, unless a platform admin makes it.

The API keys and the audit log belong to one tenant each and stay on the **Users & Groups** of that tenant.

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

The account works in another tenant as well, or holds a platform group, so only a platform admin or someone who manages the accounts of the platform changes it. See [People in a Tenant](/user-guide/admin/tenants#people-in-a-tenant).

## Next Steps

- [Groups & Permissions](/user-guide/admin/permissions) - Configure access
- [Tenants](/user-guide/admin/tenants) - Customers, platform admins and invitations
- [SSO/OIDC](/user-guide/admin/sso) - Enterprise authentication
