# Governance: node hosting and onboarding

Answers Reviewer 1c. Spec §3.4, scenario S7.

## Two tiers

| Tier | Who | Runs a node? | How they transact |
|---|---|---|---|
| **1 · consortium orgs** | Warehouse, Lender, Inspector, Regulator orgs | Yes: one peer each (`peer0.<org>.wrt.local`) plus a CA | Their own peer |
| **2 · hosted members** | Small warehouses, rural MFIs, SACCOs, farmers | No | A client certificate from their category's org CA; they use the web UI, which submits through that org's peer |

In production, each Tier-1 org would be run by a consortium operator or apex body (for example, a warehouse association hosting the Warehouse org). The PoC models this: `LND-MFI-01` (Uhuru Rural MFI) has no peer and transacts through `peer0.lender`; farmers have no peer and transact through `peer0.warehouse`.

## Why a small warehouse or MFI needs only a browser

- **Identity is a certificate, not a server.** The hosting org's CA issues a client certificate carrying `wrt.role` and `wrt.entityId` ([`network/identities.conf`](../network/identities.conf), [`register-identities.sh`](../network/scripts/register-identities.sh)).
- **Endorsement happens on Tier-1 peers.** A hosted MFI's offer is endorsed by 3 of the 4 consortium peers, the same as a bank's. Hosted members get the same tamper evidence without running anything.
- **Access is enforced in chaincode, not by the host.** Every function checks the caller's MSP **and** role **and** entity ([`lib/access.ts`](../chaincode/wrt/src/lib/access.ts)). The hosting org cannot act as one of its hosted members, because it cannot mint a certificate in another org's MSP, and its own certificates carry their own entity ID.

## Issuing, scoping and revoking hosted identities

1. **Issue.** The org CA registers the identity with `wrt.role=<role>:ecert,wrt.entityId=<id>:ecert` and enrolls it. The `:ecert` suffix puts both attributes in the certificate, which is all the chaincode can see.
2. **Onboard on-chain.** The identity can do nothing until the regulator registers its entity: `RegisterWarehouse`, `RegisterLender` or `AccreditInspector`. Warehouse operators register farmers (`RegisterFarmer`). Before that, calls fail with `NOT_FOUND` (scenario S7 shows this).
3. **Scope.** Mutations are scoped to `wrt.entityId`: WH-001's operator cannot record deposits for WH-002, and a lender cannot fund another lender's loan.
4. **Suspend or revoke.** The regulator sets an entity `SUSPENDED` (reversible) or `REVOKED` (final) with `SetEntityStatus`. The chaincode refuses the entity's next transaction (`NOT_AUTHORISED: lender LND-MFI-01 is SUSPENDED`). A warehouse may also suspend farmers it registered. Certificate revocation at the CA (CRL) is the second layer, for compromised keys.

## Who can change what

| Change | Who decides | Mechanism |
|---|---|---|
| Policy parameters (LTV thresholds, tolerances, durations, demo mode) | **Regulator** alone | `SetPolicyParams`, regulator role checked in chaincode; still endorsed by 3 of 4 peers |
| Reference prices | **Regulator** alone | `SetReferencePrice` |
| Registering, suspending, revoking entities | **Regulator** (farmers: also their warehouse) | `Register*`, `SetEntityStatus` |
| Chaincode code or endorsement policy | **Majority of orgs** (3 of 4) | Fabric lifecycle `LifecycleEndorsement: MAJORITY Endorsement` ([`configtx.yaml`](../network/configtx.yaml)); every org approves the same definition |
| Adding a full (Tier-1) org, changing channel policies | **Majority of org admins** | Channel `Admins: MAJORITY Admins` config update, signed by a majority of org admins (documented, not built) |

No single org can change the rules or the code. The regulator controls parameters but not the logic that applies them.

## Cost and friction for rural MFIs

- **No infrastructure.** No server, no Docker, no Fabric knowledge: a browser and a certificate.
- **No per-transaction fee** in the PoC; in production the hosting org's running costs would be shared by the consortium or recovered through a small membership fee.
- **Connectivity.** The UI is light (≈120 KB of JS gzipped) and works at phone width; a write is one HTTPS request. Offline capture with later sync is future work.
- **Same rights as a bank.** Hosted MFIs see the same receipts, LTV and history, under the same rules.
- **Friction that remains:** certificate issuance needs an onboarding visit or KYC with the hosting org, and the MFI depends on that org's peer being up (any 3 of 4 peers can endorse, but the hosted member submits through its own org's gateway).
