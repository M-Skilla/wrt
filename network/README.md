# The WRT network, from zero

This guide explains what's in `network/` without assuming you know anything about Fabric. Read **Part 1** first: it's a story, no commands. **Part 2** has you run things and watch. **Part 3** is reference for later.

---

# Part 1: Understand it

## 1. The problem

A farmer stores 12,400 kg of maize at a warehouse and gets a receipt. A bank lends money against that receipt.

Four parties care about that receipt, and none of them fully trusts the others:

- the **Warehouse** could inflate the weight to look good;
- the **Lender** wants proof the crop is real before lending;
- the **Inspector** checks the crop, but could be bribed;
- the **Regulator** (WRRB) needs to audit everything afterwards.

If the receipt lives in **one** database, whoever runs that database can quietly change it. That's the problem WRT solves.

## 2. The idea: four notebooks instead of one database

Imagine four clerks, one from each party, sitting in four different offices. **Each keeps their own copy of the same notebook.**

To add or change an entry (say, "issue receipt WRT-WH001-000123 for 12,400 kg"):

1. You take your request to the clerks. **At least 3 of the 4 must agree.** Each one checks it against the rulebook and their own notebook, then signs it.
2. You hand the signed request to a **messenger**. The messenger collects requests from everyone, numbers them, and bundles them into pages.
3. The messenger delivers each page to **all four clerks**.
4. **Each clerk checks the signatures again, by themselves.** Only entries with 3 valid signatures get written in. Entries without them are kept on the page but crossed out as invalid.

Now nobody can cheat alone. If the Warehouse clerk writes "15,000 kg" on their own, they can't get two more signatures, and the other three notebooks still say 12,400. And because every page is kept forever, including the crossed-out entries, any attempt to cheat leaves a trace.

**That is the whole idea of this network.** Everything else is machinery to make it work with computers.

## 3. The same story with the real names

| In the story | Real name | In our network |
|---|---|---|
| A party (Warehouse, Lender, …) | **Organisation (org)** | 4 orgs: Warehouse, Lender, Inspector, Regulator |
| A clerk | **Peer** | `peer0.warehouse.wrt.local`, `peer0.lender…`, `peer0.inspector…`, `peer0.regulator…` |
| The notebook, all pages | **Ledger** (a chain of **blocks**) | stored inside each peer |
| The "current totals" page at the front | **World state** | each peer's **CouchDB** database |
| The rulebook | **Chaincode** (smart contract) | now: the tiny `chaincode/hello`; from milestone 3: the real WRT code |
| "3 of 4 must sign" | **Endorsement policy** | `OutOf(3, …)` in `scripts/deploy-cc.sh` |
| A clerk signing a request | **Endorsing** | |
| The messenger | **Orderer** | `orderer.wrt.local` |
| A page | **Block** | |
| The shared notebook everyone agreed to keep | **Channel** | `wrt-channel` |

Two things people often get wrong:

- **Signing isn't writing.** When a peer endorses, it only *tries out* the request and signs the result. Nothing is written until the block comes back in step 4.
- **The messenger doesn't judge.** The orderer just puts things in order. The checking is done by each peer, independently. That's why no single computer has to be trusted.

## 4. ID cards: how a clerk knows who you are

Clerks only accept signatures from real clerks, and requests from real people. So everyone carries an **ID card**: a digital certificate.

**Each org has its own ID card office**, called a **CA** (Certificate Authority): `ca.warehouse`, `ca.lender`, and so on. The office prints cards with a stamp only it can make.

A card says, roughly:

```
Issued by:  Warehouse ID office
Name:       frm-001-farmer
Job:        client          ← "peer", "admin" or "client"
role:       farmer          ← WRT-specific
entityId:   FRM-001         ← WRT-specific: which farmer/warehouse/bank this person acts for
```

**How does a clerk check a card?** They don't phone the ID office. Each clerk has a **reference list** for every org: "this is what a genuine Warehouse stamp looks like, and this is how to read the Job field." That reference list is called an **MSP** (Membership Service Provider).

- **CA** = the office that *prints* cards. Only needed when someone gets a new card.
- **MSP** = the *list for checking* cards. Used on every single request.

We tested this: we switched the Warehouse CA off, and the Warehouse could still do business. The clerks only need the MSP.

**One subtle point that matters later.** Every org prints its own cards. So the *Lender's* office could print a card saying "role: regulator". The card would be genuine, just issued by the wrong office. So when the WRT rulebook checks who you are, it must ask **two** things: *what's your role?* and *which org issued your card?* A regulator card only counts if the **Regulator** issued it.

