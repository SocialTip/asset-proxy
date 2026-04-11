## General guidelines

- Whenever adding or modifying a consumer-facing contract, update the README.md
- Do not add section separator comments (e.g. `// --- Section name ---`) to files

## Documentation

- **JSDoc:** Write JSDoc as sentences, separated by paragraphs where appropriate. NEVER insert newlines into sentences for formatting purposes.
  - Bad:

```ts
/**
 * A service for doing something
 * very messy and complicated.
 *
 * Needs lots of dependencies.
 */
class MyService {}
```

- Good:

```ts
/**
 * A service for doing something very messy and complicated.
 *
 * Needs lots of dependencies.
 */
class MyService {}
```

## Testing

- Do not import things like `describe`, `it` etc. from `vitest`; these are available globally
- When adding new features which affect image / video processing, prefer to add an integration test if the change is visually observable
- Do not run `test:up` unnecessarily (i.e. unless Dockerfile changed) - check if container is already running, in which case do `test:restart` instead

## PR etiquette

- Prefer not to amend commits which are already pushed to a repo. Prefer to amend commits when not yet pushed AND the change is a fix to the existing commit.
- DO NOT, UNDER ANY CIRCUMSTANCES, push to ANY branch without asking the user first. Even if the user approves a push in a session, DO NOT push again without asking.
