import { X509Certificate } from 'node:crypto';
import { common, gateway, msp, peer } from '@hyperledger/fabric-protos';
import { setValidationCodeNames } from './errors.js';

/** TxValidationCode number -> name (VALID, ENDORSEMENT_POLICY_FAILURE, MVCC_READ_CONFLICT, ...). */
export const VALIDATION_CODE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(peer.TxValidationCode).map(([name, code]) => [code as number, name]),
);
setValidationCodeNames(VALIDATION_CODE_NAMES);

export interface Party {
  mspId: string;
  /** Certificate common name (enrollment ID), e.g. wh-001-operator or peer0. */
  name: string;
  role: string | null;
  entityId: string | null;
}

/** MSP, CN and wrt.* attributes of a serialized identity. Attributes live in a JSON cert extension. */
export function partyOf(serialized: Uint8Array): Party {
  const id = msp.SerializedIdentity.deserializeBinary(serialized);
  const pem = Buffer.from(id.getIdBytes_asU8()).toString('utf8');
  let name = '';
  let attrs: Record<string, string> = {};
  try {
    const cert = new X509Certificate(pem);
    name = /CN=([^\n,]+)/.exec(cert.subject)?.[1] ?? '';
    const raw = cert.raw.toString('latin1');
    const start = raw.indexOf('{"attrs":');
    if (start >= 0) {
      let depth = 0;
      for (let i = start; i < raw.length; i++) {
        if (raw[i] === '{') depth++;
        if (raw[i] === '}' && --depth === 0) {
          attrs = (JSON.parse(raw.slice(start, i + 1)) as { attrs: Record<string, string> }).attrs;
          break;
        }
      }
    }
  } catch {
    // Not a parseable cert: leave name/attrs empty.
  }
  return { mspId: id.getMspid(), name, role: attrs['wrt.role'] ?? null, entityId: attrs['wrt.entityId'] ?? null };
}

export interface ParsedTx {
  txId: string;
  timestamp: string;
  creator: Party;
  /** "Contract:Function" as invoked. */
  fn: string;
  args: string[];
  endorsers: string[];
  chaincodeEvent?: { name: string; payload: Uint8Array } | undefined;
}

/** Parses an endorser transaction envelope. Returns undefined for config transactions. */
export function parseEnvelope(envelopeBytes: Uint8Array): ParsedTx | undefined {
  const envelope = common.Envelope.deserializeBinary(envelopeBytes);
  const payload = common.Payload.deserializeBinary(envelope.getPayload_asU8());
  const header = payload.getHeader();
  if (!header) return undefined;
  const channelHeader = common.ChannelHeader.deserializeBinary(header.getChannelHeader_asU8());
  if (channelHeader.getType() !== common.HeaderType.ENDORSER_TRANSACTION) return undefined;
  const signatureHeader = common.SignatureHeader.deserializeBinary(header.getSignatureHeader_asU8());
  const ts = channelHeader.getTimestamp();

  const tx = peer.Transaction.deserializeBinary(payload.getData_asU8());
  const action = tx.getActionsList()[0];
  let fn = '';
  let args: string[] = [];
  let endorsers: string[] = [];
  let chaincodeEvent: ParsedTx['chaincodeEvent'];
  if (action) {
    const cap = peer.ChaincodeActionPayload.deserializeBinary(action.getPayload_asU8());
    const proposalPayload = peer.ChaincodeProposalPayload.deserializeBinary(cap.getChaincodeProposalPayload_asU8());
    const spec = peer.ChaincodeInvocationSpec.deserializeBinary(proposalPayload.getInput_asU8()).getChaincodeSpec();
    const input = spec?.getInput()?.getArgsList_asU8() ?? [];
    fn = input[0] ? Buffer.from(input[0]).toString('utf8') : '';
    // Arguments can be large JSON; keep them short for display.
    args = input.slice(1).map((a) => {
      const s = Buffer.from(a).toString('utf8');
      return s.length > 120 ? `${s.slice(0, 117)}...` : s;
    });
    const endorsed = cap.getAction();
    endorsers = (endorsed?.getEndorsementsList() ?? []).map((e) => msp.SerializedIdentity.deserializeBinary(e.getEndorser_asU8()).getMspid());
    const prp = endorsed ? peer.ProposalResponsePayload.deserializeBinary(endorsed.getProposalResponsePayload_asU8()) : undefined;
    const ccAction = prp ? peer.ChaincodeAction.deserializeBinary(prp.getExtension_asU8()) : undefined;
    const evBytes = ccAction?.getEvents_asU8();
    if (evBytes && evBytes.length > 0) {
      const ev = peer.ChaincodeEvent.deserializeBinary(evBytes);
      chaincodeEvent = { name: ev.getEventName(), payload: ev.getPayload_asU8() };
    }
  }
  return {
    txId: channelHeader.getTxId(),
    timestamp: ts ? new Date(ts.getSeconds() * 1000 + Math.floor(ts.getNanos() / 1e6)).toISOString() : '',
    creator: partyOf(signatureHeader.getCreator_asU8()),
    fn,
    args,
    endorsers: [...new Set(endorsers)].sort(),
    chaincodeEvent,
  };
}

export interface ParsedBlock {
  number: number;
  txs: (ParsedTx & { validationCode: string; index: number })[];
}

/** Parses a block and stamps each tx with the peer's validation verdict (metadata TRANSACTIONS_FILTER). */
export function parseBlock(block: common.Block): ParsedBlock {
  const number = Number(block.getHeader()?.getNumber() ?? 0);
  const filter = block.getMetadata()?.getMetadataList_asU8()[common.BlockMetadataIndex.TRANSACTIONS_FILTER] ?? new Uint8Array();
  const txs: ParsedBlock['txs'] = [];
  block
    .getData()
    ?.getDataList_asU8()
    .forEach((envBytes, index) => {
      const parsed = parseEnvelope(envBytes);
      if (parsed) txs.push({ ...parsed, index, validationCode: VALIDATION_CODE_NAMES[filter[index] ?? 0] ?? String(filter[index]) });
    });
  return { number, txs };
}

/** Endorsing MSPs of a not-yet-submitted transaction (Transaction.getBytes() is a gateway.PreparedTransaction). */
export function endorsersOfPrepared(preparedBytes: Uint8Array): string[] {
  const envelope = gateway.PreparedTransaction.deserializeBinary(preparedBytes).getEnvelope();
  return envelope ? (parseEnvelope(envelope.serializeBinary())?.endorsers ?? []) : [];
}
