# Contributing

Thanks for helping improve Cosmic Atlas.

## Development setup

Follow the installation and run instructions in [README.md](README.md). Before opening a pull request, run:

```bash
npm ci
npm run validate:tours
npm run build
npm run build:phoenix
npm run test:view-state
npm run test:helpers
python3 -m pytest -q tests
cd backend_phoenix && mix test
```

Browser-facing changes should also be exercised through the Phoenix-served application with the smoke and mobile Playwright projects.

## Pull requests

- Keep changes focused and explain the user-visible or scientific effect.
- Add or update tests for behavior changes.
- Preserve source provenance, units, coordinate frames, uncertainty notes, and catalog selection caveats.
- Do not commit generated builds, local data caches, test reports, or verification screenshots.
- Use accessible controls and add translations for every user-visible string.

By contributing, you agree that your contribution will be distributed under the repository's MIT license.
