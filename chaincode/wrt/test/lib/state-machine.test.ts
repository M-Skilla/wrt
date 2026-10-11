/**
 * Tests for TODO(human) #1: the state machine (spec §6, "every illegal transition throws").
 *
 * Section 1 walks the workflows in spec §5: every step must be allowed.
 * Section 2 lists moves the spec rules out: every one must throw.
 * Section 3 checks the table's overall shape.
 * Section 4 is the milestone-3 acceptance check: every pair not in your table throws.
 */
import { WrtError } from '../../src/lib/errors';
import { TRANSITIONS, assertTransition, type Domain, type StatusByDomain } from '../../src/lib/state-machine';

type Step<D extends Domain> = [from: StatusByDomain[D], to: StatusByDomain[D]];

function allowed<D extends Domain>(domain: D, steps: Step<D>[]): void {
  for (const [from, to] of steps) {
    expect(() => assertTransition(domain, from, to)).not.toThrow();
  }
}

function forbidden<D extends Domain>(domain: D, from: StatusByDomain[D], to: StatusByDomain[D]): void {
  expect(() => assertTransition(domain, from, to)).toThrow(/^ILLEGAL_TRANSITION: /);
}

// ---------------------------------------------------------------------------
// 1. Workflows from the spec: each step must be allowed
// ---------------------------------------------------------------------------
describe('allowed: workflows from spec §5', () => {
  it('deposit: attestation within tolerance mints (§5.1 step 4)', () => {
    allowed('deposit', [['PENDING_ATTESTATION', 'ATTESTED']]);
  });

  it('deposit: mismatch auto-disputes, then the ruling mints or rejects (§5.1 step 4, §5.6 "For MINT_MISMATCH")', () => {
    allowed('deposit', [
      ['PENDING_ATTESTATION', 'MISMATCH_DISPUTED'],
      ['MISMATCH_DISPUTED', 'ATTESTED'], // CONFIRMED or CORRECTED mints
    ]);
    allowed('deposit', [['MISMATCH_DISPUTED', 'REJECTED']]); // FRAUDULENT
  });

  it('receipt: pledge, repay, withdraw (S1: §5.2 step 2, §5.3)', () => {
    allowed('receipt', [
      ['ISSUED', 'PLEDGED'], // AcceptLoan places the lien
      ['PLEDGED', 'ISSUED'], // full repayment lifts the lien
      ['ISSUED', 'REDEEMED'], // ConfirmRelease
    ]);
  });

  it('receipt: a dispute freezes it, and resolution restores or cancels it (§5.6)', () => {
    allowed('receipt', [
      ['ISSUED', 'UNDER_DISPUTE'],
      ['UNDER_DISPUTE', 'ISSUED'],
      ['PLEDGED', 'UNDER_DISPUTE'],
      ['UNDER_DISPUTE', 'PLEDGED'],
      ['UNDER_DISPUTE', 'CANCELLED'], // FRAUDULENT
    ]);
  });

  it('receipt: default then liquidation (S5: §5.7)', () => {
    allowed('receipt', [
      ['PLEDGED', 'DEFAULTED'],
      ['DEFAULTED', 'LIQUIDATED'],
    ]);
  });

  it('receiptLegal: WRRB registration (§5.1 step 5)', () => {
    allowed('receiptLegal', [['PENDING_WRRB', 'WRRB_REGISTERED']]);
  });

  it('loan: happy path (S1: §5.2, §5.3)', () => {
    allowed('loan', [
      ['OFFERED', 'ACCEPTED'],
      ['ACCEPTED', 'ACTIVE'], // auto-disbursement
      ['ACTIVE', 'REPAID'],
    ]);
  });

  it('loan: offer withdrawn (CancelOffer, §6)', () => {
    allowed('loan', [['OFFERED', 'CANCELLED']]);
  });

  it('loan: margin call, cured or repaid (§5.3, §5.4)', () => {
    allowed('loan', [
      ['ACTIVE', 'MARGIN_CALL'],
      ['MARGIN_CALL', 'ACTIVE'], // partial repayment brings LTV back under marginCallLtvBp
      ['ACTIVE', 'MARGIN_CALL'],
      ['MARGIN_CALL', 'REPAID'],
    ]);
  });

  it('loan: default from active or margin call, then liquidation (§5.4, §5.5, §5.7)', () => {
    allowed('loan', [
      ['ACTIVE', 'DEFAULTED'],
      ['DEFAULTED', 'LIQUIDATED'],
    ]);
    allowed('loan', [['MARGIN_CALL', 'DEFAULTED']]);
  });

  it('dispute: re-inspection then ruling (§5.6)', () => {
    allowed('dispute', [
      ['OPEN', 'REINSPECTION_ASSIGNED'],
      ['REINSPECTION_ASSIGNED', 'REINSPECTED'],
      ['REINSPECTED', 'RESOLVED'],
    ]);
  });

  it('entity: the regulator suspends and reinstates (SetWarehouseStatus, §6)', () => {
    allowed('entity', [
      ['ACTIVE', 'SUSPENDED'],
      ['SUSPENDED', 'ACTIVE'],
    ]);
    allowed('entity', [['ACTIVE', 'REVOKED']]);
    allowed('entity', [['SUSPENDED', 'REVOKED']]);
  });
});

