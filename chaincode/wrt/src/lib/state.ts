import type { Context } from 'fabric-contract-api';
import type { AssetBase, DocType } from '../shared/types';
import { WrtError } from './errors';
import { fromBytes, toBytes } from './serialize';
import { txIso } from './time';

type AnyAsset = AssetBase<DocType>;
/** What a contract supplies when creating an asset; the bookkeeping fields are added here. */
export type NewAsset<T extends AnyAsset> = Omit<T, 'createdAt' | 'updatedAt' | 'version'>;

export async function readAsset<T extends AnyAsset>(ctx: Context, key: string): Promise<T | undefined> {
  const bytes = await ctx.stub.getState(key);
  return bytes && bytes.length > 0 ? fromBytes<T>(bytes) : undefined;
}

export async function getAsset<T extends AnyAsset>(ctx: Context, key: string, label: string): Promise<T> {
  const asset = await readAsset<T>(ctx, key);
  if (!asset) {
    throw new WrtError('NOT_FOUND', `${label} does not exist`);
  }
  return asset;
}

/** Writes a new asset at version 1. Fails if the key is already taken. */
export async function createAsset<T extends AnyAsset>(ctx: Context, key: string, data: NewAsset<T>, label: string): Promise<T> {
  if (await readAsset(ctx, key)) {
    throw new WrtError('ALREADY_EXISTS', `${label} already exists`);
  }
  const now = txIso(ctx);
  const asset = { ...data, createdAt: now, updatedAt: now, version: 1 } as T;
  await ctx.stub.putState(key, toBytes(asset));
  return asset;
}

/** Writes an existing asset back, bumping version and updatedAt. */
export async function updateAsset<T extends AnyAsset>(ctx: Context, key: string, asset: T): Promise<T> {
  const updated = { ...asset, updatedAt: txIso(ctx), version: asset.version + 1 };
  await ctx.stub.putState(key, toBytes(updated));
  return updated;
}
