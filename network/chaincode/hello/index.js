'use strict';

const { Contract } = require('fabric-contract-api');

// Milestone 1 only. Replaced by chaincode/wrt in milestone 3.
class HelloContract extends Contract {
  constructor() {
    super('HelloContract');
  }

  async Put(ctx, key, value) {
    await ctx.stub.putState(key, Buffer.from(value));
    return value;
  }

  async Get(ctx, key) {
    const bytes = await ctx.stub.getState(key);
    if (!bytes || bytes.length === 0) {
      throw new Error(`NOT_FOUND: ${key}`);
    }
    return bytes.toString();
  }

  // Shows who called: MSP plus the wrt.* cert attributes (filled in milestone 2).
  async WhoAmI(ctx) {
    const id = ctx.clientIdentity;
    return JSON.stringify({
      mspId: id.getMSPID(),
      role: id.getAttributeValue('wrt.role'),
      entityId: id.getAttributeValue('wrt.entityId'),
    });
  }
}

module.exports.contracts = [HelloContract];
