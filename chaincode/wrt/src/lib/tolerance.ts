import type { CropReading, PolicyParams } from '../shared/types';

export interface ToleranceResult {
  withinTolerance: boolean;
  /** Human-readable reasons, empty when within tolerance. */
  failures: string[];
  /** Signed weight gap in bp of declared weight, e.g. -800 = observed 8% lighter. */
  weightGapBp: number;
  /** Signed moisture gap in bp of absolute moisture (100 = 1 percentage point). */
  moistureGapBp: number;
}

/**
 * Minting check (spec §5.1 step 4): declared vs observed, all in integers.
 * Weight gap is relative to the declared weight; the comparison is done by
 * cross-multiplying so no division (and no rounding) decides the outcome.
 */
export function checkTolerance(
  declared: CropReading,
  observed: CropReading,
  sealVerified: boolean,
  policy: Pick<PolicyParams, 'weightToleranceBp' | 'moistureToleranceBp' | 'gradeMustMatch'>,
): ToleranceResult {
  const failures: string[] = [];
  const weightDiff = observed.netKg - declared.netKg;
  const weightGapBp = declared.netKg > 0 ? Math.trunc((weightDiff * 10_000) / declared.netKg) : 0;
  const moistureGapBp = observed.moistureBp - declared.moistureBp;

  if (Math.abs(weightDiff) * 10_000 > policy.weightToleranceBp * declared.netKg) {
    failures.push(`weight ${declared.netKg} kg declared vs ${observed.netKg} kg observed exceeds ±${policy.weightToleranceBp} bp`);
  }
  if (Math.abs(moistureGapBp) > policy.moistureToleranceBp) {
    failures.push(`moisture ${declared.moistureBp} bp declared vs ${observed.moistureBp} bp observed exceeds ±${policy.moistureToleranceBp} bp`);
  }
  if (policy.gradeMustMatch && declared.grade !== observed.grade) {
    failures.push(`grade ${declared.grade} declared vs ${observed.grade} observed`);
  }
  if (!sealVerified) {
    failures.push('sample seal not verified');
  }
  return { withinTolerance: failures.length === 0, failures, weightGapBp, moistureGapBp };
}
