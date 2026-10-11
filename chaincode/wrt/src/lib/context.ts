import { Context, Contract } from 'fabric-contract-api';
import {
  CHAINCODE_EVENT_NAME,
  type ChaincodeEvent,
  type ChaincodeEventBatch,
  type ChaincodeEventName,
  type ChaincodeEventPayloads,
} from '../shared/types';
import { toBytes } from './serialize';

/** Per-transaction context that collects domain events instead of emitting them one by one. */
export class WrtContext extends Context {
  readonly events: ChaincodeEvent[] = [];

  emit<N extends ChaincodeEventName>(name: N, payload: ChaincodeEventPayloads[N]): void {
    this.events.push({ name, payload } as ChaincodeEvent);
  }
}

/**
 * Base class for every WRT contract. Fabric keeps only the last setEvent() call
 * per transaction, so all events are emitted once, as a batch, after the
 * function succeeds (shared/types.ts: ChaincodeEventBatch).
 */
export abstract class WrtContract extends Contract {
  override createContext(): WrtContext {
    return new WrtContext();
  }

  override async afterTransaction(ctx: WrtContext, _result: unknown): Promise<void> {
    if (ctx.events.length === 0) {
      return;
    }
    const batch: ChaincodeEventBatch = { txId: ctx.stub.getTxID(), events: ctx.events };
    ctx.stub.setEvent(CHAINCODE_EVENT_NAME, toBytes(batch));
  }
}
