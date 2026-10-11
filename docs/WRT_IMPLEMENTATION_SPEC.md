# WRT: Implementation Spec

**Warehouse-receipt collateral with escrow release on Hyperledger Fabric**
Hackathon track: Blockchain Development & Engineering
Owner: Marko (solo), BSc Computer Science, University of Dodoma (UDOM), CIVE

> **For the coding agent:** this is a clean-slate build. No code, network, API or UI exists yet. Build everything in this document. Values marked **[PROPOSED]** are defaults Marko has not yet confirmed. Implement them as written, but keep them in config or seed data (never hard-coded in logic) so he can change them. If something here is ambiguous, ask instead of guessing.

---

## 0. Hard constraints

1. **Original work only.** Do not reuse, reference or adapt code, designs or architecture from Marko's AmanaDB project or any other existing project of his.
2. **The deliverable is a working PoC.** There are no pitches and no written report. The repo itself must defend the design, so the reviewer feedback (§10) is answered by features **and** by docs in the repo.
3. **These stay out of scope.** They are future work only, and the code should hold hooks for them, not implementations:
   - IoT oracles (digital scales, moisture sensors)
   - Fabric-to-public-chain bridging for receipt tradability (precedents: Waga Coffee, AgroToken)
   - Blockchain DIDs for farmers (SIM identity + biometrics + GIS/satellite verification; data-source precedents: DigiFarm, FarmDrive, Apollo Agriculture)
4. **Determinism in chaincode.** Do not use `Date.now()`, `Math.random()`, external calls, or unordered map iteration that affects writes. Use `ctx.stub.getTxTimestamp()` for time, and derive any "randomness" from the tx ID. Serialize state with deterministic JSON (`json-stringify-deterministic` + `sort-keys-recursive`, as in the Fabric TS samples).
5. **No floats for money, weight or percentages.** Money is integer TZS. Weight is integer kg. Percentages and ratios are integer basis points (bp; 10000 = 100%). Moisture is in bp (1300 = 13.00%).

---

## 1. What WRT is

A farmer deposits a crop at a licensed warehouse. After independent inspection, a **warehouse receipt** is minted on a four-organisation Fabric ledger to represent the stored crop. The farmer can pledge that receipt as **collateral** for a loan. The loan runs through **escrow-style conditional mechanics**:

- Lender funds go into escrow and are released to the farmer automatically, once on-chain conditions hold.
- Repayments go into escrow. Full repayment releases the funds to the lender and lifts the lien on the receipt automatically.
- Quality checks, disputes, margin calls, default and liquidation are all recorded and enforced on the shared ledger.

**Benchmark:** Kenya's eWRS-CR, a centralized electronic receipt registry.
**Differentiator:**
- WRT is a tamper-evident, multi-party ledger. No single operator, including the warehouse, can rewrite receipt history.
- Collateral escrow is released by chaincode rules rather than by manual back-office steps.

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Ledger | Hyperledger Fabric **2.5.x LTS** (latest patch), CouchDB state database, single Raft orderer |
| Identity | One Fabric CA per org; role and entity info in certificate **attributes** |
| Chaincode | **TypeScript**, `fabric-contract-api` / `fabric-shim` 2.5, Node 18 runtime |
| Backend API | Node 20 + TypeScript, **Fastify** (or Express), `@hyperledger/fabric-gateway` + `@grpc/grpc-js` |
| Frontend | React 18 + Vite + TypeScript, Tailwind CSS (custom theme, §9), TanStack Query |
| Live updates | Chaincode events → backend listener → Server-Sent Events → UI |
| Tests | Jest (or Mocha + Chai + Sinon) for chaincode unit tests; integration scripts against the running network |
| Host | **Linux or WSL2 with Docker** + Docker Compose v2 |

---

## 3. Network

### 3.1 Organisations

| Org | MSP ID | Peers | Purpose |
|---|---|---|---|
| Warehouse | `WarehouseMSP` | `peer0.warehouse.wrt.local` | Hosts warehouse operators **and farmers** as client identities (§3.4) |
| Lender | `LenderMSP` | `peer0.lender.wrt.local` | Hosts banks, MFIs and SACCOs as client identities |
| Inspector | `InspectorMSP` | `peer0.inspector.wrt.local` | Accredited, independent crop inspectors |
| Regulator | `RegulatorMSP` | `peer0.regulator.wrt.local` | WRRB-role oversight: licensing, WRRB registration, dispute arbitration |
| Orderer | `OrdererMSP` | `orderer.wrt.local` | Single Raft node (PoC) |

