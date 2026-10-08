# Documentation and Changelog

VitePress wiki in `docs/`. Content language is English. Tone is clear, concise, and practical - written for self-hosters and sysadmins. No marketing fluff, no restating the obvious.

Local preview: `pnpm docs:dev`.

---

# Part 1 - Wiki pages

## Adapter guide template

Every adapter guide (sources, destinations, notifications) follows this section order. Omit a section only when it genuinely does not apply.

```markdown
# Adapter Name

One-sentence description of what this adapter does.

## Supported Versions        (databases only)

Version table.

## Prerequisites             (if needed)

CLI tools, external accounts, or setup required BEFORE configuring in DBackup.

## Configuration

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Field Name** | What it does | `default` | ✅ / ❌ |

## Setup Guide

Numbered steps to configure this adapter in DBackup.
External setup (e.g. "Create Discord webhook") goes in as sub-steps.

## How It Works            (optional, only if non-obvious)

Brief explanation of the backup/upload/notification process.

## Troubleshooting

### Problem Title

\`\`\`
Error message or symptom
\`\`\`

**Solution:** Concrete fix.

## Next Steps

2-3 links to related pages (encryption, retention, restore).
```

### Rules

1. **One config table.** Do not split into "Basic" and "Advanced". One table, all fields.
2. **Required column** on every config table (✅ / ❌).
3. **Field names match the UI exactly.** Use the label a user actually sees.
4. **Provider examples go in `<details>` blocks** - Gmail, MinIO, Synology, and similar external setups.
5. **No comparison tables in individual guides.** Comparisons belong on the category index page.
6. **No "Best Practices" laundry lists.** Fold tips into `::: tip` callouts where they are relevant, or drop them.
7. **Max 5 troubleshooting entries.** Cover errors users actually hit.
8. **100-200 lines per guide.** Past 250 lines, something needs cutting or splitting.

## Index pages

Each category (sources, destinations, notifications) has an index page with a table of all adapters and links, a brief "Choosing" section, shared setup steps if any, and links to the individual guides.

## VitePress features

```markdown
::: tip Title
::: warning Title
::: danger Title
::: info Title
```

`::: code-group` for multi-variant code blocks. `<details>/<summary>` for optional or collapsible content.

## Content principles

- **Verify every claim against the code.** Config fields, defaults, and feature claims must match `src/lib/adapters/definitions/` and the adapter implementation. Do not document a field that does not exist.
- **Do not document external products.** Link to official docs instead of explaining Gmail, AWS IAM, or Nginx.
- **One source of truth.** Link rather than repeat.
- **Screenshots are optional.** Only when the UI flow is genuinely confusing.

---

# Part 2 - Changelog (`changelog/unreleased/` and `docs/changelog.md`)

## Where entries go

Never into `docs/changelog.md`. Every branch writes its entries into a fragment of its own, `changelog/unreleased/<branch>.md` with the `/` of the branch name replaced by `-`, so pull requests that run side by side never touch the same file. A change made without a branch of its own names its fragment after the change.

A fragment is a version block without the version header and without the Docker section: notes like breaking changes above the first section, then sections with entries. The release (`pnpm version:bump`) collects all fragments into one version block of `docs/changelog.md`, sorts the sections into the order below, groups the entries of each section by component in the order of the alphabet and deletes the fragments. `tests/unit/lint-guards/changelog-fragments.test.ts` checks every fragment against the rules of this part, and `pnpm changelog:preview` prints the block the next release writes. Format and example: [changelog/unreleased/README.md](../changelog/unreleased/README.md).

## What never gets an entry

This file is published on the docs site for people who run DBackup. AI tooling is invisible to them and stays out:

- `CLAUDE.md` files anywhere in the tree
- `.claude/` in full - agents, skills, commands, settings, launch config
- `.gitignore` rules that only exist to track those files

Code that ships in the repository still counts even when its purpose is to keep the assistant honest. A lint guard under `tests/` changes the build for every contributor and belongs in `### 🧪 Tests`.

## Entry format

```
- **component**: Description of the change ([#N](url))
```

**component** - short, lowercase area or adapter name (`auth`, `MSSQL`, `dashboard`, `ui`, `backup`, `storage`, `SSO`, `Redis`). Always a single name, never a sentence, never two areas joined:

