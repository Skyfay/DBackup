# Profile & Settings

The Profile page allows you to manage your personal account settings, appearance preferences, and security options.

## Accessing Your Profile

Click on your avatar in the sidebar, then select **Profile** from the menu.

## Tabs Overview

### Profile Tab

Configure your personal information:

- **Avatar**: Upload or remove your profile picture
- **Name**: Your display name shown throughout the application
- **Email**: The email address used for sign-in
- **Timezone**: Your local timezone for displaying dates and times
- **Date Format**: Choose between localized, medium, long, ISO, or European date formats
- **Time Format**: Choose between 12-hour or 24-hour time display

::: tip
Changes to name, email, timezone, and date/time formats require clicking the "Save Changes" button.
:::

### Appearance Tab

Customize the look and feel of the application:

- **Theme**: Choose between Light, Dark, or System (follows your OS preference)

Theme changes are applied immediately.

### Preferences Tab

Configure application behavior:

#### Auto-Redirect on Job Start

When enabled (default), starting a backup or restore job will automatically:
1. Navigate you to the History page
2. Open the live execution view for the running job

If you prefer to stay on the current page when starting jobs, you can disable this option.

#### Tables

**Rows per page** and **Row height** set how every table starts, from 10 to 100 rows and comfortable or compact.

A table with a **Columns** menu, like on the Connections, Jobs and Backups pages, keeps the rows per page and the row height you pick there instead. **Reset** in its **Columns** menu brings it back to the ones of your profile.

::: info
Preference toggles are saved immediately when changed-no save button required.
:::

### Security Tab

Manage your account security:

- **Change Password**: Update your account password (if using local authentication)
- **Two-Factor Authentication (2FA)**: Enable TOTP-based 2FA using an authenticator app. During setup, the QR code dialog includes a **"Can't scan? Copy the secret key"** button - click it to copy the raw TOTP secret and enter it manually in your authenticator app if the camera scanner is not available.
- **Passkeys/WebAuthn**: Register hardware security keys or platform authenticators

### Sessions Tab

View and manage all your active login sessions:

- **Session List**: Each active session shows the browser name with a brand icon (Chrome, Firefox, Safari, Edge, Brave, Opera, Vivaldi, Arc, Tor), the operating system with an OS icon, and the device type
- **IP Address**: The IP address of each session is displayed. On localhost, the IPv6 loopback address is shown as "localhost"
- **Timestamps**: "Created" shows when the session was started, "Last seen" shows the most recent activity
- **Current Session Badge**: Your current session is marked with a "Current" badge and cannot be revoked
- **Revoke Session**: Click the trash icon on any other session to revoke it - this forces an immediate sign-out on that device
- **Revoke All Others**: Use the "Revoke All Others" button to sign out all devices except your current one. A confirmation dialog prevents accidental logouts

::: tip
If you suspect unauthorized access to your account, use "Revoke All Others" to immediately sign out all other devices, then change your password in the Security tab.
:::

## Related

- [Getting Started](/user-guide/getting-started)
- [Encryption Vault](/user-guide/security/encryption)