- Channel: `wrt-channel`. Chaincode name: `wrt`.
- Build a **custom** 4-org network: your own `configtx.yaml`, Docker Compose and scripts. The stock `test-network` is 2 orgs (+ addOrg3) and is fine as a reference only.
- `network/network.sh` must support `up`, `down`, `createChannel`, `deployCC`, `registerIdentities` and `seed`.

### 3.2 Endorsement policy

- Chaincode-level policy: **`OutOf(3, 'WarehouseMSP.peer','LenderMSP.peer','InspectorMSP.peer','RegulatorMSP.peer')`** (majority).
- Effect: no single org can change state alone, and that includes the warehouse that physically holds the crop. This is the core of the tamper-evidence story and must be demonstrable (§8, scenario S6).
- Chaincode functions **also** enforce who may call them, using MSP ID + cert attributes (§3.4). Endorsement guards against rogue peers; access checks guard against rogue clients.

### 3.3 Private data

- Collection `farmerPII`. Members: Warehouse, Lender, Regulator. **Inspector is excluded**, because inspectors grade crops and do not need identity data. Set `memberOnlyRead: true` and `blockToLive: 0`.
- Contents: farmer full name, phone, national ID number (NIDA), village or ward.
- Public state stores only `farmerId` and `piiHash = sha256(canonical PII JSON)`.
- PII is passed via **transient data**, never as function arguments.

### 3.4 Identities, hosting and governance

This section answers Reviewer 1's onboarding concern. Model it in the PoC; do not just describe it.

- **Tier 1, full node orgs:** the four consortium orgs above run peers.
- **Tier 2, hosted members:** small warehouses, rural MFIs, SACCOs and farmers **do not run nodes**. They get client certificates from their category's org CA (warehouses and farmers from the Warehouse CA, MFIs from the Lender CA), and they use the web UI through the hosting org's peer. In production the hosting org would be a consortium operator or apex body.
- Certificate attributes, issued with `ecert: true`:
  - `wrt.role` ∈ `warehouse_operator | farmer | lender_officer | inspector | regulator_officer`
  - `wrt.entityId`: the warehouse, lender, inspector or farmer ID this identity acts for
- Chaincode checks **both** the MSP ID **and** `wrt.role`. Mutations are scoped to `wrt.entityId`: an operator of warehouse `WH-001` cannot act on receipts from `WH-002`.
- **On-chain onboarding governance:** a hosted entity can transact only after the Regulator registers it on-chain (`RegisterWarehouse`, `RegisterLender`, `AccreditInspector`). Warehouse operators register farmers.
- **Channel governance** (documented, not built): adding a full org, or changing the endorsement or lifecycle policy, requires MAJORITY of org admins. Put this in `docs/GOVERNANCE.md`.

Seed identities (at least): 2 warehouses (`WH-001` Dodoma, `WH-002` Morogoro), 2 lenders (`LND-BANK-01` a bank, `LND-MFI-01` a rural MFI), 3 inspectors (`INS-01..03`), 1 regulator officer (`REG-01`), 4 farmers (`FRM-001..004`).

---

## 4. Data model (world state)

Use composite keys: `objectType~id`. Every asset has `docType`, `createdAt`, `updatedAt` and `version` (integer, incremented on each write). Timestamps are ISO strings taken from the tx timestamp.

### 4.1 Registry assets

```ts
Warehouse {
  id; name; region; licenseNo;        // WRRB operating licence number
  capacityKg: int; bondRef: string;   // indemnity bond / insurance reference (off-chain doc)
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  penaltyCount: int;                  // incremented on FRAUDULENT dispute outcomes
}
Lender     { id; name; type: 'BANK' | 'MFI' | 'SACCO'; licenseNo; status }
Inspector  { id; name; accreditationNo; status; conflictWarehouseIds: string[] }
Farmer     { id; registeredByWarehouseId; piiHash; status }
ReferencePrice { commodity; grade; priceTzsPerKg: int; setBy; effectiveAt }  // key: commodity~grade
PolicyParams   { ...see §4.5 }        // singleton, Regulator-only
```

### 4.2 Deposit (pre-receipt)

```ts
Deposit {
  id; warehouseId; farmerId; commodity;
  declared: { grade; netKg: int; moistureBp: int };   // warehouse operator's figures
  declaredEvidence: string[];   // sha256 hashes: weighbridge ticket photo, sample photo
  sampleSealNo: string;         // tamper seal on the retained sample bag
  assignedInspectorId;          // deterministic assignment, §5.1
  attestation?: Attestation;
  status: 'PENDING_ATTESTATION' | 'ATTESTED' | 'MISMATCH_DISPUTED' | 'REJECTED';
  receiptId?;
}
Attestation {
  inspectorId; source: 'HUMAN_INSPECTOR' | 'IOT_DEVICE';   // IOT_DEVICE reserved, not built
  deviceId?: string;                                        // future-work hook
  observed: { grade; netKg; moistureBp };
  evidence: string[]; sampleSealNoVerified: boolean; attestedAt;
}
```

