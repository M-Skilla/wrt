# chaincode/: hands-on learning area

Marko is learning Hyperledger Fabric chaincode by writing the core logic himself. Use the **Learning** output style here (`/output-style learning`). If it isn't active, remind him once at the start of the session.

## Who writes what

### Claude writes (routine)

- Project scaffolding, `package.json`, `tsconfig`, lint and test setup.
- Model interfaces (from `shared/types.ts`), composite-key helpers, deterministic JSON serialisation.
- Contract class shells: decorators, signatures, input parsing and validation.
- Read-only query functions, CouchDB index files, chaincode event plumbing.
- Test harness and stubs (mock context, mock identity with MSP and cert attributes).

### Marko writes (leave `TODO(human)`)

These are the design decisions he must be able to defend:

1. **State machine.** The allowed-transition table in `lib/state-machine.ts`, and the function that rejects illegal moves.
2. **Access control.** The logic of `requireRole` / `requireEntity`: checking MSP ID plus the `wrt.role` and `wrt.entityId` attributes.
3. **Inspector assignment.** The deterministic draw from the tx ID, with conflict exclusion.
4. **Minting tolerance check** in `SubmitAttestation`: comparing declared and observed values, then either minting the receipt or auto-opening `MINT_MISMATCH`.
5. **Disbursement conditions** in `FundEscrow` / `EvaluateDisbursement`, and the automatic release.
6. **Repayment and lien release** in `Repay`.
7. **`EvaluateLoan`:** maturity, grace periods and the LTV thresholds that trigger a margin call or default.
8. **`ResolveDispute` effects:** what each outcome does to the receipt, loan and warehouse.
9. **Liquidation waterfall** in `ExecuteLiquidation`.

Everything else is routine and Claude writes it.

## How to run each TODO(human)

1. **Before the TODO, explain in 3–5 lines:**
   - what the function reads and writes in world state;
   - which identity may call it;
   - which spec section it implements.
2. **Write the unit tests first**, including the failure cases, so Marko knows when he's done. Then leave the `TODO(human)` and stop.
3. **Never fill in a `TODO(human)` yourself**, even if asked to "just finish it", unless Marko says explicitly that he's skipping that one. If he's stuck, give a hint, then a smaller hint. Show code only if he asks for it outright.
4. **After he writes it:**
   - Run the tests.
   - Review the code for correctness and determinism.
   - Point out problems and let him fix them. Don't silently rewrite his code.

## Determinism checklist

Apply this checklist on every review:

- No `Date.now()`, no `Math.random()`, no external calls.
- Time comes from `ctx.stub.getTxTimestamp()`.
- No floats. Integer TZS and basis points only.
- No iteration order over unordered maps or objects that affects writes.
- State is serialised with the deterministic JSON helper.
- Every status change goes through the state machine.

## Encourage breaking things

After each contract works, suggest one deliberate failure for Marko to try and observe, for example:

- an illegal transition;
- the wrong role;
- a float amount;
- a transaction endorsed by a single org.

Have him explain the error before moving on.
