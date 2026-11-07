### 🐛 Bug Fixes

- **Telegram**: A message sent with the parse mode Markdown is written in Markdown, so a name with `_` or `*` no longer makes Telegram refuse it.
- **MSSQL**: A restore under the original name moves the files of a backup whose server name cannot be read, and checks every file it places against the files of other databases.

### 🔒 Security

- **auth**: A provider no longer signs someone into an account whose email its owner set themselves, until they link the provider from their own profile.
- **auth**: Five wrong current passwords in 15 minutes lock the password change of an account for 15 minutes.
- **auth**: An API route signed in by the session cookie refuses a change that comes from another site.
- **auth**: The address of a sign-in provider is trusted only for its own sign-in, never as the target of a redirect.
- **credentials**: Revealing a saved login and downloading the recovery kit fail when their audit entry cannot be written.
- **database**: The downloaded database holds no sessions or verification codes, and the temporary copies that hold keys are readable by DBackup alone.
- **encryption**: A backup is opened only with an authentication tag of full length.
- **logs**: The server log hides passwords, tokens and the logins in connection strings.
- **MongoDB**: The password no longer shows in the process list while mongosh runs, and a restore under a new name escapes the name in the patterns of mongorestore.
- **MySQL**: A restore under a new name writes a name with a backtick safely, and the Database Explorer quotes its values safely whatever the SQL mode of the server.
- **notifications**: Slack, Discord, Telegram, Gotify and ntfy show names of jobs and connections as plain text, never as links or mentions.
- **PostgreSQL**: The Database Explorer and the restore quote their values safely whatever the string setting of the server.
- **restore**: A backup whose index lets files of a bundle overlap or reach past it is refused as damaged.
- **ui**: The pages allow no plugins, no forms to other sites and no framing, and avatars and the login image are served as images only.
- **users**: Two platform admins who delete each other at the same time no longer leave the instance without one.

### 🎨 Improvements

- **auth**: Checking an API key no longer blocks the server while it hashes the key.