**Where do farmers get cards?** Farmers don't run a clerk of their own. That would be too expensive for a farmer. The Warehouse ID office prints their cards, so they act as Warehouse-org members. Same for small banks (MFIs) via the Lender office. The spec calls this *hosted* or *Tier-2* membership.

## 5. Setting up the shared notebook (the channel)

Before anyone writes anything, the four orgs must agree on the ground rules. That agreement is written in one founding file, **`configtx.yaml`**:

- which orgs are members, and where each one's MSP (stamp list) is;
- who counts as an admin of each org;
- who the messenger is;
- how many orgs must agree to change these rules later (a majority).

A tool turns that file into **page 0 of the notebook**, called the **genesis block**. Every clerk starts from that same page 0, so they all agree on the rules from the start.

## 6. Installing the rulebook (chaincode lifecycle)

The rulebook is code. Before it can be used, **each org must formally agree to it**. Otherwise the Warehouse could install a rulebook that says "warehouse can edit receipts freely".

The four steps, which `scripts/deploy-cc.sh` runs:

1. **Package**: zip up the code.
2. **Install**: give a copy to each org's clerk.
3. **Approve**: each org's admin says "we agree to *this exact code* with *this exact 3-of-4 rule*".
4. **Commit**: once a majority approved the same thing, the rulebook goes live.

## 7. What we've proved so far

**Milestone 1, the notebook works:**
- each of the four orgs wrote an entry with 3 signatures → accepted;
- each org read all entries from its *own* clerk → identical copies;
- the Warehouse tried to write with **only its own signature** → the entry went into page 10 but was **marked invalid** by every clerk, and the value didn't change.

That last one is the heart of WRT's claim: *no single party can rewrite the record, and attempts leave a trace.*

**Milestone 2, ID cards carry WRT roles:**
- we printed cards for 12 people (2 warehouse operators, 4 farmers, 2 bank officers, 3 inspectors, 1 regulator), each with a `role` and `entityId`;
- the rulebook could read those from each card, which is what the real chaincode needs to decide "is this person allowed to do this?";
- the cards were also saved into a **wallet** (`backend/wallet/`), so the backend can act on behalf of each person.

---

# Part 2: See it

Run these from `network/` and look at the output. Each one matches a section above.

```bash
# Everything that's running: 4 clerks (peer0.*), their notebooks' front page (couchdb.*),
# the messenger (orderer), and 5 ID offices (ca.*).
docker ps --format 'table {{.Names}}\t{{.Status}}'

# §7: replay the milestone tests.
./network.sh testHello
./network.sh testIdentities

# §4: read a farmer's ID card. Look for "wrt.role" and "wrt.entityId".
openssl x509 -in ../backend/wallet/frm-001-farmer/cert.pem -noout -text | grep wrt

# §4: ask the rulebook "who am I?" as different people.
source scripts/env.sh
set_org warehouse frm-001-farmer
peer chaincode query -C wrt-channel -n hello -c '{"function":"WhoAmI","Args":[]}'
set_org lender lnd-bank-01-officer
peer chaincode query -C wrt-channel -n hello -c '{"function":"WhoAmI","Args":[]}'

# §2: open one clerk's "front page" in a browser (login admin / adminpw),
# then open the database wrt-channel_hello:
#   Warehouse http://localhost:5984/_utils   Lender http://localhost:6984/_utils
#   Inspector http://localhost:7984/_utils   Regulator http://localhost:8984/_utils
# All four show the same keys, stored separately.

# §2: stop two clerks. Writes now fail (can't get 3 signatures). Reads still work.
docker stop peer0.inspector.wrt.local peer0.regulator.wrt.local
./network.sh testHello          # step 1 fails
docker start peer0.inspector.wrt.local peer0.regulator.wrt.local
```

Starting from nothing, the whole network is built with:

```bash
./network.sh up                  # start ID offices, print cards for clerks + admins, start clerks/messenger
./network.sh createChannel       # write page 0 from configtx.yaml, every clerk joins
./network.sh deployCC            # install + approve + commit the hello rulebook
./network.sh registerIdentities  # print the 12 WRT ID cards, fill backend/wallet
./network.sh down                # throw everything away
```

---

# Part 3: Reference

## Files

