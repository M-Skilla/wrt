import type { Context } from 'fabric-contract-api';
import type { PolicyDurations, PolicyParams } from '../shared/types';
import { policyKey } from './keys';
import { getAsset } from './state';

export async function getPolicy(ctx: Context): Promise<PolicyParams> {
  return getAsset<PolicyParams>(ctx, policyKey(ctx), 'policy parameters (run InitLedger)');
}

/** The durations in force: demo values when demoMode is on (spec §4.5). */
export function durations(policy: PolicyParams): PolicyDurations {
  return policy.demoMode ? policy.demoDurations : policy.durations;
}
