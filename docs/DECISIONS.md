# Decisions beyond the spec

Where the spec was silent or ambiguous, these are the choices made while building. Each is easy to change; the file to change is listed.

## Data contract (`shared/types.ts`)

| Addition | Why |
|---|---|
| `PolicyParams.durations` / `demoDurations` + `demoMode` | The spec gives each duration a real and a demo value. |
| `PolicyDurations.receiptTermSecs` | Receipt storage term (spec: [PROPOSED] 180 days) had to be configurable. |
| `Amendment.source` (`QUALITY_CHECK` / `DISPUTE`), optional `disputeId` | Quality checks amend values too (§5.4). |
| `QualityCheckSummary`, `QualityCheckRequest`, `receipt.pendingQualityCheck` | Named but undefined in the spec; the inspector queue needs who asked and who was drawn. |
| `receipt.withdrawalRequestedAt`, `receipt.release` (gate pass) | `RequestWithdrawal` needed somewhere to write; the UI requires a gate-pass number. |
| `receipt.activeDisputeId`, `deposit.disputeId`, `loan.pause` | Link frozen items to their dispute; compute `pausedSecs` on resolution. |
| `ConditionResult` + six condition codes | Named but undefined in the spec. |
| `ERROR_CODES` incl. `NOT_FOUND`, `ALREADY_EXISTS`, `INVALID_ARGUMENT` | Clear 4xx mapping (§11). |
| `ChaincodeEventBatch`, single `WrtEvents` Fabric event per tx | Fabric keeps only the last `setEvent()` per transaction (confirmed with Marko). |

## Chaincode

| Decision | Where |
|---|---|
| IDs are chaincode-generated counters (`DEP-WH001-0001`, `WRT-WH001-000001`, `LN-0001`, `DSP-0001`). `OfferLoan` and `RaiseDispute` therefore take no ID argument (the spec listed `loanId` / `disputeId`). Two transactions bumping the same counter in one block conflict (MVCC) and one is retried; fine at PoC volumes. | `lib/counter.ts` |
| An `ACCEPTED` (undisbursed) loan can be cancelled by the lender: escrow refunded, lien lifted. A `FRAUDULENT` ruling does the same. | `state-machine.ts`, `loan-risk.ts` |
| A `DEFAULTED` receipt cannot be disputed; it goes to liquidation. | `state-machine.ts` |
| Repayments above the outstanding amount are rejected rather than refunded. | `LoanContract.Repay` |
| Margin-call paydown brings LTV strictly below `marginCallLtvBp` (spec: "back under"). | `lib/collateral.ts` |
| `STORAGE_NEGLIGENCE` compensation is credited to the loan (`COMPENSATION` escrow entry + `repaidTzs`), so it can cure a margin call (S4). `FRAUDULENT` compensation on a pledged receipt is paid through to the lender as a bond claim. | `DisputeContract.resolveReceipt` |
| `NATURAL_DEGRADATION` requires liability `FARMER`; `STORAGE_NEGLIGENCE` and `FRAUDULENT` require `WAREHOUSE`. | `REQUIRED_LIABILITY` in `dispute.ts` |
| The re-inspection draw excludes the original attesting inspector **and** the latest quality-check inspector. For WH-002 (INS-02 conflicted) this can leave a pool of one, or zero, which fails clearly. | `DisputeContract.subjectContext` |
| Inspectors are listed with a composite-key range read (re-validated at commit), not a CouchDB rich query. | `lib/lookups.ts` |
| Serialisation uses both `json-stringify-deterministic` and `sort-keys-recursive` as the spec says; note that the latter sorts arrays of plain values (confirmed with Marko). | `lib/serialize.ts` |
| `IOT_DEVICE` attestations are never produced; the source is always `HUMAN_INSPECTOR`. | `ReceiptContract.SubmitAttestation` |

## Network and identities

| Decision | Where |
|---|---|
| Fabric CA (not cryptogen) from day one, so attributes can be issued. | `network/` |
| `farmerPII` collection: `memberOnlyRead/Write`, collection endorsement `OutOf(2, Warehouse, Lender, Regulator)`; the backend pins farmer registration to those three orgs so the Inspector peer never handles PII. | `chaincode/wrt/collections_config.json`, `backend/src/routes/registry.ts` |
| A `keeper-svc` service identity (Regulator CA, no `wrt.role`) runs the permissionless keeper checks. | `network/identities.conf` |
| `LND-MFI-01` is deliberately **not** in `InitLedger`: its on-chain onboarding is scenario S7. `seed --demo` onboards it for UI demos. | `scripts/seed-data.json` |
| `fabric-nodeenv:2.5` runs chaincode on Node 22, not Node 18 as spec §2 says. | Fabric image default |

## Backend

| Decision | Where |
|---|---|
| The keeper **evaluates** each check first and **submits** only when it reports a change, so quiet passes write nothing. | `backend/src/keeper.ts` |
| The explorer indexes every block from block 0 in memory, including the write set of each transaction, to show rejected attempts. Restarting the backend rebuilds it. | `backend/src/fabric/explorer.ts` |
| Every API request needs the `X-WRT-Identity` header; unknown labels are rejected, never defaulted. | `backend/src/fabric/gateway.ts` |

## Frontend

| Decision | Why |
|---|---|
| Built directly against the real API (no mock API phase). | The backend was complete before the frontend started. |
| Every SSE event invalidates cached reads. | Simple and correct; the ledger is small. |
| Offer expiry, operator email at warehouse registration, and inspector notes (shown in the mockups) are not built. | Not in the data model. |
