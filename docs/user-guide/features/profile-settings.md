# Profile

The Profile page holds everything about you: your account, how you sign in, your sessions, and how DBackup looks and behaves for you.

## The Page

Click your avatar at the foot of the sidebar, then **Profile**. The page is built like [Settings](/user-guide/admin/settings): its parts on the left in three groups, each with its state, like **2FA off** in amber or how many sessions are open, and a search above them that finds a setting by the start of its words. A change waits in the bar at the foot of the part until **Save changes**, and leaving a part with changes asks first. A phone lists the parts and opens each on its own.

| Group | Part | What it holds |
| :--- | :--- | :--- |
| You | **Account** | Your picture, your name, your email and what your group lets you do |
| You | **Security** | Your password, the authenticator app, your passkeys and the sign-in providers linked to you |
| You | **Sessions** | Every browser you are signed in with |
| Look | **Appearance** | Light, dark or the theme of your system |
| Look | **Colors** | The color of every task, see [Colors](#colors) |
| Look | **Dates and times** | Your time zone and how dates and times read |
| Look | **Tables** | The rows per page and the row height every table starts with |
| Behavior | **Runs** | Whether the page of a run opens after **Run now** |

Your group decides what you may change of your own profile, like your name, your email or your passkeys. What it does not allow stays visible without its buttons, and the server refuses it too.

## Account

**Upload a picture** and **Remove** apply at once. The name shows in the audit log, in Recently deleted and as who started a run, and you sign in with the email. **Your access** says in a few sentences what your group lets you do.

## Security

- **Password**: **Change password** asks for the one you have now and the new one twice, at least 8 characters.
- **Authenticator app**: **Turn on** asks for your password, shows a code to scan or a key to enter by hand, checks the first code from the app and ends with backup codes. Each backup code signs you in once when the phone is gone. **New backup codes** replaces them, **Turn off** asks for your password.
- **A passkey counts as the second factor**: after the password DBackup asks for a passkey instead of a code. It needs a passkey, and the authenticator app off.
- **Passkeys**: **Add a passkey** names it, then your browser asks for it. Each passkey can be renamed and deleted. Deleting the last one turns off the passkey as second factor.
- **Sign-in providers**: the single sign-on accounts linked to you, each with **Unlink**, and the providers you can link with **Link**. The only way you sign in cannot be unlinked.

Without a password, when you sign in with a passkey or a provider only, no second factor applies.

## Sessions

Every browser signed in as you, with its browser, system, address, when it signed in and when it was last active, this browser on top. **Sign out** ends one, **Sign out the others** every one but this browser. A browser you do not know? Sign it out, then change your password.

## Appearance

**Light**, **Dark** or **System**, which follows the theme of your system. It applies at once and stays in this browser.

## Colors

Every task has a color across DBackup: blue adds, violet edits, turquoise picks, fuchsia filters, amber warns, red deletes and green says all is well. **Colors** changes them for you alone.

1. **Start from** a set: **Default**, **Colorblind friendly**, where Delete and Success are never red and green, or **Soft**.
2. Change a task with the button of its row, which shows its shade in the light and in the dark theme. The picker offers 16 colors or **Your own**, picked freely in the color field its swatch opens or typed as `#rrggbb`, and says how well each shade reads on white and in the dark theme. The dark shade of your own color is worked out for you.
3. **How it looks** shows a row menu, three dialogs, the buttons, the states of a run and a filter in your colors before you save.
4. **Save changes** puts them on every page. **Reset to default** goes back to the colors DBackup ships with.

::: info
Warning, Delete and Success also color the states of a run: partial, failed and completed. Running stays blue, whatever color Add has.
:::

## Dates and Times

**Time zone** is the clock every date and time follows for you. **This browser** follows the zone the browser is in, like on a trip. **Date** and **Time** show each format with the time of now. The schedules of the jobs follow the time zone under **Settings → General**, not this one.

## Tables

**Rows per page** and **Row height** set how every table starts, from 10 to 100 rows and comfortable or compact. A table with a **Columns** menu keeps what you pick there until its **Reset**.

## Runs

**Open the run** opens the page of a run with its live log after **Run now**. Off, a message says it started and the page stays.

## Related

- [Settings](/user-guide/admin/settings)
- [Groups & Permissions](/user-guide/admin/permissions)
- [SSO / OIDC](/user-guide/admin/sso)
