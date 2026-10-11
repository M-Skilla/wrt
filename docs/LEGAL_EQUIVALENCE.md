# Legal equivalence: WRT and the WRRB receipt

Answers Reviewer 1b. Spec §5.1 step 5, §7.2.

> **Not legal advice.** The provisions of Tanzania's Warehouse Receipt System Act 2005, its amendments and regulations on electronic receipts and registries must be **verified with the Warehouse Receipts Regulatory Board (WRRB) before any production use**. This PoC demonstrates a technical mechanism and makes no legal claim.

## Design position

WRT does **not** create a new instrument of title. It **mirrors and anchors** the receipt that WRRB already recognises:

1. **Only licensed warehouses mint.** A warehouse can record deposits only after the regulator registers it on-chain with its WRRB operating licence number (`Warehouse.licenseNo`), and only while it is `ACTIVE`. A suspended warehouse is refused by the chaincode on its next transaction.
2. **A receipt is pledgeable only after WRRB registration.** A newly minted receipt is `legal.status = PENDING_WRRB`. Only the regulator can record its WRRB receipt number (`RecordWrrbRegistration`), which sets `WRRB_REGISTERED`. `OfferLoan`, `AcceptLoan` and the disbursement conditions all check this. The UI's WRRB queue calls it a **gate**.
3. **The regulator co-signs what lenders rely on.** The Regulator runs one of the four peers. The registration is a ledger transaction endorsed by three of the four orgs, so the record lenders read is one the regulator wrote and every party holds.
4. **The regulator can read everything directly.** Liens (`lien`), transfers of status, amendments, disputes and liquidations are all in key history and blocks that the regulator's own peer stores. No report needs to be requested from a warehouse or bank.

## Mapping

| Legal concept (to verify with WRRB) | WRT record | Code |
|---|---|---|
| Licensed warehouse operator | `Warehouse` with `licenseNo`, `status` | `RegistryContract.RegisterWarehouse`, `SetWarehouseStatus` |
| Warehouse receipt (paper or electronic, WRRB-issued) | `WarehouseReceipt.legal.wrrbReceiptNo` | `ReceiptContract.RecordWrrbRegistration` |
| Pledge / lien in favour of a lender | `WarehouseReceipt.lien` (`loanId`, `lenderId`, `placedAt`) | `LoanContract.AcceptLoan`; lifted automatically on full repayment |
| Release of goods to the holder | `REDEEMED` with gate-pass number | `RequestWithdrawal`, `ConfirmRelease` |
| Sale of pledged goods after default | `LIQUIDATED` with sale proceeds, buyer reference and waterfall | `LoanContract.ExecuteLiquidation` |
| Regulator's register | The regulator's peer's ledger and the explorer screen | `network/`, `backend/src/fabric/explorer.ts` |

## Open questions for WRRB

- Whether a ledger entry co-signed by WRRB's peer can count as the register entry itself, or only as a mirror of it.
- What evidence of lien registration a court would accept (block, key history, signed export).
- How liquidation must be conducted (auction rules, notice periods) before `ExecuteLiquidation` is recorded.
- Retention and access rules for farmer personal data (relevant to the private collection's `blockToLive`).