### 4.3 WarehouseReceipt

```ts
WarehouseReceipt {
  id;                       // e.g. WRT-WH001-000123
  depositId; warehouseId; holderFarmerId; commodity;
  grade; netKg: int; moistureBp: int;   // ALWAYS the inspector-attested values
  issuedAt; expiresAt;                  // storage term [PROPOSED: 180 days]
  legal: { status: 'PENDING_WRRB' | 'WRRB_REGISTERED'; wrrbReceiptNo?; registeredBy?; registeredAt? };
  status: 'ISSUED' | 'PLEDGED' | 'UNDER_DISPUTE' | 'DEFAULTED' | 'LIQUIDATED'
        | 'REDEEMED' | 'CANCELLED';
  statusBeforeDispute?;                 // restored when a dispute closes
  lien?: { loanId; lenderId; placedAt };
  lastQualityCheckAt; qualityHistory: QualityCheckSummary[];
  amendments: { at; field; from; to; disputeId }[];   // corrections from disputes, never silent
}
```

### 4.4 Loan + escrow

```ts
Loan {
  id; receiptId; lenderId; farmerId;
  principalTzs: int; interestBp: int;   // flat interest for the term [PROPOSED]
  totalDueTzs: int;                     // principal + principal*interestBp/10000
  termSecs: int;                        // real deployments: days; demo mode: minutes
  offeredAt; acceptedAt?; disbursedAt?; maturityAt?;
  pausedSecs: int;                      // time frozen by disputes, added to maturity
  repaidTzs: int;
  status: 'OFFERED' | 'ACCEPTED' | 'ACTIVE' | 'MARGIN_CALL' | 'REPAID'
        | 'DEFAULTED' | 'LIQUIDATED' | 'CANCELLED';
  marginCall?: { raisedAt; deadlineAt; requiredPaydownTzs; reason };
  disbursementConditions: ConditionResult[];   // last evaluation, shown in UI
}
Escrow {           // one per loan, key escrow~loanId
  loanId; balanceTzs: int;
  entries: { at; type: 'FUND' | 'DISBURSE_TO_FARMER' | 'REPAYMENT' | 'RELEASE_TO_LENDER'
                 | 'REFUND_TO_LENDER' | 'LIQUIDATION_PROCEEDS' | 'SURPLUS_TO_FARMER'
                 | 'COMPENSATION';
             amountTzs: int; paymentRef: string; txId }[];
}
```

**Money rails are simulated.** Real TZS moves off-chain (bank or mobile money). The ledger records the obligations, the conditional releases and the `paymentRef` of each off-chain transfer. The UI shows mock refs such as `MPESA-SIM-…`. State this plainly in `docs/TRUST_MODEL.md`.

### 4.5 PolicyParams [PROPOSED defaults, Regulator-editable]

| Param | Default | Meaning |
|---|---|---|
| `maxLtvBp` | 6000 | Max loan-to-value at offer time |
| `marginCallLtvBp` | 7500 | LTV that triggers a margin call |
| `liquidationLtvBp` | 8500 | LTV that triggers default |
| `marginCallGraceSecs` | 7 days (demo: 3 min) | Time to cure a margin call |
| `maturityGraceSecs` | 14 days (demo: 3 min) | Grace after maturity before default |
| `weightToleranceBp` | 50 (0.5%) | Allowed declared-vs-observed weight gap |
| `moistureToleranceBp` | 100 (1.0 pp) | Allowed moisture gap |
| `gradeMustMatch` | true | Grades must match exactly |
| `challengeWindowSecs` | 14 days (demo: 10 min) | Window after issuance for a minting dispute without new evidence of fraud |
| `qualityCheckIntervalSecs` | 30 days (demo: 5 min) | Max age of the last quality check while a loan is active |
| `attestationMaxAgeSecs` | 7 days (demo: 10 min) | Attestation freshness required for disbursement |
| `demoMode` | true | Use the demo durations |

### 4.6 Dispute

