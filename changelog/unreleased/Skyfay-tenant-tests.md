### 🧪 Tests

- **tenants**: A test calls every API route as the admin of one tenant, with a session, with an API key and as someone of a platform group that reaches that tenant only, with the ids of another tenant in the path, the query and the body. Nothing of the other tenant may be in an answer, change, or end up linked from the first, and no request or process may use its servers or logins.
- **tenants**: Tests pin two rules mutation testing found unguarded: a platform group gives its rights only in the tenants of its scope, also to someone who is a member of another tenant, and an upsert never finds the row of another tenant by its id, which the import of a configuration backup relies on.
