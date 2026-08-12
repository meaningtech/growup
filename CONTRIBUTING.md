# Contributing to GrowUp

Thank you for helping improve GrowUp. Contributions should preserve the project's core principles: explicit evidence, deterministic calculations, human review and safe treatment of unknown values.

## Before opening a change

- Search existing issues and discussions.
- Open an issue for substantial product, architecture or data-model changes.
- Never include credentials, private project data or identifiable field information.
- Keep code, tests, comments and documentation in English.

## Development setup

Follow the [local setup instructions](README.md#run-locally). The core anonymous planning workflow can run without authentication, persistence or an AI provider.

## Quality requirements

- Add integration tests for backend or API behavior.
- Add browser coverage for user-visible workflow changes.
- Preserve source, date/version and confidence metadata for environmental, botanical, price and cost values.
- Keep unknown external values unknown; do not introduce silent fallback data.
- Use static imports in production code.

Run the baseline checks before opening a pull request:

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

## Pull requests

Explain the problem, the chosen approach and the runtime verification performed. Keep changes focused. Include screenshots for visual changes and note any source or model-version changes explicitly.
