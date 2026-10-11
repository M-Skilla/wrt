# WRT: UI Design Handoff

**For the coding agent.** This document and the reference screens in `screens/` define the WRT web UI. Build the React + Vite + TypeScript + Tailwind frontend described in `WRT_IMPLEMENTATION_SPEC.md` §9 so that it matches these screens.

> **This supersedes spec §9.2 (Visual design).**
> - The palette in §9.2 is replaced by the tokens below.
> - The UI font is **Plus Jakarta Sans**, not DM Sans.
> - Geist Mono stays the monospace font.
>
> Everything else in §9.1 (structure, role views, detail pages) still applies.

---

## 1. How to use the reference screens

- `screens/*.dc.html` are static HTML mockups, one per screen. Open any of them in a browser to see the layout.
  - They reference a `support.js` from the design tool. That file is not included, and the pages render fine without it.
  - The one exception is `InForm.dc.html`: its live tolerance check uses `{{…}}` template holes, which show as raw text without the runtime. Section 5 describes the behaviour.
- **Treat the screens as a visual spec, not as source code.**
  - Re-implement them as React components using the tokens and components below.
  - Do not copy the inline styles.
  - Do not ship the `.dc.html` files.
- **The sample data is consistent across screens** and matches the seed scenarios in spec §8: DSP-0017 is S3, DSP-0018 is S2, and the rejected tx in the explorer is S6.
  - The real app must read every value from the API.
  - Use the sample values for Storybook stories, fixtures and the seed script.
- **The screens are a fixed snapshot.** As of this handoff, "today" in the sample data is 11 Oct 2026.

---

## 2. Design tokens

Put these in `frontend/src/theme/tokens.ts` and in `tailwind.config.ts` (under `theme.extend`).

### Colour

| Token | Hex | Use |
|---|---|---|
| `ink` | `#0B1726` | Text, primary buttons, header, sidebar, emphasis panels |
| `ink-2` | `#13253A` / `#16304A` | Sidebar hover / active item |
| `ink-line` | `#1E3349` / `#23394F` | Borders on dark surfaces |
| `canvas` | `#F2F6FA` | Page background |
| `surface` | `#FFFFFF` | Cards, tables, dialogs |
| `surface-2` | `#F7FAFC` | Table headers, card footers, sub-panels |
| `line` | `#D9E3EC` | Card and table borders |
| `line-soft` | `#EAF0F5` | Row dividers |
| `input-line` | `#C9D6E2` | Input and secondary-button borders |
| `muted` | `#4E6275` | Secondary text (≥4.5:1 on white) |
| `muted-dark` | `#8FA6BC` / `#B8C7D6` | Secondary text on `ink` |
| `cyan` | `#00BDFF` | **Brand.** Live / healthy, "issued", streaming dots, progress fills |
| `yellow` | `#FBD116` | **Brand.** The main action on each screen, attention states, active-nav marker, logo |
| `steel` | `#56A7D2` | **Brand.** Pledged / locked, secondary data series |
| `link` | `#00739F` | Link text (cyan darkened to pass contrast) |
| `success` | `#12A150` | Success dot only |
| `danger` | `#E5484D` | Danger dot, rejection borders |
| `danger-strong` | `#C8282E` | Destructive buttons (e.g. Liquidate) |

Tints for chip backgrounds:

| Tint | Hex |
|---|---|
| cyan | `#E0F6FF` |
| steel | `#E3F0F8` |
| yellow | `#FEF6CC` (border `#F3DD6B`) |
| red | `#FDE7E8` (border `#F4B4B6`) |
| green | `#E2F5EA` |
| neutral | `#EEF3F8` (dot `#8A9BAD`) |

**Colour rules:**
- **Never put white text on cyan or yellow.** Use `ink` on both.
- No brown, cream, beige or earthy tones.
- No gradients.
- The one exception to "no gradients" is the hatched "projected LTV" segment on the portfolio chart, which is a repeating stripe.

### Typography

Load both fonts from Google Fonts:

```
Plus Jakarta Sans 400/500/600/700/800 · Geist Mono 400/500/600
```

| Role | Font | Size / weight |
|---|---|---|
| Page title | Plus Jakarta Sans | 28px / 800, letter-spacing −0.02em |
| ID used as page title (receipt, loan, dispute) | Geist Mono | 30px / 600 |
| Section title | Plus Jakarta Sans | 15px / 700 |
| Body | Plus Jakarta Sans | 14px / 400–500 |
| Table text | Plus Jakarta Sans | 13px |
| Eyebrow label | Plus Jakarta Sans | 11px / 700, uppercase, letter-spacing 0.08em, `muted` |
| Stat figure | Geist Mono | 24–28px / 600 |
| IDs, hashes, amounts, dates, block numbers | Geist Mono | Inherit size |