| File | Story term | What it does |
|---|---|---|
| `network.sh` | | The one command you run. Calls the scripts below. |
| `compose/compose-ca.yaml` | ID offices | Starts the 5 CAs (4 orgs + the orderer's org). |
| `compose/compose-net.yaml` | clerks, messenger | Starts the orderer, 4 peers and 4 CouchDBs. |
| `scripts/enroll.sh` | printing cards for staff | Cards for each peer, each org admin, and a test user. Also builds each org's MSP folder. |
| `configtx.yaml` | founding agreement | Members, admin rules, orderer, majority rules. Becomes block 0. |
| `scripts/channel.sh` | page 0 | Builds block 0; the orderer and all 4 peers join `wrt-channel`. |
| `scripts/deploy-cc.sh` | installing the rulebook | Package → install ×4 → approve ×4 → commit, with the 3-of-4 rule. |
| `chaincode/hello/` | a practice rulebook | `Put`, `Get`, `WhoAmI`. Replaced by the real WRT chaincode in milestone 3. |
| `identities.conf` | list of people to print cards for | The 12 seed identities: entityId, role, issuing org. |
| `scripts/register-identities.sh` | printing WRT cards | Registers + enrolls each identity with `wrt.role`/`wrt.entityId`; writes `backend/wallet/`. |
| `scripts/test-hello.sh` | | Milestone 1 check. |
| `scripts/test-identities.sh` | | Milestone 2 check. |
| `scripts/env.sh` | | Helper: `set_org <org> [identity]` makes your terminal act as that person. |
| `scripts/install-binaries.sh` | | Downloads the Fabric command-line tools into `.fabric/`. |

Generated and git-ignored: `organizations/` (all cards and keys), `channel-artifacts/` (block 0, chaincode packages), `.fabric/` (tools), `../backend/wallet/`.

## Details worth knowing later

- **`config.yaml` vs `configtx.yaml`.** Different files. `config.yaml` sits inside each MSP folder and says how to read the "Job" field on a card (`OU=peer` means peer, and so on; Fabric calls this **NodeOUs**). `configtx.yaml` is the founding agreement. When block 0 is made, each org's `config.yaml` rules are copied into it.
- **`:ecert`.** When registering a card, `wrt.role=farmer:ecert` means "print this on the card". Without `:ecert`, the office remembers it but doesn't print it, so the rulebook sees `null`.
- **Anchor peers** (in `configtx.yaml`) let clerks from different orgs find each other directly. Needed in milestone 3 for private farmer data.
- **Fetching a block from the orderer vs a peer.** Only a peer's copy says which transactions were valid. The orderer never judges.
- **Key history only shows valid writes.** To show rejected attempts (scenario S6), the app must read blocks.
- **Wallet format**: `backend/wallet/index.json` lists each identity (`label`, `mspId`, `role`, `entityId`) and each org's peer address. `<label>/cert.pem` and `<label>/key.pem` are the card and its private key.
- **Changing chaincode later**: `./network.sh deployCC -n hello -p chaincode/hello -v 1.1 -s 2`. The sequence number must go up by exactly 1.

## Ports

| Org | Peer | CA | CouchDB (browser) |
|---|---|---|---|
| Warehouse | 7051 | 7054 | 5984 |
| Lender | 8051 | 8054 | 6984 |
| Inspector | 9051 | 9054 | 7984 |
| Regulator | 10051 | 10054 | 8984 |
| Orderer | 7050 (admin 7053) | 11054 | none |

## When something breaks

| You see | Usually means |
|---|---|
| `ENDORSEMENT_POLICY_FAILURE` | fewer than 3 orgs signed, or the card's Job field wasn't recognised |
| `creator org unknown` / signature errors | your terminal mixes one org's name with another org's card. Use `set_org` |
| an invoke hangs right after installing chaincode | the chaincode container can't reach its peer. Check `docker logs dev-peer0…` |
| `chaincode definition not agreed to by this org` | the orgs approved slightly different settings |
| a peer stops right after starting | old data with new cards. Run `./network.sh down`, then build again |
| "connection refused" warnings about CouchDB at start | harmless; the peer started a second before its database |

## Glossary

| Term | Plain meaning |
|---|---|
| Org | One of the four parties. |
| Peer | An org's computer that keeps the ledger and checks/signs requests. |
| Ledger / block | The full history / one page of it. |
| World state | Current value of everything (CouchDB). |
| Chaincode | The rulebook code. |
| Endorse / endorsement policy | A peer signing a request / how many must sign (3 of 4). |
| Orderer | Puts requests in order into blocks. Doesn't check them. |
| Channel | The shared ledger (`wrt-channel`). |
| Genesis block | Block 0, made from `configtx.yaml`. |
| CA | Office that issues ID cards (certificates). |
| MSP | The list used to check an org's cards and read their roles. |
| Certificate / attribute | ID card / an extra field on it (`wrt.role`, `wrt.entityId`). |
| Wallet | Folder of cards and keys the backend uses to act as people. |