```ts
Dispute {
  id; subject: { kind: 'DEPOSIT' | 'RECEIPT'; id };
  type: 'MINT_MISMATCH' | 'MINT_ACCURACY' | 'QUALITY_DEGRADATION' | 'OTHER';
  raisedBy: { role; entityId }; claim: string; evidence: string[]; raisedAt;
  reinspection?: { inspectorId; assignedAt; observed?; evidence?; submittedAt? };
  status: 'OPEN' | 'REINSPECTION_ASSIGNED' | 'REINSPECTED' | 'RESOLVED';
  resolution?: {
    outcome: 'CONFIRMED' | 'CORRECTED' | 'FRAUDULENT' | 'NATURAL_DEGRADATION' | 'STORAGE_NEGLIGENCE';
    liability: 'NONE' | 'WAREHOUSE' | 'FARMER' | 'INSPECTOR';
    findings: string; compensationTzs: int; resolvedBy; resolvedAt;
  };
}
```

### 4.7 Commodities & reference prices [PROPOSED, illustrative only]

Seed MAIZE, PADDY, SESAME and CASHEW, with grades `G1`, `G2` and `G3`, and illustrative TZS/kg prices. The UI labels prices as "illustrative reference price set by Regulator". Collateral value = `netKg × price(commodity, grade)`.

---

## 5. Core workflows

### 5.1 Minting with interim human attestation (Reviewer 2, Reviewer 3)

Until IoT oracles exist, the oracle is a **two-party human check**. The warehouse declares, and an independent, randomly assigned inspector verifies. A receipt is minted only when both agree within tolerance.

1. **Warehouse operator → `RecordDeposit`.** Records the declared grade, weight and moisture, evidence hashes (weighbridge ticket photo, sample photo) and the **sample seal number**. Requires the warehouse to be `ACTIVE` and the farmer to be registered.
2. **Chaincode assigns an inspector** deterministically: take the `ACTIVE` inspectors, drop any whose `conflictWarehouseIds` include this warehouse, sort by ID, and pick index `int(sha256(txId)) mod n`. The warehouse cannot choose its inspector.
3. **Inspector → `SubmitAttestation`.** Only the assigned inspector can call it. Records observed values, evidence and seal verification.
4. **Chaincode compares** declared and observed values against the tolerances.
   - **Within tolerance and seal verified:** the deposit becomes `ATTESTED`, and a `WarehouseReceipt` is minted with the **inspector's** values, `status ISSUED` and `legal.status PENDING_WRRB`. Emit `ReceiptIssued`.
   - **Outside tolerance or seal not verified:** the deposit becomes `MISMATCH_DISPUTED`. A `MINT_MISMATCH` dispute is **opened automatically** and no receipt exists. Emit `DisputeOpened`.
5. **Regulator → `RecordWrrbRegistration(receiptId, wrrbReceiptNo)`.** Sets `legal.status WRRB_REGISTERED`. **A receipt cannot be pledged until it is WRRB-registered** (§7.2).

### 5.2 Loan origination and escrow disbursement

1. **Lender → `OfferLoan(loanId, receiptId, principalTzs, interestBp, termSecs)`.** Requires: receipt `ISSUED`, WRRB-registered, not expired, no open dispute, lender `ACTIVE`, and `principal / collateralValue ≤ maxLtvBp`. Loan becomes `OFFERED`.
2. **Farmer → `AcceptLoan(loanId)`.** Places the lien: receipt becomes `PLEDGED`, loan becomes `ACCEPTED`, and an escrow is created.
3. **Lender → `FundEscrow(loanId, amountTzs, paymentRef)`.** Records the funding, then evaluates the **disbursement conditions**:
   - escrow balance ≥ principal
   - receipt is `PLEDGED`, with the lien on this loan
   - receipt is WRRB-registered and not expired
   - latest attestation or quality check is within `attestationMaxAgeSecs`
   - warehouse is `ACTIVE`, and the receipt has no open dispute

   If every condition holds, the chaincode **releases automatically**: a `DISBURSE_TO_FARMER` entry is written, the loan becomes `ACTIVE`, and `maturityAt` is set. If any condition fails, the funds stay in escrow and the failing conditions are stored in `disbursementConditions` for the UI. Anyone may later call `EvaluateDisbursement(loanId)` to retry.

### 5.3 Repayment and automatic release

- **Farmer → `Repay(loanId, amountTzs, paymentRef)`.** Adds a `REPAYMENT` entry and increases `repaidTzs`.
- When `repaidTzs ≥ totalDueTzs`, the chaincode **automatically**: writes `RELEASE_TO_LENDER`, sets the loan to `REPAID`, lifts the lien, and returns the receipt to `ISSUED`. Emit `LienReleased`.
- A partial repayment during `MARGIN_CALL` cures the call once LTV is back under `marginCallLtvBp`.
- **Withdrawal:** the farmer calls `RequestWithdrawal(receiptId)`, which is allowed only for an `ISSUED` receipt with no lien. The warehouse operator then calls `ConfirmRelease(receiptId)`, and the receipt becomes `REDEEMED`.
- *Stretch goal:* partial crop release proportional to repayment, as long as LTV stays under `maxLtvBp`.