**Rules:**
- No serif fonts anywhere.
- Every identifier, tx hash, amount, kg value, percentage and date is set in Geist Mono.
- Numbers in table columns are right-aligned.

### Spacing, radius, elevation

| Property | Values |
|---|---|
| Spacing scale (4px grid) | 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32 |
| Page padding | 28px top, 32px sides |
| Gap between sections | 20px |
| Radius | 3–4px for chips and small badges; 6px for cards, inputs and buttons; 8px for dialogs |
| Borders | 1px hairlines everywhere |
| Shadows | Dialogs only: `0 1px 2px rgba(11,23,38,.08), 0 12px 32px rgba(11,23,38,.18)` |

---

## 3. Components

Build these once in `frontend/src/components/` and reuse them everywhere.

| Component | Spec | Seen in |
|---|---|---|
| **AppShell** | `ink` header (logo, ledger strip, identity) above a row of sidebar + main. Uses `flex-wrap`, so the sidebar stacks above the content on phones. | All role screens |
| **LedgerStrip** | Mono, 12px, `#8FA6BC`. Shows channel, block height (live), "policy 3 of 4", and a cyan dot per peer (WH LN IN RG). A dot greys out if that peer is unreachable. | Header |
| **IdentityBar** | MSP chip (mono, cyan text, `#2A4058` border) · role · entityId (mono) · "Switch identity" link in yellow. | Header right |
| **SideNav** | Role eyebrow, items 40px tall. The active item has `ink-2` bg and a 3px yellow inset bar on the left. Optional mono count on the right. The footer shows entity name and hosting tier. | All role screens |
| **StatusChip** | 22px tall: dot + label, tinted background. **Always text + colour, never colour alone.** Mapping in §4. | Everywhere |
| **Button** | Min 40px tall (44px on forms and touch). Variants: `primary` (ink), `accent` (yellow, ink text; one per screen, for the main action), `secondary` (white, `input-line` border), `danger` (`danger-strong`). Disabled = 45% opacity plus a `title` tooltip giving the reason. | |
| **StatTile** | Card with eyebrow label, mono figure, one muted sub-line. Variants: `inverse` (ink bg), `attention` (yellow bg). Can be a link. | Overviews |
| **DataTable** | 11px uppercase header on `surface-2`, 12×14px cells, `line-soft` row dividers, horizontal scroll inside a box on narrow screens. Supports group-header rows (see My loans). | All lists |
| **FilterTabs** | Underline tabs, with a count badge that turns yellow when the tab is active. | Deposits, Registry, Prices & policy |
| **FilterPills** | Rounded pills with counts. The active pill is filled `ink`. | Receipts in custody |
| **LtvGauge** | Bar with markers at `maxLtvBp` (steel), `marginCallLtvBp` (ink) and `liquidationLtvBp` (red), with mono labels under each marker. **Read the thresholds from PolicyParams; don't hard-code 60/75/85.** | Loan detail, Receipt detail, Portfolio |
| **ConditionChecklist** | Rows of icon + condition + mono evidence. Pass = green check on green tint; warn = ink "!" on yellow tint; fail = red. Comes from `disbursementConditions`. | Loan detail, Fund escrow modal |
| **LifecycleStrip** | Horizontal steps. The current step is filled `ink` with a yellow eyebrow; future steps are muted; a final grey cell lists the branch states. Wraps on narrow screens. | Receipt detail |
| **LedgerHistory** | Version badge (v1…vN; the latest is ink/yellow), function name, org · invoker · change, then a mono line: time · tx (shortened) · endorsing orgs. Data from `GetHistory`. | Receipt detail, Explorer |
| **EndorsementBadges** | Four 28×22 mono badges (WH LN IN RG): filled ink if that org endorsed, outlined grey if not. | Explorer |
| **EscrowLedger** | DataTable of escrow entries: entry-type chip, signed mono amount, paymentRef, tx. Shows the balance in the header. | Loan detail |
| **ActivityFeed** | Fed by SSE `/events`. Rows are time · (org) · event. Header shows a cyan "streaming" dot. | Overviews |
| **Dialog** | 8px radius, header with title, mono subtitle (the object ID) and a 36px close button with `aria-label="Close"`. Body, then a footer on `surface-2` with a hint on the left and actions on the right. Caption above each dialog in the mockup = the chaincode function it signs. | `ModalsA`, `ModalsB` |
| **Callout** | Inline banner. `info` = steel tint, `warning` = yellow tint, `error` = red tint, `ink` = dark panel with a yellow "GATE" / "TIER 2" tag. | Many |
| **TxToast** | Ink background with a cyan dot: "Committed in block N" + short tx id. Errors use the red callout and show the chaincode error code **verbatim**. | States screen |

