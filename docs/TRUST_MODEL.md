# Trust model: what the ledger can and cannot prove

Answers Reviewer 1a (oracle risk) and 2a (interim human attestation). Spec §5.1, §5.4, §7.1.

## The limit

A blockchain records claims faithfully. It cannot see the crop. Whoever first says "12,400 kg of maize, grade G1, 13.4% moisture" is an **oracle**, and if that statement is false the ledger will preserve a false statement perfectly. Minting is where WRT's oracle problem lives.

WRT does not pretend to solve this. It makes a false statement **expensive, detectable and attributable**.

## Interim mitigation (built)

| Control | How it works | Where |
|---|---|---|
| Separation of duties | The warehouse **declares**; an independent inspector **attests**. A receipt is minted only from the inspector's reading, and only if the two agree within tolerance. | [`ReceiptContract.RecordDeposit` / `SubmitAttestation`](../chaincode/wrt/src/contracts/receipt.ts) |
| Random inspector, no choice | The chaincode draws the inspector: ACTIVE inspectors minus declared conflicts, sorted, index `sha256(txId) mod n`. Every endorsing peer computes the same draw; nobody, including the warehouse, picks. | [`lib/assignment.ts`](../chaincode/wrt/src/lib/assignment.ts) |
| Tolerance check with auto-dispute | Weight ±0.50%, moisture ±1.0 pp, grade exact, seal verified (all regulator-set). Outside tolerance: no receipt, a `MINT_MISMATCH` dispute opens automatically. Integer arithmetic only. | [`lib/tolerance.ts`](../chaincode/wrt/src/lib/tolerance.ts) |
| Sealed retained sample | The warehouse records the tamper-seal number of the sample bag; the inspector must verify it, or minting fails. | `Deposit.sampleSealNo`, `Attestation.sampleSealNoVerified` |
| Evidence anchored on-chain | Weighbridge tickets and photos stay off-chain (`backend/uploads/`, named by hash). Their sha256 goes on-chain. A swapped file no longer matches and the API refuses to serve it (`EVIDENCE_TAMPERED`). | [`backend/src/uploads.ts`](../backend/src/uploads.ts) |
| Periodic quality checks | Lenders request checks; the keeper flags receipts whose last check is older than `qualityCheckIntervalSecs`. Results amend the receipt with a logged amendment and re-run LTV. | `RequestQualityCheck`, `SubmitQualityCheck`, `EvaluateLoan` |
| Re-inspection by someone else | A disputed reading is re-measured by a second drawn inspector, excluding the original one and the latest quality-check inspector. | [`DisputeContract.AssignReinspection`](../chaincode/wrt/src/contracts/dispute.ts) |
| Penalties and bond | A `FRAUDULENT` ruling cancels the receipt (or rejects the deposit), suspends the warehouse and increments its penalty count; compensation is claimed against its bond. | `ResolveDispute` |
| Majority endorsement | Every write needs 3 of 4 org peers. No single org, including the warehouse holding the crop, can write alone (scenario S6). | [`network/scripts/deploy-cc.sh`](../network/scripts/deploy-cc.sh) |

What collusion it would take to mint a false receipt: the warehouse **and** the drawn inspector (who the warehouse could not choose) **and** a bad sealed sample, surviving a later quality check and a re-inspection by a third person. Each step leaves a signed, permanent record.

## Physical auditing

The regulator can order an unannounced spot audit on any live receipt: `RequestQualityCheck` called by `regulator_officer` creates a check with reason `REGULATOR_AUDIT`, drawn like any other. It shows in the inspector's queue and in the receipt's history like a lender-requested check.

## Future: IoT oracles (not built)

The hooks exist: `Attestation.source` is `HUMAN_INSPECTOR | IOT_DEVICE` and `Attestation.deviceId` is reserved ([`shared/types.ts`](../shared/types.ts)). Signed readings from a certified scale and moisture sensor would become a **second, independent attestation** that the human reading must agree with. A warehouse would then need to compromise a device as well as a person, which narrows the room for elite capture at deposit. The PoC always records `HUMAN_INSPECTOR` and the UI labels `IOT_DEVICE` as reserved.

## Money rails are simulated

No real money moves. TZS moves off-chain (bank transfer or mobile money). The ledger records the **obligations** (principal, interest, repayments), the **conditional releases** (`DISBURSE_TO_FARMER`, `RELEASE_TO_LENDER`, `SURPLUS_TO_FARMER`, …) and the `paymentRef` of each off-chain transfer. References such as `MPESA-SIM-4471920` and `BANK-SIM-77104` are mock values. In production, a payment provider would confirm each transfer and the escrow would release only against a confirmed reference.

## What the ledger does guarantee

- **History cannot be rewritten by one party.** Every version of every receipt, loan and dispute is in a block that all four orgs hold, and each change needed three of them to sign.
- **Rejected attempts are visible.** A transaction that fails validation is still in a block, stamped with its validation code. The regulator's explorer lists them with the write they attempted.
- **Rules are applied identically.** Disbursement, margin calls, default and liquidation are chaincode, so the same inputs give the same outcome for every org.
- **Personal data stays private.** Farmer names, phones and NIDA numbers are in the `farmerPII` private collection (Warehouse, Lender, Regulator only). Public state holds a farmer ID and a sha256.
