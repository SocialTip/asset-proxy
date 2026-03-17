## General guidelines

- Whenever adding or modifying a consumer-facing contract, update the README.md

## Testing

- Do not import things like `describe`, `it` etc. from `vitest`; these are available globally
- When adding new features which affect image / video processing, prefer to add an integration test if the change is visually observable
