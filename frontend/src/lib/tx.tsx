import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { ApiError, type TxResult } from './api';
import { shortHash } from './format';

interface Toast {
  id: number;
  kind: 'ok' | 'error';
  title: string;
  detail?: string;
  txId?: string;
}

const Ctx = createContext<{ push: (t: Omit<Toast, 'id'>) => void } | null>(null);
let seq = 0;

/** TxToast (handoff §3): ink "Committed in block N" on success; red callout with the chaincode error verbatim on failure. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++seq;
    setToasts((all) => [...all.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), t.kind === 'ok' ? 6_000 : 12_000);
  }, []);
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(420px,calc(100vw-32px))] flex-col gap-2" aria-live="polite">
        {toasts.map((t) =>
          t.kind === 'ok' ? (
            <div key={t.id} role="status" className="pointer-events-auto flex items-start gap-3 rounded-card bg-ink px-4 py-3 text-[13px] text-white shadow-dialog">
              <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-cyan" />
              <span>
                <b>{t.title}</b> {t.detail}
                {t.txId && <span className="ml-1 font-mono text-muted-dark">tx {shortHash(t.txId)}</span>}
              </span>
            </div>
          ) : (
            <div key={t.id} role="alert" className="pointer-events-auto rounded-card border border-tint-red-line bg-tint-red px-4 py-3 text-[13px] text-ink shadow-dialog">
              <b className="font-mono">{t.title}</b>
              {t.detail && <div className="mt-1 break-words">{t.detail}</div>}
            </div>
          ),
        )}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast outside ToastProvider');
  return v.push;
}

/** Runs a ledger write, toasts the outcome and refreshes cached reads. Returns the result or undefined on failure. */
export function useTx() {
  const push = useToast();
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const run = useCallback(
    async <T,>(fn: () => Promise<TxResult<T>>, describe?: (r: T) => string): Promise<T | undefined> => {
      setPending(true);
      setError(null);
      try {
        const { result, tx } = await fn();
        push({ kind: 'ok', title: `Committed in block ${tx.blockNumber.toLocaleString('en-US')}.`, detail: describe?.(result) ?? '', txId: tx.txId });
        await qc.invalidateQueries();
        return result;
      } catch (err) {
        const e = err instanceof ApiError ? err : new ApiError(0, 'ERROR', (err as Error).message);
        setError(e);
        push({ kind: 'error', title: e.code, detail: e.message });
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [push, qc],
  );
  return { run, pending, error, clearError: () => setError(null) };
}
