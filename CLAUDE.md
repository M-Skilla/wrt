# WRT: project guide for Claude Code

WRT is a hackathon PoC: crop warehouse receipts as loan collateral, with escrow-style release, on a four-org Hyperledger Fabric network (Warehouse, Lender, Inspector, Regulator).

The owner is Marko, a CS student working solo.

## Source of truth

- `docs/WRT_IMPLEMENTATION_SPEC.md` covers the scope, data model, workflows, milestones and acceptance criteria. Follow it. Ask before deviating.
- `wrt-design/DESIGN_HANDOFF.md` and `wrt-design/screens/` cover the UI. The handoff replaces spec §9.2, so the UI font is Plus Jakarta Sans and the new palette applies.
- `shared/types.ts` holds the data contract shared by chaincode, backend and frontend. Change it only on purpose, and tell Marko when you do.

## Hard rules

- **Original work only.** Never reuse, reference or imitate code or architecture from Marko's AmanaDB project.
- **Out of scope:** IoT oracles, public-chain bridging and DIDs are future work. Keep only the hooks the spec names.
- **No floats** for money, weight or percentages. Money is integer TZS. Ratios are basis points.
- **Work in milestone order** (spec §13). Don't start a milestone until the previous one passes its acceptance check.
- **Commits** for every task you do and don't attribute claude in the commit messages.

## How Marko wants to work

Each part of the repo is worked differently:

| Area | Mode | Output style |
|---|---|---|
| `network/` | Claude builds; Marko must understand it | `/output-style explanatory` |
| `chaincode/` | Hands-on. Marko writes the business logic. See `chaincode/CLAUDE.md` | `/output-style learning` |
| `backend/` | Hands-on. Marko writes the integration logic. See `backend/CLAUDE.md` | `/output-style learning` |
| `frontend/` | Fully delegated to Claude, built against a mock API first | default |

In the `network/` area, explain each file before writing it:
- what it configures;
- which org it belongs to;
- what would break if it were wrong.

Keep each explanation short.

## Learning notes

Marko keeps `docs/LEARNING_NOTES.md` in his own words. **Never write or edit that file.**

At the end of each milestone, ask him 3 short questions about what was just built and suggest he add the answers to his notes.
