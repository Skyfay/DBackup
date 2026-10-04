# Email (SMTP)

Send HTML notifications via any SMTP server. Supports multiple recipients and per-user delivery for login/account events.

## Configuration

::: info Credential Profile required
Email (SMTP) requires a [Credential Profile](/user-guide/security/credential-profiles) of type `SMTP`. Create one in **Vault → Credentials** before saving the notification.
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

1. Create an `SMTP` credential profile in **Vault → Credentials** with your SMTP username and password ([guide](/user-guide/security/credential-profiles))
2. In DBackup: **Connections** → **Channels** → **New channel** → **Email (SMTP)**
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

- **One template for every mail**: a banner in the color of the status (green when all went well, red for a failure, amber for a partial run or an alert, gray for news), then a card with the key numbers, what went wrong in plain words with the message as the server wrote it, the destinations of a run and the details.
- **Buttons into DBackup**: Open run, Open job, Open destination and the like lead to the right page. They use the address in `BETTER_AUTH_URL`, and a mail without that address leaves them out.
- **Times** follow the time zone under **Settings → General**, like `4 Oct 2026, 02:00`.
- **Sender name**: a From that is only an address goes out as `DBackup · <Name>`, with the name under **Settings → General**. A From that has a name keeps it.
- **Why it came**: the last line names the job or the event that sent the mail and where to change it.
- **Dark mode**: Apple Mail, iOS Mail and other clients that follow the system show the mail dark. Gmail darkens it on its own.
- **Pictures** load from `docs.dbackup.app`. A client that blocks them still shows every word, and every mail carries a plain text part for clients without HTML.
- **Send test** sends a mail in the same template.
- **Multiple recipients**: Add multiple email addresses in the To field
- **Per-user delivery**: For login and account events, DBackup can email the affected user directly - configure in **Settings → Notifications** (see [System Notifications](/user-guide/features/notifications#notify-user-directly))

## Troubleshooting

### Connection Refused / Timeout

Verify host and port are correct. Check firewall allows outbound connections on the SMTP port. Common mistake: using port 25 instead of 587. In Docker, ensure the container can reach the mail server.

### Authentication Failed

Double-check credentials. For Gmail, use an App Password (requires 2-Step Verification enabled). Verify the security setting matches the server's expected protocol.

### Email Not Received

Check spam/junk folder, verify the To address, and check sender domain reputation. Configure SPF/DKIM/DMARC records for the sender domain to avoid spam filters.