- ✅ `**storage**: ...`  ❌ `**storage alerts**: ...`
- ✅ `**Valkey**: ...`  ❌ `**new Valkey adapter**: ...` (the "what happened" belongs in the description)

**Description** - at most **two sentences**, and one wherever one will do. Say **what** the change is, not why it was made, how it works, or what it took to build. No file paths, function names, or internals. Anything that needs a third sentence belongs in the guide for that feature, not here.

**Punctuation** - no `;`, no ` - ` and no `- ` inside a description. Stricter than the general typography rule, which allows a hyphen as a dash. A sentence reaching for one of them is doing too much work, so split it or cut it. The `- ` that opens the line is the list marker and stays.

**Issue links** - always at the end as `([#N](url))`. Never inside the component name.

**Thanks** - a contribution from outside the project is credited at the end of each of its entries as `Thanks @author ([#N](url))`, which the release adds by itself: `scripts/changelog.mjs` looks up the pull request that added a fragment with git and `gh`. Contributors write no thanks, and a reviewer does not ask for one. A vulnerability reported privately thanks its reporter by hand, with the advisory link instead of the pull request.

**One entry per user-visible change.** A PR touching 20 files to deliver one behavior change is one line. Two unrelated changes in one PR are two lines.

## Does the change need an entry?

On `main` the answer is nearly always yes, because everything there is code somebody is already running. On any other branch it is a real question, and getting it wrong is how one feature turns into fifteen lines.

| The change is | Entry |
| :--- | :--- |
| A feature, fix, or behavior change to something already released | Yes |
| A step in building the unreleased feature the branch exists for | No, that feature's own entry covers it |
| A bug that only ever existed on this branch | No, nobody has run that code |
| Groundwork with no visible effect until the new feature ships | No |

Check it rather than assume it. `git log main..HEAD --oneline` settles most cases: if the code being fixed arrived in one of those commits, it never shipped. The trap is shared code touched for the new feature, which often changes for existing adapters as well, and that half does need a line.

## Section order

Never rearrange. Omit sections with no entries.

| # | Section | Use for |
| :--- | :--- | :--- |
| 1 | `### ✨ Features` | New features, adapters, capabilities |
| 2 | `### 🐛 Bug Fixes` | Bug fixes |
| 3 | `### 🔒 Security` | Security-related changes |
| 4 | `### 🎨 Improvements` | Performance, UX, quality |
| 5 | `### 🔄 Changed` | Changed behavior (non-breaking) |
| 6 | `### 🗑️ Removed` | Removed features, deprecated code |
| 7 | `### 📝 Documentation` | Documentation changes |
| 8 | `### 🧪 Tests` | Tests added or changed |
| 9 | `### 🔧 CI/CD` | Pipeline changes |
| 10 | `### 🐳 Docker` | Docker image info (always last) |

Do not invent new sections.

## Version header

```markdown
## vX.Y.Z - Short Title
*Released: Month Day, Year*
```

The release writes the header with `*Release: In Progress*`, which becomes the date once the version ships. A fragment has no header.

## Breaking changes

A blockquote directly below the release date, before any section. In a fragment it goes above the first section, and the release moves it below the date:

```markdown
> ⚠️ **Breaking:** What breaks and how to migrate.
```

## Docker section

Last section of every version with a published image. The release writes it, a fragment never has one:

```markdown
### 🐳 Docker

- **Image**: `skyfay/dbackup:vX.Y.Z`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64
```

Tag rules: stable releases get `latest` plus the major tag (`v1`), `-beta` releases get `beta`, `-dev` releases get `dev`.

## Additional rules

- Newest version at the top.
- No `---` separators between versions. VitePress renders them.
- Entries are grouped under `###` headings, never a flat list.

## Example

```markdown
## v1.2.0 - Cloud Storage & Notifications
*Released: April 15, 2026*

### ✨ Features

- **Google Drive**: Added OAuth 2.0 integration with folder browser
- **email**: Added multi-recipient support via tag input

### 🔒 Security

- **OAuth**: Refresh tokens are now encrypted at rest

### 🎨 Improvements

- **dashboard**: Reduced storage statistics page load time

### 🐛 Bug Fixes

- **auth**: Fixed blank page shown to SSO users after login redirect

### 📝 Documentation

- **wiki**: Added per-provider setup guides for cloud storage adapters

### 🐳 Docker

- **Image**: `skyfay/dbackup:v1.2.0`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64
```
