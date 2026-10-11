import type { Context } from 'fabric-contract-api';
import { MSP_IDS, ROLES, ROLE_MSP, type MspId, type PartyRef, type Role } from '../shared/types';
import { WrtError } from './errors';

/** Who invoked the transaction, read from their certificate (spec §3.4). */
export interface Caller {
  mspId: string;
  role: Role | null;
  entityId: string | null;
}

/** A caller that passed requireRole: a known role, issued by the right org, acting for an entity. */
export interface AuthorisedCaller {
  mspId: MspId;
  role: Role;
  entityId: string;
}

export function getCaller(ctx: Context): Caller {
  const id = ctx.clientIdentity;
  const role = id.getAttributeValue('wrt.role');
  return {
    mspId: id.getMSPID(),
    role: role !== null && (ROLES as readonly string[]).includes(role) ? (role as Role) : null,
    entityId: id.getAttributeValue('wrt.entityId'),
  };
}

function describe(caller: Caller): string {
  return `${caller.role ?? 'no role'}${caller.entityId ? ` ${caller.entityId}` : ''} @ ${caller.mspId}`;
}

/**
 * The caller must be in `msp` AND hold one of `roles`. The role attribute is only
 * as trustworthy as the CA that issued it, so a role only counts when it was
 * issued by the org that owns that role (ROLE_MSP): a Lender-CA cert claiming
 * regulator_officer is rejected.
 */
export function requireRole(ctx: Context, msp: MspId, roles: readonly Role[]): AuthorisedCaller {
  const caller = getCaller(ctx);
  const ok =
    caller.mspId === msp &&
    caller.role !== null &&
    roles.includes(caller.role) &&
    ROLE_MSP[caller.role] === msp &&
    caller.entityId !== null &&
    caller.entityId !== '';
  if (!ok) {
    throw new WrtError('NOT_AUTHORISED', `requires ${roles.join(' or ')} @ ${msp}; caller is ${describe(caller)}`);
  }
  return caller as AuthorisedCaller;
}

/** Like requireRole, but accepts any of several roles, each checked against its own org. */
export function requireAnyRole(ctx: Context, roles: readonly Role[]): AuthorisedCaller {
  const caller = getCaller(ctx);
  if (caller.role !== null && roles.includes(caller.role)) {
    return requireRole(ctx, ROLE_MSP[caller.role], [caller.role]);
  }
  throw new WrtError('NOT_AUTHORISED', `requires ${roles.join(' or ')}; caller is ${describe(caller)}`);
}

/** Mutations are scoped to the caller's own entity: WH-001's operator cannot act for WH-002. */
export function requireEntity(ctx: Context, entityId: string): void {
  const caller = getCaller(ctx);
  if (caller.entityId !== entityId) {
    throw new WrtError('NOT_AUTHORISED', `acts for ${caller.entityId ?? 'no entity'}, not ${entityId}`);
  }
}

/** Permissionless functions (keeper checks): any member of one of the four orgs. */
export function requireMember(ctx: Context): Caller {
  const caller = getCaller(ctx);
  if (!(MSP_IDS as readonly string[]).includes(caller.mspId)) {
    throw new WrtError('NOT_AUTHORISED', `unknown org ${caller.mspId}`);
  }
  return caller;
}

export function partyOf(caller: AuthorisedCaller): PartyRef {
  return { role: caller.role, entityId: caller.entityId };
}
