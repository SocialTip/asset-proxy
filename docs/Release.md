# Release process

This project uses a three-step manual release process for the publishable npm packages (`@asset-proxy/url-parser` and `@asset-proxy/url-generator`).

## Overview

```
Prepare Release  →  Merge PR  →  Publish  →  release.yml (automatic)
(workflow)          (manual)     (workflow)    publishes to npm
```

| Workflow            | Trigger                      | What it does                                                                             |
| ------------------- | ---------------------------- | ---------------------------------------------------------------------------------------- |
| **Prepare Release** | Manual (`workflow_dispatch`) | Detects changed packages, bumps minor versions, generates changelogs, opens a release PR |
| **Publish**         | Manual (`workflow_dispatch`) | Creates git tags for current package versions and pushes them                            |
| **Release**         | Automatic (on tag push)      | Publishes the tagged package to npm                                                      |

## Step by step

### 1. Prepare the release

Run the [Prepare Release](../.github/workflows/prepare-release.yml) workflow from the Actions tab. This will:

- Find each package's latest git tag (e.g. `@asset-proxy/url-parser@0.1.0`)
- For packages with changes since their last tag:
  - Bump the minor version in `package.json` (e.g. `0.1.0` → `0.2.0`)
  - Generate a `CHANGELOG.md` entry from commit messages
- For packages with no prior tag (first release):
  - Keep the current version
  - Generate an "Initial release" changelog entry
- Open a PR into `main` with the version bumps and changelogs

### 2. Merge the release PR

Review the PR to verify the version bumps and changelog entries look correct. Merge it into `main`.

CI will run automatically on the merge. Wait for it to pass.

### 3. Publish

After the release PR is merged and CI passes, run the [Publish](../.github/workflows/publish.yml) workflow from the Actions tab. This will:

- Create a git tag for each package's current version (e.g. `@asset-proxy/url-parser@0.2.0`)
- Push the tags to the repository

Each pushed tag automatically triggers the **Release** workflow, which publishes the corresponding package to npm.

## Error handling

### "Tag exists but points to a different commit"

This means the version in `package.json` hasn't been bumped since the last release. Run the **Prepare Release** workflow first, merge the PR, then try **Publish** again.

### "Tag already exists at HEAD"

The package version is already tagged at the current commit. This is safe to ignore — the package was already published.

### Publishing failed

If the Release workflow fails (e.g. npm auth issue), fix the problem and re-push the tag:

```bash
git tag -d @asset-proxy/url-parser@0.2.0
git push origin :refs/tags/@asset-proxy/url-parser@0.2.0
git tag @asset-proxy/url-parser@0.2.0
git push origin @asset-proxy/url-parser@0.2.0
```

## Tag format

Tags follow the pattern `<package-name>@<version>`:

- `@asset-proxy/url-parser@0.1.0`
- `@asset-proxy/url-generator@0.1.0`

## Packages

Only the following packages are published to npm:

| Package                  | npm name                     | Access     |
| ------------------------ | ---------------------------- | ---------- |
| `packages/url-parser`    | `@asset-proxy/url-parser`    | restricted |
| `packages/url-generator` | `@asset-proxy/url-generator` | restricted |

The proxy package (`packages/proxy`) is not published — it is deployed as a Docker image via the CD workflow.