---

## 4. Status → chip mapping

| Domain | Status | Chip |
|---|---|---|
| Receipt | `ISSUED` | cyan |
| Receipt | `PLEDGED` | steel |
| Receipt | `UNDER_DISPUTE` | yellow, label "Under dispute" / "Frozen" |
| Receipt | `DEFAULTED`, `LIQUIDATED`, `CANCELLED` | red |
| Receipt | `REDEEMED` | green |
| Receipt legal | `PENDING_WRRB` | neutral |
| Receipt legal | `WRRB_REGISTERED` | green |
| Loan | `OFFERED`, `ACCEPTED`, `CANCELLED` | neutral |
| Loan | `ACTIVE` | cyan |
| Loan | `MARGIN_CALL` | yellow |
| Loan | `REPAID` | green |
| Loan | `DEFAULTED`, `LIQUIDATED` | red |
| Loan | Clock paused by a dispute | yellow, "Paused · DSP-xxxx" |
| Deposit | `PENDING_ATTESTATION` | neutral |
| Deposit | `ATTESTED` | cyan |
| Deposit | `MISMATCH_DISPUTED`, `REJECTED` | red |
| Dispute | `OPEN` | red |
| Dispute | `REINSPECTION_ASSIGNED` | steel |
| Dispute | `REINSPECTED` | yellow |
| Dispute | `RESOLVED` | green |
| Entity | `ACTIVE` | green |
| Entity | `SUSPENDED`, `REVOKED` | red |

---

## 5. Screens, routes and behaviour

| # | Screen file | Route | Role (identity shown) | Notes |
|---|---|---|---|---|
| 01 | `Main.dc.html` | `/` | none | Demo identity picker, grouped by MSP; links to each role's home. Yellow "Demo identity — not real authentication" notice is required. |
| 02 | `ReceiptDetail.dc.html` | `/receipts/:id` | any (shown as lender) | Actions depend on role and status. Lender: request QC, raise dispute, open loan. Farmer: withdraw if ISSUED. Regulator: record WRRB if pending. |
| 03 | `LoanDetail.dc.html` | `/loans/:id` | lender / farmer / regulator | Liquidate is disabled unless the loan is DEFAULTED. Maturity tile counts down; pausedSecs is shown as "+N d". |
| 04 | `DisputeDetail.dc.html` | `/disputes/:id` | any (shown as regulator) | The ruling form shows only for regulator_officer and status REINSPECTED. Others see the same page read-only. |
| 05 | `States.dc.html` | n/a | n/a | Reference for empty, chaincode-error, 404, toast, frozen-banner and loading-skeleton states. |
| 06 | `WhOverview.dc.html` | `/warehouse` | warehouse_operator | |
| 07 | `WhFarmers.dc.html` | `/warehouse/farmers` | warehouse_operator | Phone numbers masked; PII shown only from `GetFarmerPII`. |
| 08 | `WhRecordDeposit.dc.html` | `/warehouse/deposits/new` | warehouse_operator | Upload → sha256 computed client-side and shown before submit. |
| 09 | `WhDeposits.dc.html` | `/warehouse/deposits` | warehouse_operator | Tabs by deposit status. |
| 10 | `WhReceipts.dc.html` | `/warehouse/receipts` | warehouse_operator | |
| 11 | `WhWithdrawals.dc.html` | `/warehouse/withdrawals` | warehouse_operator | Gate-pass no. is a required field before ConfirmRelease. |
| 12 | `FmReceipts.dc.html` | `/farmer` | farmer | Plain-language copy; yellow banner when an offer is pending. |
| 13 | `FmLoans.dc.html` | `/farmer/loans` | farmer | Offer card with Accept / Decline; repayment progress bar. |
| 14 | `LnPortfolio.dc.html` | `/lender` | lender_officer | "TIER 2" banner only for hosted lenders (MFI / SACCO). |
| 15 | `LnCollateral.dc.html` | `/lender/collateral` | lender_officer | Lists only receipts that pass every OfferLoan precondition. |
| 16 | `LnLoans.dc.html` | `/lender/loans` | lender_officer | Grouped: Needs action / Active / Offered / Closed. |
| 17 | `LnDisputes.dc.html` | `/lender/disputes` | lender_officer | |
| 18 | `InQueue.dc.html` | `/inspector` | inspector | Farmer identity never shown to inspectors. |
| 19 | `InForm.dc.html` | `/inspector/inspect/:subjectId` | inspector | Behaviour described below. |
| 20 | `InHistory.dc.html` | `/inspector/history` | inspector | |
| 21 | `RgOverview.dc.html` | `/regulator` | regulator_officer | Peer-health strip; yellow tile counts rejected tx this week. |
| 22 | `RgRegistry.dc.html` | `/regulator/registry` | regulator_officer | Tabs: Warehouses / Lenders / Inspectors / Farmers. |
| 23 | `RgWrrb.dc.html` | `/regulator/wrrb` | regulator_officer | Inline WRRB-number input per row. |
| 24 | `RgDisputes.dc.html` | `/regulator/disputes` | regulator_officer | |
| 25 | `RgSettings.dc.html` | `/regulator/settings` | regulator_officer | Tabs: Reference prices / Policy parameters. Demo-mode toggle. |
| 26 | `RgExplorer.dc.html` | `/regulator/explorer` | regulator_officer | Search by key, tx id or block. Shows rejected attempts (S6) above committed history. |
| — | `ModalsA.dc.html` | dialogs | various | Register farmer, Register warehouse, Make offer, Accept offer, Fund escrow, Repay. |
| — | `ModalsB.dc.html` | dialogs | various | Request QC, Raise dispute, Assign re-inspection, Confirm ruling, Record WRRB number, Execute liquidation. |