### 5.4 Quality monitoring during a loan (Reviewer 2)

- **Lender → `RequestQualityCheck(receiptId)`**, or the keeper flags it once `lastQualityCheckAt` is older than `qualityCheckIntervalSecs`.
- **Inspector → `SubmitQualityCheck(receiptId, observed, evidence)`.** The receipt's grade, weight and moisture are updated, with a matching `amendments` entry. Collateral value and LTV are recomputed.
  - LTV ≥ `marginCallLtvBp`: the loan moves to `MARGIN_CALL`, with a deadline and `requiredPaydownTzs`.
  - LTV ≥ `liquidationLtvBp`: the loan becomes `DEFAULTED`.
- **The question of who bears the loss** goes through a dispute (§5.6): `NATURAL_DEGRADATION` falls on the farmer as collateral risk, and `STORAGE_NEGLIGENCE` falls on the warehouse, whose liability and compensation are recorded against its bond.

### 5.5 Keeper (time-based automation)

Chaincode cannot run itself, so time rules are **permissionless check functions** that read the tx timestamp:

- `EvaluateLoan(loanId)` handles maturity, maturity grace, margin-call deadlines, overdue quality checks and LTV thresholds. It sets `MARGIN_CALL` or `DEFAULTED` where needed.
- `EvaluateDisbursement(loanId)` re-runs the §5.2 conditions.

The backend runs a keeper job every 30 s (demo) that calls these for every open loan using a service identity. Because the logic is in chaincode, any party could run the keeper with the same result. Document this.

### 5.6 Disputes (Reviewer 2, Reviewer 3)

**Raising:** `RaiseDispute(disputeId, subject, type, claim, evidence)` may be called by the lender with an interest in the receipt, the farmer holder, the warehouse, any inspector or the regulator.

- The receipt is **frozen** (`UNDER_DISPUTE`; the previous status is saved).
- Any loan clock pauses, and the frozen time is added to `pausedSecs`.
- For `MINT_ACCURACY` raised after `challengeWindowSecs`, the claim must include at least one evidence hash. [PROPOSED]

**Re-inspection:** Regulator calls `AssignReinspection(disputeId)`. The chaincode assigns a different inspector deterministically, excluding the original inspector and conflicted inspectors. That inspector calls `SubmitReinspection`.

**Resolution:** Regulator calls `ResolveDispute(disputeId, outcome, liability, findings, compensationTzs)`.

| Outcome | Effect |
|---|---|
| `CONFIRMED` | Original values stand; receipt unfrozen |
| `CORRECTED` | Receipt amended to re-inspected values (logged in `amendments`); LTV recomputed, so a margin call may follow |
| `FRAUDULENT` | Receipt `CANCELLED`; warehouse `penaltyCount++` and status set to `SUSPENDED`; if pledged, loan `DEFAULTED` and a `COMPENSATION` claim recorded against the warehouse bond (`liability: WAREHOUSE`) |
| `NATURAL_DEGRADATION` | Values amended; loss is collateral risk (`liability: FARMER`); normal margin rules apply |
| `STORAGE_NEGLIGENCE` | Values amended; `liability: WAREHOUSE`; compensation recorded and payable into the escrow to restore collateral value |

**For `MINT_MISMATCH` (auto-opened at minting):**
- `CONFIRMED` for the warehouse's declaration mints the receipt with the declared values.
- `CORRECTED` mints with the re-inspected values.
- `FRAUDULENT` rejects the deposit and penalises the warehouse.

**Every step is a ledger transaction with full history.** That history is the audit trail.

### 5.7 Default and liquidation

- A `DEFAULTED` loan sets the receipt to `DEFAULTED`.
- **Lender → `ExecuteLiquidation(loanId, saleProceedsTzs, buyerRef)`** records the sale and runs a **waterfall** in escrow: lender is paid up to the amount owed, and any surplus goes to the farmer as `SURPLUS_TO_FARMER`.
- The receipt becomes `LIQUIDATED` and the loan becomes `LIQUIDATED`.

---

## 6. Chaincode layout

One chaincode, `wrt`, with several contracts, so functions are invoked as `Contract:Function`:

