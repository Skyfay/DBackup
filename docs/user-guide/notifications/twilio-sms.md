# SMS (Twilio)

Send SMS notifications for critical backup events via the Twilio API. Works on any mobile phone - no app required.

## Configuration

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Account SID** | Twilio Account SID (starts with `AC`) | - | ✅ |
| **Auth token** | `TOKEN` [credential profile](/user-guide/security/credential-profiles) holding the Twilio Auth Token | - | ✅ |
| **From** | Sender phone number in E.164 format (e.g., `+1234567890`) | - | ✅ |
| **To** | Recipient phone number in E.164 format | - | ✅ |

## Setup Guide

1. Sign up at [twilio.com](https://www.twilio.com/try-twilio) → copy **Account SID** and **Auth Token** from the Console Dashboard
2. Under **Phone Numbers** → **Buy a number** with SMS capability (this is your **From** number)
3. In DBackup: **Connections** → **Notifications** → **Add New** → **SMS (Twilio)**
4. Enter the Account SID and pick or create the credential profile under **Auth token**, then From and To in the **Message** part → **Send test** → **Create channel**

::: tip Trial Accounts
Trial accounts can only send to verified numbers. Add recipients under **Verified Caller IDs** in the Twilio Console. Upgrade for unrestricted sending.
:::

## How It Works

- Messages are optimized for SMS length - only the first 4 fields are included
- Twilio charges per SMS segment (~$0.0079/segment US). Use SMS for **failure-only** notifications and free channels (Discord, ntfy) for success notifications

## Troubleshooting

| Error | Solution |
| :--- | :--- |
| `401: Authentication Error` | Account SID or Auth Token is incorrect |
| `Invalid 'To' Phone Number` | Must be E.164 format: `+` followed by country code and number |
| `Unverified number` | Trial accounts require verified numbers - add in Twilio Console |
| No SMS received | Check Twilio Console → Messaging → Logs for delivery status |
