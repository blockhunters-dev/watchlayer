import type { ChainReader } from "./types.js";
import { validatorStatus } from "./derive.js";
import { recordRun, saveSnapshot, type Db } from "./db.js";

export async function collectOnce(db: Db, reader: ChainReader, now = Math.floor(Date.now() / 1000)) {
  // One epoch read per snapshot, passed down, so saved epoch and ban status can never straddle a rollover.
  const epoch = await reader.getEpoch();
  const validators = await reader.getValidators(epoch.currentEpoch);
  saveSnapshot(db, now, epoch, validators.map((v) => ({ ...v, status: validatorStatus(v) })));
  return { epoch: epoch.currentEpoch, validators: validators.length };
}

/** collectOnce plus a recorded outcome, so uptime and latency are measured from what the indexer actually saw. */
export async function runCollection(db: Db, reader: ChainReader, now = Math.floor(Date.now() / 1000)) {
  const start = performance.now();
  try {
    const r = await collectOnce(db, reader, now);
    recordRun(db, now, true, performance.now() - start);
    return r;
  } catch (e) {
    recordRun(db, now, false, performance.now() - start, (e as Error).message);
    throw e;
  }
}
