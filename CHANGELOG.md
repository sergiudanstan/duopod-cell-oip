# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-25

First tagged release. The duopod transfer cell for [Open Industry Project](https://openindustryproject.org): a ceiling-mounted 2-axis parallel robot (modelled on the Autonox DuoPod) moving cartons from an infeed belt to an outfeed belt, with its PLC program and tests.
It opens as an OIP project folder, imports from `dist/duopod-cell.scene.json`, and runs as a GitHub Pages site
(https://sergiudanstan.github.io/duopod-cell-oip/) at OIP commit `7ed2b7d`.

### Added
- CI on every push and pull request: OIP's part, project, PLC, wiring and layout checks, the project tests, the
  `tools/perturb.sh` mutation check, and a headless Chrome smoke test of the built site (`tests/site-smoke.mjs`).
- Security audit job (`pip-audit`, `npm audit`, `zizmor`), CodeQL, OpenSSF Scorecard and a tag-triggered release
  workflow with build provenance; Dependabot for actions and npm.
- `package.json` as the version source, `SECURITY.md`, `CONTRIBUTING.md`, this changelog and README badges.

[Unreleased]: https://github.com/sergiudanstan/duopod-cell-oip/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/sergiudanstan/duopod-cell-oip/releases/tag/v0.1.0
