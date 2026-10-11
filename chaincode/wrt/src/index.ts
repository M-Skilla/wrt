import { DisputeContract } from './contracts/dispute';
import { LoanContract } from './contracts/loan';
import { QueryContract } from './contracts/query';
import { ReceiptContract } from './contracts/receipt';
import { RegistryContract } from './contracts/registry';

export { DisputeContract, LoanContract, QueryContract, ReceiptContract, RegistryContract };

// Invoked as "<ContractName>:<Function>", e.g. "ReceiptContract:RecordDeposit".
export const contracts: unknown[] = [RegistryContract, ReceiptContract, LoanContract, DisputeContract, QueryContract];