- `RegistryContract`: `RegisterWarehouse`, `SetWarehouseStatus`, `RegisterLender`, `AccreditInspector`, `RegisterFarmer` (PII via transient), `SetReferencePrice`, `SetPolicyParams`, `InitLedger` (seed)
- `ReceiptContract`: `RecordDeposit`, `SubmitAttestation`, `RecordWrrbRegistration`, `SubmitQualityCheck`, `RequestQualityCheck`, `RequestWithdrawal`, `ConfirmRelease`
- `LoanContract`: `OfferLoan`, `AcceptLoan`, `FundEscrow`, `EvaluateDisbursement`, `Repay`, `EvaluateLoan`, `ExecuteLiquidation`, `CancelOffer`
- `DisputeContract`: `RaiseDispute`, `AssignReinspection`, `SubmitReinspection`, `ResolveDispute`
- `QueryContract`: `Get<Asset>`, `GetHistory(key)` (via `getHistoryForKey`), CouchDB rich queries (receipts by warehouse, farmer or status; loans by lender or status; open disputes), `GetFarmerPII` (collection members only)

Requirements:
- A shared `access.ts` helper: `requireRole(ctx, msp, roles[])` and `requireEntity(ctx, entityId)`.
- A shared `state-machine.ts` that defines every allowed status transition. Every illegal transition throws.
- Emit chaincode events for: `ReceiptIssued`, `ReceiptStatusChanged`, `DisputeOpened`, `DisputeResolved`, `LoanStatusChanged`, `EscrowReleased`, `MarginCall`.
- CouchDB indexes under `META-INF/statedb/couchdb/indexes` for every rich query.

---

## 7. Docs the repo must contain

These docs replace the report, so write them properly. They must stay short, specific and tied to the code.

### 7.1 `docs/TRUST_MODEL.md`: oracle risk (Reviewer 1)

- **State the limit:** a blockchain records claims faithfully, but it cannot see the crop. Minting is the oracle problem.
- **Interim mitigation (built):**
  - Separation of duties: the warehouse declares, and an independent inspector attests.
  - Deterministic random inspector assignment with conflict exclusion.
  - Tolerance checks with auto-dispute.
  - Sealed retained samples (seal number on-chain).
  - Evidence hashes anchored on-chain (photos and tickets stay off-chain; the hashes prove they were not swapped).
  - Periodic quality checks during loans.
  - Re-inspection by a different inspector on dispute.
  - Warehouse penalties and bond-backed compensation.
  - Majority endorsement, so no single org rewrites history.
- **Physical auditing:** the Regulator runs unannounced spot audits, recorded as `QualityCheck`s triggered by the regulator.
- **Future: IoT oracles.** The `Attestation.source = IOT_DEVICE` and `deviceId` hooks already exist. Signed readings from scales and moisture sensors would become a second, independent attestation, which narrows the space for elite capture at deposit. Not built.
- **Simulated money rails**, as stated in §4.4.

### 7.2 `docs/LEGAL_EQUIVALENCE.md`: WRRB / WRS Act 2005 (Reviewer 1)

**Design position:** WRT does not create a new instrument of title. It mirrors and anchors the legally recognised receipt.
- Only WRRB-licensed warehouses (licence number recorded on-chain by the Regulator) can mint.
- A receipt is pledgeable only after the Regulator records its **WRRB receipt number** (`legal.status = WRRB_REGISTERED`). The Regulator node is a consortium member, so the regulator co-signs the record that lenders rely on.
- Liens, transfers, disputes and liquidation leave a ledger history that the regulator can read directly.

Include a clear note: the specific provisions of the Warehouse Receipt System Act 2005 (and later amendments or regulations) on electronic receipts and registries must be **verified with WRRB before production use**. The PoC shows the technical mechanism and makes no legal claim.

### 7.3 `docs/GOVERNANCE.md`: node hosting & onboarding (Reviewer 1)

Cover:
- The tiered model in §3.4.
- Why small warehouses and MFIs need only a browser.
- How hosted identities are issued, scoped and revoked.
- Who can change policy parameters (the Regulator) and channel config (majority of admins).
- Cost and friction notes for rural MFIs.

### 7.4 `docs/DISPUTES.md` (Reviewers 2 and 3)

- The full dispute lifecycle as a diagram (Mermaid).
- A table of outcomes and liabilities.
- Worked examples matching scenarios S2–S4.

### 7.5 `docs/REVIEWER_RESPONSES.md`

A table with one row per reviewer point (§10). Columns: the point, the feature that answers it, the doc section, and the demo scenario that shows it.

### 7.6 `docs/BENCHMARK.md`

WRT vs eWRS-CR:
- Centralized registry vs multi-party ledger
- Manual vs automated escrow release
- Single-operator vs majority-endorsed history
- Dispute trail

Keep claims about eWRS-CR general and hedged.

### 7.7 `README.md`

Prerequisites, one-command bring-up (`make up && make seed && make dev`), demo accounts, scenario walkthroughs and the architecture diagram.

---

## 8. Demo scenarios (seed scripts + UI walkthroughs)

`scripts/scenarios/` contains one script per scenario that drives the API end to end. Each script must also be reproducible by clicking through the UI.

