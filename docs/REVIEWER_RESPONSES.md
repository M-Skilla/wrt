# Reviewer responses

One row per reviewer point (spec §10). Every row links to working evidence: a feature in code, a doc section, and a scenario script that runs end to end (`make scenarios`, or `pnpm --filter @wrt/scripts s<N>`).

| # | Reviewer point | Answered by (feature) | Doc | Demo |
|---|---|---|---|---|
| **R1a** | How physical auditing and sensor oracles mitigate oracle risk | Declare/attest split with a drawn inspector ([`assignment.ts`](../chaincode/wrt/src/lib/assignment.ts)); tolerance check with auto `MINT_MISMATCH` ([`tolerance.ts`](../chaincode/wrt/src/lib/tolerance.ts)); periodic and overdue quality checks (`EvaluateLoan`); regulator spot audits (`RequestQualityCheck` as regulator); `IOT_DEVICE` / `deviceId` hooks in [`shared/types.ts`](../shared/types.ts) | [TRUST_MODEL.md](TRUST_MODEL.md) | **S2**, **S4**; inspector screens |
| **R1b** | Legal equivalency with WRRB receipts under the WRS Act 2005 | Only registered, ACTIVE licensed warehouses mint; `RecordWrrbRegistration` gate (`PENDING_WRRB` → `WRRB_REGISTERED`) checked by `OfferLoan`, `AcceptLoan` and disbursement | [LEGAL_EQUIVALENCE.md](LEGAL_EQUIVALENCE.md) | **S1** step 3; regulator WRRB queue |
| **R1c** | Node hosting and governance for small warehouses and rural MFIs | Tier-2 hosted identities (client certs from the org CA, no peer); on-chain onboarding (`RegisterLender`, …) and suspension (`SetEntityStatus`); MSP + role + entity checks ([`access.ts`](../chaincode/wrt/src/lib/access.ts)) | [GOVERNANCE.md](GOVERNANCE.md) | **S7**; regulator registry screen |
| **R2a** | Interim human-led crop attestation before IoT | Two-party declare/attest, random inspector with conflict exclusion, tolerances, sealed samples, evidence hashes | [TRUST_MODEL.md](TRUST_MODEL.md) §Interim mitigation | **S1**, **S2**; inspection form's live tolerance preview |
| **R2b** | Disputes if crop quality degrades during the loan | Quality checks amend the receipt and re-run LTV (margin call / default); `QUALITY_DEGRADATION` dispute with `NATURAL_DEGRADATION` (farmer) vs `STORAGE_NEGLIGENCE` (warehouse, compensation into escrow) | [DISPUTES.md](DISPUTES.md) | **S4** |
| **R3** | Dispute if an operator submits an inaccurate grade or weight at minting | Automatic `MINT_MISMATCH` at minting; post-issuance `MINT_ACCURACY` with evidence rule; re-inspection by a different drawn inspector; `FRAUDULENT` → cancel/reject, suspend, penalise | [DISPUTES.md](DISPUTES.md) | **S2**, **S3** |
| *Differentiator* | Tamper evidence vs a central registry | `OutOf(3, …)` endorsement policy; rejected writes visible in blocks; key history in the UI | [BENCHMARK.md](BENCHMARK.md) | **S6** (`scripts/demo-tamper.sh`); regulator explorer |
| *Core* | Escrow-style conditional release | Six disbursement conditions, automatic release, automatic lien release, keeper, liquidation waterfall ([`loan.ts`](../chaincode/wrt/src/contracts/loan.ts), [`loan-risk.ts`](../chaincode/wrt/src/lib/loan-risk.ts)) | [README](../README.md) | **S1**, **S5** |

## Evidence status

| Check | Result |
|---|---|
| Chaincode unit tests | 152 passing; 99% line coverage on contracts (spec requires ≥ 85%); every illegal status transition tested |
| Scenarios S1–S7 through the API on the 4-org network | All passing |
| Single-org write (S6) | Ordered, then marked `ENDORSEMENT_POLICY_FAILURE` by every peer; state unchanged |
| UI | All 26 screens, verified at 1440 px and 390 px with no console errors |
