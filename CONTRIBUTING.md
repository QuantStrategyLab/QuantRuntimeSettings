# Contributing

Thanks for contributing to `QuantRuntimeSettings`.

## Ground Rules

- Prefer small pull requests with one clear purpose.
- Keep refactors separate from behavior, contract, workflow, or documentation changes.
- Preserve this repository's boundary as a runtime settings schema and tooling package; do not move broker execution, live-allocation decisions, private credentials, or unrelated platform logic into it.
- Add or update tests, examples, docs, or reproducible evidence when changing behavior or public contracts.
- Verify changes that touch strategy switch targets, automation, secrets, cloud resources, or broker/exchange behavior with a test environment, dry-run, or read-only evidence before they affect production; do not change production on the strength of a documentation example alone.

## Documentation Standards

- Keep `README.md` as the entry point for project purpose, boundary, repository layout, quick start, and links to deeper docs.
- Put long-form runbooks, artifact contracts, evidence notes, and architecture details under `docs/` when they outgrow the README.
- Document inputs, outputs, required permissions, risk controls, and validation commands for workflows or scripts that touch external systems.
- Keep English and Chinese user-facing docs aligned when a change affects operators, contributors, or downstream platform users.

## Branching and Pull Requests

- Create a topic branch for each change.
- Open a pull request with a concise summary, scope boundary, and concrete validation notes.
- Wait for CI to pass before merging.
- Do not include generated artifacts, private data, credentials, account identifiers, or local environment files unless the repository explicitly documents them as public examples.

## Local Verification

Run the lightweight whitespace check for every change and the repository test command when code, contracts, workflows, or examples change:

```bash
git diff --check
python3 scripts/runtime_settings.py validate
python3 -m unittest discover -s tests -v
```

For documentation-only changes, at minimum review Markdown links, headings, and bilingual consistency before opening the pull request.