// ---------------------------------------------------------------------------
// 2. Moves the spec rules out: each must throw
// ---------------------------------------------------------------------------
describe('forbidden: moves the spec rules out', () => {
  it('a pledged receipt cannot be withdrawn while the lien is on it (§5.3 "only for an ISSUED receipt with no lien")', () => {
    forbidden('receipt', 'PLEDGED', 'REDEEMED');
  });

  it('a receipt with no loan cannot default or be liquidated (§5.7)', () => {
    forbidden('receipt', 'ISSUED', 'DEFAULTED');
    forbidden('receipt', 'ISSUED', 'LIQUIDATED');
    forbidden('receipt', 'PLEDGED', 'LIQUIDATED'); // default comes first
  });

  it('an attested deposit is finished: later disputes target the receipt, not the deposit (§4.6 subject.kind)', () => {
    forbidden('deposit', 'ATTESTED', 'MISMATCH_DISPUTED');
    forbidden('deposit', 'ATTESTED', 'PENDING_ATTESTATION');
  });

  it('a loan cannot skip acceptance or disbursement (§5.2)', () => {
    forbidden('loan', 'OFFERED', 'ACTIVE');
    forbidden('loan', 'ACCEPTED', 'REPAID');
    forbidden('loan', 'OFFERED', 'REPAID');
  });

  it('a defaulted loan is not cured back to active (§5.7: it goes to liquidation)', () => {
    forbidden('loan', 'DEFAULTED', 'ACTIVE');
    forbidden('loan', 'DEFAULTED', 'MARGIN_CALL');
  });

  it('a dispute cannot be ruled on before re-inspection (handoff §5: ruling form only at REINSPECTED)', () => {
    forbidden('dispute', 'OPEN', 'RESOLVED');
    forbidden('dispute', 'OPEN', 'REINSPECTED');
    forbidden('dispute', 'REINSPECTION_ASSIGNED', 'RESOLVED');
  });

  it('WRRB registration cannot be undone (§7.2)', () => {
    forbidden('receiptLegal', 'WRRB_REGISTERED', 'PENDING_WRRB');
  });

  it('a revoked entity stays revoked', () => {
    forbidden('entity', 'REVOKED', 'ACTIVE');
    forbidden('entity', 'REVOKED', 'SUSPENDED');
  });
});

// ---------------------------------------------------------------------------
// 3. Shape of the table
// ---------------------------------------------------------------------------
const INITIAL: { [D in Domain]: StatusByDomain[D] } = {
  deposit: 'PENDING_ATTESTATION',
  receipt: 'ISSUED',
  receiptLegal: 'PENDING_WRRB',
  loan: 'OFFERED',
  dispute: 'OPEN',
  entity: 'ACTIVE',
};

const TERMINAL: { [D in Domain]: StatusByDomain[D][] } = {
  deposit: ['ATTESTED', 'REJECTED'],
  receipt: ['REDEEMED', 'LIQUIDATED', 'CANCELLED'],
  receiptLegal: ['WRRB_REGISTERED'],
  loan: ['REPAID', 'LIQUIDATED', 'CANCELLED'],
  dispute: ['RESOLVED'],
  entity: ['REVOKED'],
};

const DOMAINS = Object.keys(TRANSITIONS).sort() as Domain[];

function statuses<D extends Domain>(domain: D): StatusByDomain[D][] {
  return (Object.keys(TRANSITIONS[domain]) as StatusByDomain[D][]).sort();
}

function next<D extends Domain>(domain: D, from: StatusByDomain[D]): readonly StatusByDomain[D][] {
  return (TRANSITIONS[domain] as Record<StatusByDomain[D], readonly StatusByDomain[D][]>)[from];
}

describe('table shape', () => {
  it.each(DOMAINS)('%s: terminal statuses have no way out', (domain) => {
    for (const status of TERMINAL[domain]) {
      expect(next(domain, status)).toEqual([]);
    }
  });

  it.each(DOMAINS)('%s: no status moves to itself (a no-op is never a transition)', (domain) => {
    for (const status of statuses(domain)) {
      expect(next(domain, status)).not.toContain(status);
      forbidden(domain, status, status);
    }
  });

  it.each(DOMAINS)('%s: no duplicates in any list', (domain) => {
    for (const status of statuses(domain)) {
      const list = next(domain, status);
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it.each(DOMAINS)('%s: every status is reachable from the initial status (no orphans)', (domain) => {
    const seen = new Set<string>([INITIAL[domain]]);
    const queue: StatusByDomain[typeof domain][] = [INITIAL[domain]];
    while (queue.length > 0) {
      const from = queue.shift()!;
      for (const to of next(domain, from)) {
        if (!seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
      }
    }
    expect([...seen].sort()).toEqual(statuses(domain));
  });
});

// ---------------------------------------------------------------------------
// 4. Acceptance (spec §13 milestone 3): every illegal transition is tested
// ---------------------------------------------------------------------------
describe('acceptance: every pair not in the table throws ILLEGAL_TRANSITION', () => {
  it.each(DOMAINS)('%s', (domain) => {
    let illegal = 0;
    for (const from of statuses(domain)) {
      for (const to of statuses(domain)) {
        if (next(domain, from).includes(to)) {
          expect(() => assertTransition(domain, from, to)).not.toThrow();
        } else {
          forbidden(domain, from, to);
          illegal++;
        }
      }
    }
    expect(illegal).toBeGreaterThan(0);
  });

  it('the error is a WrtError naming the domain and both statuses', () => {
    let caught: unknown;
    try {
      assertTransition('receipt', 'PLEDGED', 'REDEEMED');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WrtError);
    expect((caught as WrtError).code).toBe('ILLEGAL_TRANSITION');
    expect((caught as WrtError).message).toMatch(/receipt/);
    expect((caught as WrtError).message).toMatch(/PLEDGED/);
    expect((caught as WrtError).message).toMatch(/REDEEMED/);
  });
});
