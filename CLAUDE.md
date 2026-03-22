## General guidelines

- Whenever adding or modifying a consumer-facing contract, update the README.md

## Documentation

- Do not add newlines in JSDoc comments for the purpose of screen wrapping.

## Testing

- Do not import things like `describe`, `it` etc. from `vitest`; these are available globally
- When adding new features which affect image / video processing, prefer to add an integration test if the change is visually observable
- Do not run `test:up` unnecessarily (i.e. unless Dockerfile changed) - check if container is already running, in which case do `test:restart` instead

## PR etiquette

- Prefer not to amend commits, especially if a PR is alraedy open. Prefer to add a new commit instead.
- Always ask the user before pushing.