### Inspection form behaviour (19)

- **Mode tabs:** Attestation / Quality check / Re-inspection. Same layout in each mode; the subject and the submit call change.
- **Live tolerance check:** as the inspector types, compare each observed value with the declared value using the PolicyParams tolerances:
  - weight gap % = (observed − declared) / declared;
  - moisture gap in percentage points;
  - grade must match exactly;
  - the seal checkbox must be ticked.
- **Per-row chips:** green "match / +x.xx%" or red.
- **Right-hand panel:**
  - Everything passes → ink panel saying "A receipt will be minted with your readings", with the resulting values.
  - Anything fails → red panel saying "No receipt. A MINT_MISMATCH dispute opens automatically".
  - The real check runs in chaincode; this panel only previews it.
- **Re-inspection mode:** do **not** show the original reading until after submit.

### Modal behaviour

- **Make offer:** recompute LTV live and block submit above `maxLtvBp`.
- **Fund escrow:** preview `disbursementConditions` before submit.
- **Repay:** quick-amount buttons, including "Pay all".
- **Assign re-inspection:** show the draw pool with the original inspector struck through. The regulator confirms the draw but never chooses the person.
- **Liquidate:** show the waterfall (lender first, then surplus to farmer) and use the danger button.

---

## 6. Responsive and accessibility

- **Responsive:**
  - Every screen is fluid. Max content width is unconstrained on desktop.
  - At under ~800px the sidebar stacks above the content, and stat tiles wrap.
  - Wide tables scroll horizontally inside their card.
  - Test at 390px.
- **Accessibility:**
  - Use real `<button>`, `<a>`, `<label>` + `<input>`.
  - Give icon-only buttons an `aria-label`.
  - Tabs use `role="tablist"` / `role="tab"` / `aria-selected`.
  - Status is always text + colour.
  - Text contrast must be at least WCAG AA.
  - Touch targets ≥ 40px (44px on forms).
- **Motion:** none required. If you add any, respect `prefers-reduced-motion`.

---

## 7. Copy conventions

- Amounts in TZS, comma-grouped, no decimals: `4,540,000`.
- Weights: `12,400 kg`. Moisture: `13.4%` (display) from `moistureBp` 1340.
- Dates: `11 Oct 2026`, or `11 Oct 09:41` within the same year in feeds.
- Tx hashes shortened to `7f3a9c…e21b`.
- Chaincode function names appear in mono where the user is about to sign: "Signs `ConfirmRelease` as WH-001".
- Prices are always labelled "illustrative reference price".
- Farmer-facing screens use plain language ("locked", "unlocks by itself") instead of ledger terms.