| # | Scenario | Shows |
|---|---|---|
| S1 | **Happy path:** deposit → attest → issue → WRRB register → offer → accept → fund (auto-disburse) → repay → auto lien release → withdraw | Core flow, escrow automation |
| S2 | **Inflated weight at minting:** warehouse declares 10,000 kg, inspector observes 9,200 kg → auto `MINT_MISMATCH` → re-inspection → `FRAUDULENT` → warehouse suspended | Reviewer 3 |
| S3 | **Post-issuance grade challenge:** lender disputes the grade → receipt frozen and loan clock paused → re-inspection → `CORRECTED` → LTV recomputed → margin call | Reviewer 3, disputes |
| S4 | **Quality degradation during loan:** quality check shows a grade drop → margin call → disputed → `STORAGE_NEGLIGENCE` → warehouse compensation into escrow → cured | Reviewer 2 |
| S5 | **Default & liquidation:** maturity passes unpaid → keeper defaults the loan → liquidation waterfall → surplus to farmer | Escrow mechanics |
| S6 | **Tamper attempt:** a script submits an update endorsed only by the Warehouse peer → rejected for endorsement policy failure. Then the UI shows the receipt's full `GetHistory` with tx IDs | Tamper-evidence differentiator |
| S7 | **Hosted MFI onboarding:** Regulator registers `LND-MFI-01` → MFI officer logs in through the hosted identity and makes an offer, with no peer of its own | Reviewer 1, governance |

Demo mode durations make S3–S5 runnable in under 10 minutes.

---

## 9. Web UI

### 9.1 Structure

- **Login:** a demo identity picker that lists the seeded identities grouped by role. The backend maps each to a wallet identity. This is not real auth; label it "Demo identity".
- **A persistent identity bar** shows the org, role, entity ID (mono) and a switch-identity control.
- Role views:
  - **Warehouse operator:** register farmer, record deposit, deposits awaiting attestation, receipts in custody, withdrawals to confirm, disputes against me.
  - **Farmer:** my receipts, loan offers (accept), active loans (repay), withdrawal requests.
  - **Lender:** eligible receipts (WRRB-registered, unpledged), make offer, fund escrow, my loans with LTV gauges, request quality check, raise dispute, liquidate.
  - **Inspector:** my assignments (attestations, quality checks, re-inspections) with declared vs observed entry.
  - **Regulator:** register and suspend entities, WRRB registration queue, dispute arbitration, reference prices, policy params, network-wide activity.
- **Receipt detail page** (the centrepiece):
  - a status state-machine strip
  - current grade, weight and moisture
  - collateral value, and LTV if pledged
  - lien card
  - an amendments log
  - a **ledger history timeline** (every version, tx ID, timestamp, invoking role)
  - disputes
- **Loan detail page:**
  - a disbursement-conditions checklist (live pass/fail)
  - an escrow ledger table
  - an LTV gauge with margin and liquidation markers
  - a countdown to maturity or deadline
- **Live activity feed** fed by SSE chaincode events.

### 9.2 Visual design (strict)

- **Fonts:** **DM Sans** for all UI text, **including headers**. **Geist Mono** for IDs, tx hashes, amounts in tables, receipt numbers and code. **No serif fonts anywhere.**
- **No brown, cream, beige, tan, olive or other earthy tones**, including backgrounds.
- **Avoid the generic AI-app look:**
  - no soft pastel gradient heroes
  - no warm off-white canvases
  - no oversized rounded cards with sparkle icons
  - no emoji
  - no default chat-app styling
- **Direction: a "ledger console".** Crisp, information-dense and engineered, closer to a trading or ops terminal than a marketing page.
  - Cool neutral canvas, 1px hairline borders, tight 4/8 px spacing grid, small radii (4–6 px)
  - Mono figures in tables, aligned right
  - Status chips with a coloured dot + text (never colour alone)
- **Palette [PROPOSED]:**
  - ink `#0A0E1A`
  - canvas `#F3F5F9`
  - surface `#FFFFFF`
  - line `#DCE1EA`
  - muted text `#5A6378`
  - primary `#3355FF` (electric indigo)
  - secondary `#0FB5C9` (cyan)
  - success `#0EA472`, warning `#F2A900`, danger `#E5484D`
  - disputed/frozen `#7C5CFF` (violet)
- Optional dark theme using the same hues on `#0A0E1A`.
- Responsive down to 390 px width. Keyboard accessible. Contrast to WCAG AA.

---

## 10. Reviewer feedback → requirements

