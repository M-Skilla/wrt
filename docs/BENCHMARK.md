# Benchmark: WRT vs a centralised electronic receipt registry

Spec §1, §7.6. The benchmark is Kenya's eWRS-CR, an electronic warehouse receipt system built around a **central registry**. The claims about eWRS-CR below are general and hedged: they describe the centralised-registry model as we understand it from public descriptions, not a technical audit of that system.

| Dimension | Centralised registry (eWRS-CR model) | WRT |
|---|---|---|
| **Who holds the record** | One registry database run by one authority; participants see it through that authority's application. | Four organisations (Warehouse, Lender, Inspector, Regulator) each hold a full copy of the ledger on their own peer. |
| **Who can change it** | The operator of the database (and anyone who compromises it) can change records; integrity rests on the operator's controls and audit logs. | Every write needs signatures from 3 of the 4 orgs' peers. No single party, including the warehouse holding the crop or the regulator, can change a record alone (scenario S6). |
| **Tamper evidence** | Depends on the operator's internal logging. | Every version of every record is in a block every org holds. Rejected attempts are also in blocks, marked invalid, and shown in the regulator's explorer with what they tried to write. |
| **Escrow and collateral release** | Typically manual or back-office: a bank or registry officer releases funds or lifts a lien after checking conditions. | Chaincode releases funds when six on-chain conditions hold (`FundEscrow`), lifts the lien automatically on full repayment (`Repay`), and runs margin calls, default and the liquidation waterfall from the same rules for everyone. |
| **Minting control** | Registry relies on the warehouse's entry, plus inspections organised outside the system. | Declare/attest split with a randomly drawn independent inspector, integer tolerance checks, sealed samples and an automatic dispute when they disagree (`docs/TRUST_MODEL.md`). |
| **Dispute trail** | Handled in correspondence and the registry's case notes. | Each step (raise, freeze, re-inspection draw, reading, ruling, effects) is a signed ledger transaction with full history; outcomes change receipts, loans and warehouses automatically (`docs/DISPUTES.md`). |
| **Small participants** | Access through the registry's portal. | Same: hosted members use a browser, with no node of their own (`docs/GOVERNANCE.md`). |
| **Regulatory oversight** | The regulator is often the registry operator. | The regulator is one of four co-equal orgs: it registers receipts (`WRRB_REGISTERED`) and rules on disputes, but its writes still need two other orgs to endorse. |
| **Maturity** | Operational and legally recognised. | Proof of concept; legal standing must be confirmed with WRRB (`docs/LEGAL_EQUIVALENCE.md`). |

## What WRT does not claim

- It does not make the first reading of the crop truthful; it makes a false reading detectable and costly (`docs/TRUST_MODEL.md`).
- It does not move money; payment rails are simulated and referenced by `paymentRef`.
- It is not faster or cheaper than a single database for the same throughput; the cost of multi-party endorsement buys tamper evidence and shared control.
