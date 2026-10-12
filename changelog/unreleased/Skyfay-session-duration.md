### 🐛 Bug Fixes

- **auth**: A session ends after the length set under Settings > Sign-in, counted from the sign-in. Every session was extended by seven days on each visit, so the setting never took effect and nobody who came back once a week was ever signed out.
