# Email (SMTP)

Send HTML notifications via any SMTP server. Supports multiple recipients and per-user delivery for login/account events.

## Configuration

::: info Credential Profile required
Email (SMTP) requires a [Credential Profile](/user-guide/security/credential-profiles) of type `SMTP`. Create one in **Settings → Vault → Credentials** before saving the notification.
:::

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **SMTP Host** | Mail server hostname | - | ✅ |
| **Port** | SMTP port | `587` | ❌ |
| **Security** | `none`, `ssl`, or `starttls` | `starttls` | ❌ |
| **SMTP login** | `SMTP` credential profile (SMTP username + password) | - | ❌ |
| **From** | Sender email address | - | ✅ |
| **To** | Recipient email address(es) | - | ✅ |

**Security modes:** `none` (port 25, unencrypted), `ssl` (port 465, implicit TLS), `starttls` (port 587, upgrade to TLS - recommended).

## Setup Guide

1. Create an `SMTP` credential profile in **Settings → Vault → Credentials** with your SMTP username and password ([guide](/user-guide/security/credential-profiles))
2. In DBackup: **Connections** → **Notifications** → **Add New** → **Email (SMTP)**
3. Enter your SMTP server details (host, port, security mode)
4. Pick the credential profile under **SMTP login**
5. In the **Message** part, set the From address and add the recipients under To (several are supported)
6. Click **Send test** → check the recipient's inbox (and spam folder) → **Create channel**

<details>
<summary>Common SMTP provider settings</summary>

**Gmail:** `smtp.gmail.com:587` (STARTTLS) - requires an [App Password](https://myaccount.google.com/apppasswords), not your regular password.

**SendGrid:** `smtp.sendgrid.net:587` (STARTTLS) - User: `apikey`, Password: your API key.

**Amazon SES:** `email-smtp.{region}.amazonaws.com:587` (STARTTLS) - SMTP credentials from SES console.

**Mailgun:** `smtp.mailgun.org:587` (STARTTLS) - User: `postmaster@your-domain.mailgun.org`.

</details>

## How It Works

- **HTML template** with colored header bar (green = success, red = failure, blue = info)
- **Multiple recipients**: Add multiple email addresses in the To field
- **Per-user delivery**: For login and account events, DBackup can email the affected user directly - configure in **Settings → Notifications** (see [System Notifications](/user-guide/features/notifications#notify-user-directly))

## Troubleshooting

### Connection Refused / Timeout

Verify host and port are correct. Check firewall allows outbound connections on the SMTP port. Common mistake: using port 25 instead of 587. In Docker, ensure the container can reach the mail server.

### Authentication Failed

Double-check credentials. For Gmail, use an App Password (requires 2-Step Verification enabled). Verify the security setting matches the server's expected protocol.

### Email Not Received

Check spam/junk folder, verify the To address, and check sender domain reputation. Configure SPF/DKIM/DMARC records for the sender domain to avoid spam filters.
