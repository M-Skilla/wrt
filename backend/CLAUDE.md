# backend/: hands-on learning area

Marko is learning how an app talks to Fabric through the Gateway SDK. Use the **Learning** output style here (`/output-style learning`). If it isn't active, remind him once at the start of the session.

## Who writes what

### Claude writes (routine)

- Fastify setup, config loading, route files, request/response schemas, CORS, logging.
- Evidence upload handling: storing files under `backend/uploads/` and computing their sha256.
- Endpoints that pass straight through to chaincode, with their request validation.
- The mock-free integration test scripts for scenarios S1–S7, once the core is working.

### Marko writes (leave `TODO(human)`)

1. **Gateway connection.** Load an identity from the wallet, connect to the right org's peer, and pool connections per identity.
2. **Demo identity mapping.** Turn the demo session header into a wallet identity, and reject unknown identities.
3. **Submit vs evaluate.** Decide which endpoints submit a transaction and which only evaluate (query), and be able to explain why for each.
4. **Error mapping.** Translate chaincode and endorsement errors into clear 4xx responses. Handle at least: illegal transition, not authorised, LTV exceeded, and endorsement policy failure.
5. **Keeper job.** The timed loop that calls `EvaluateLoan` and `EvaluateDisbursement`, behind `KEEPER_ENABLED`.
6. **Event stream.** Listen for chaincode events and forward them to the UI over Server-Sent Events, including reconnecting after a dropped connection.

## How to run each TODO(human)

1. Before the TODO, explain in 3–5 lines:
   - what happens between this code and the peers;
   - for a submit: endorse → order → commit, and where it can fail.
2. Give Marko a quick way to check his work: a test, a `curl` command, or a scenario script step.
3. **Never fill in a `TODO(human)` yourself** unless Marko says explicitly he's skipping it. Give hints first, smaller hints second, and code only if he asks outright.
4. After he writes it, run the check, review the code, point out problems and let him fix them.

## Things to make visible while learning

- Log the tx ID and the endorsing orgs for every submit, so Marko can match API calls to ledger history.
- Return chaincode error messages unchanged. The UI shows them verbatim.
- Suggest stopping one peer container mid-demo so he can see what fails and why.
