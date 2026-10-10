# Unreleased changelog entries

Every pull request writes its changelog entries into a file of its own in this folder instead of into `docs/changelog.md`. Pull requests that run side by side then never edit the same file. The release collects all files into the version block of `docs/changelog.md` and deletes them.

## The file

- One file per branch, named after the branch with `/` replaced by `-`, like `Skyfay-air-gapped.md`. A change made without a branch of its own is named after the change.
- The same Markdown as a version block of the changelog, without the version header and without the Docker section, which the release writes.
- Notes like `> ⚠️ **Breaking:**` or `> ⚠️ **Before updating:**` go above the first section. The sections use the headings of the changelog in any order, the release sorts them and groups the entries of each section by component, in the order of the alphabet.
- Every entry is one line. A branch that changes its mind edits its own file rather than adding a second one.
- An entry for a change that resolves an issue ends with the link to that issue, like `([#151](https://github.com/Skyfay/DBackup/issues/151))`. It links the issue, not the pull request, since the thanks of the release links that already.
- No thanks for your own pull request. The release looks up the pull request that added each file and, when someone outside the project opened it, adds `Thanks @author ([#N](link))` to every entry of the file. An entry that thanks someone already, like the reporter of an advisory, keeps its own words.

```markdown
> ⚠️ **Breaking:** What breaks and how to migrate.

### ✨ Features

- **storage**: What the change is, in at most two sentences.

### 🐛 Bug Fixes

- **MySQL**: What was wrong and what happens now. ([#151](https://github.com/Skyfay/DBackup/issues/151))
```

The rules for an entry, like at most two sentences and no `;`, and which changes need one at all, are in the changelog part of [docs/CLAUDE.md](../../docs/CLAUDE.md). A test checks every file in this folder.

## Commands

- `pnpm changelog:check` checks the files on their own.
- `pnpm changelog:preview` prints the block the next release writes, thanks included.
- `pnpm version:bump` writes that block into `docs/changelog.md` and deletes the files.

Preview and release need git and a logged-in GitHub CLI (`gh`) for the thanks. Without them they still run and name the files whose thanks has to be added by hand.