| # | Reviewer point | Answered by |
|---|---|---|
| R1a | How physical auditing and sensor oracles mitigate oracle risk | §5.1, §5.4, regulator spot audits, IoT hooks; `TRUST_MODEL.md`; S2, S4 |
| R1b | Legal equivalency with WRRB receipts under the WRS Act 2005 | WRRB licence check, `RecordWrrbRegistration` gate before pledging; `LEGAL_EQUIVALENCE.md`; S1 |
| R1c | Node hosting / governance for small warehouses and rural MFIs | Tier-2 hosted identities, on-chain onboarding; `GOVERNANCE.md`; S7 |
| R2a | Interim human-led crop attestation before IoT | Two-party declare/attest with random inspector, tolerances, seals, evidence hashes; §5.1; S1, S2 |
| R2b | Disputes if crop quality degrades during the loan | Quality checks, margin calls, `QUALITY_DEGRADATION` dispute with liability split; §5.4, §5.6; S4 |
| R3 | Dispute if an operator submits an inaccurate grade or weight at minting | Auto `MINT_MISMATCH` + post-issuance `MINT_ACCURACY` with re-inspection and penalties; §5.6; S2, S3 |

---

## 11. Backend API

- REST, JSON. Identity comes from a demo session header that maps to a wallet identity. Gateway connections are pooled per identity, using that identity's org peer.
- Endpoints mirror the chaincode functions, for example:
  - `POST /deposits`, `POST /deposits/:id/attestation`
  - `POST /receipts/:id/wrrb`
  - `POST /loans`, `POST /loans/:id/accept`, `/fund`, `/repay`, `/liquidate`
  - `POST /disputes`, `/disputes/:id/assign`, `/reinspection`, `/resolve`
  - `GET /receipts/:id/history`
  - `GET /events` (SSE)
  - `GET /me`
- Map chaincode errors to clear 4xx messages (illegal transition, not authorised, LTV exceeded, and so on). The UI shows them verbatim.
- Run the keeper job (§5.5) inside the backend process, behind the env flag `KEEPER_ENABLED`.
- Evidence uploads: store files locally under `backend/uploads/`, put only the sha256 on-chain, and verify the hash on display.

---

## 12. Repository layout

```
wrt/
  network/        configtx.yaml, compose/, organizations/ (CA configs), scripts/, network.sh
  chaincode/wrt/  src/{contracts,models,lib}, test/, META-INF/statedb/couchdb/indexes
  backend/        src/{routes,fabric,keeper,events}, uploads/
  frontend/       src/{views,components,theme}, index.html
  scripts/        seed.ts, scenarios/S1..S7.ts, demo-tamper.sh
  docs/           TRUST_MODEL, LEGAL_EQUIVALENCE, GOVERNANCE, DISPUTES, REVIEWER_RESPONSES, BENCHMARK
  Makefile        up, down, deploy, seed, dev, test, scenarios
  README.md
```

---

## 13. Build milestones (in order; each must pass before the next)

1. **Network.** Four orgs + orderer + CAs + CouchDB are up. The channel exists. A hello-world chaincode deploys with the majority policy. *Accept:* invoke and query work from each org.
2. **Identities.** The CA registers the seed identities with `wrt.role` / `wrt.entityId` attributes, and wallets are generated. *Accept:* chaincode can read the attributes.
3. **Chaincode core.** Registry, deposit/attestation/minting, WRRB registration, state machine, access control and unit tests. *Accept:* ≥ 85% line coverage on the contracts; all illegal transitions are tested.
4. **Loans & escrow.** Offer, accept, fund, auto-disburse, repay, auto-release, keeper evaluation and liquidation waterfall. *Accept:* S1 and S5 pass as scripts.
5. **Disputes & quality.** *Accept:* S2, S3 and S4 pass as scripts.
6. **Backend API + events + keeper.** *Accept:* every scenario script runs through the API.
7. **Frontend.** All role views, receipt and loan detail pages, live feed and the design rules in §9. *Accept:* S1–S7 can be clicked through.
8. **Tamper & governance demos.** S6 and S7. *Accept:* the endorsement failure is shown clearly.
9. **Docs.** All of §7. *Accept:* every row in §10 links to working evidence.

---

## 14. Open decisions for Marko [PROPOSED → confirm or change]

1. Policy parameters and demo durations (§4.5).
2. Flat interest for the term vs pro-rated interest (§4.4).
3. Commodities, grades and illustrative prices (§4.7).
4. The endorsement policy: majority 3-of-4, or a regulator-mandatory variant `AND(Regulator, OutOf(1, others))`.
5. Whether farmers act directly with hosted identities (current spec) or through warehouse operators acting on their behalf.
6. Whether partial crop release (§5.3) moves from stretch goal to core scope.
7. The palette (§9.2).