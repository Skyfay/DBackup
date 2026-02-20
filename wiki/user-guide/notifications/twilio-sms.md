# SMS (Twilio)

Send SMS text message notifications for critical backup events via the Twilio API.

- **Instant SMS delivery** to any mobile phone worldwide
- **Critical alerts** — Perfect for high-priority failure notifications
- **Concise formatting** — Status emoji, title, and key fields optimized for SMS
- **Reliable delivery** — Enterprise-grade Twilio infrastructure
- **No app required** — Works on any phone that receives SMS

## Configuration

| Field | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| Account SID | ✅ | — | Twilio Account SID (starts with `AC`) |
| Auth Token | ✅ | — | Twilio Auth Token |
| From | ✅ | — | Sender phone number in E.164 format (e.g., `+1234567890`) |
| To | ✅ | — | Recipient phone number in E.164 format |

## Setup Guide

### 1. Create a Twilio Account

1. Sign up at [twilio.com](https://www.twilio.com/try-twilio)
2. Verify your phone number
3. Note your **Account SID** and **Auth Token** from the Console Dashboard

### 2. Get a Phone Number

1. In the Twilio Console, go to **Phone Numbers** → **Manage** → **Buy a number**
2. Choose a number with SMS capability
3. This will be your **From** number

::: tip Trial Accounts
Twilio trial accounts can only send SMS to verified numbers. Add recipient numbers under **Verified Caller IDs** in the Twilio Console. Upgrade to a paid account for unrestricted sending.
:::

### 3. Configure in DBackup

1. Go to **Notifications** → **Add Notification**
2. Select **SMS (Twilio)**
3. Enter your **Account SID**, **Auth Token**, **From** number, and **To** number
4. Click **Test** to send a test SMS
5. Save

## Message Format

SMS messages are kept concise to fit within SMS segment limits:

```
Backup Failed
❌ Backup failed: connection timeout
Job: Daily MySQL
Duration: 0s
Error: Connection refused
```

::: info SMS Length
Messages are optimized to stay within a single SMS segment (160 characters for GSM-7, 70 for Unicode). If the message exceeds one segment, Twilio will automatically split it into multiple segments (up to 1600 characters). Only the first 4 fields are included to keep messages short.
:::

## Cost Considerations

Twilio charges per SMS segment sent. Typical pricing:
- **US:** ~$0.0079 per segment
- **EU:** ~$0.04–0.10 per segment
- **International:** Varies by country

::: tip Cost Optimization
- Use SMS only for **failure notifications** (set job notification condition to "On Failure")
- Use free channels (Discord, Slack, ntfy) for success notifications
- Consider using Twilio's [Messaging Service](https://www.twilio.com/docs/messaging/services) for better delivery rates
:::

## Troubleshooting

| Error | Solution |
| :--- | :--- |
| `401: Authentication Error` | Account SID or Auth Token is incorrect |
| `Invalid 'To' Phone Number` | Number must be in E.164 format (`+` followed by country code and number) |
| `Unverified number` | Trial accounts can only send to verified numbers — verify in Twilio Console |
| `Queue overflow` | Upgrade account or reduce notification frequency |
| No SMS received | Check Twilio Console → Messaging → Logs for delivery status |
