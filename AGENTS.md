# Growaf development instructions

- Growaf is isolated from Solaraf. Do not import runtime files or domain code from `../solaraf`.
- Keep code, tests, documentation, comments, and commits in English.
- Never expose credentials in source, logs, test fixtures, screenshots, or exports.
- All environmental, botanical, price, and cost values shown to users require a source, observation date or version, and confidence level.
- Unknown provider values remain unknown. Do not silently replace them with invented defaults.
- Backend and API behavior requires integration tests.
- Production code uses static imports only.
- Runtime-test behavior changes before committing or pushing.
