import { useQueryClient } from '@tanstack/react-query';
import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';
import type { StreamEvent } from './types';

/**
 * Subscribes to the backend's SSE stream (chaincode events, spec §2). Any event
 * means the ledger moved, so cached queries are refreshed. EventSource reconnects
 * by itself and resends Last-Event-ID, and the backend replays what was missed.
 */
export function useLedgerStream(): { live: boolean } {
  const qc = useQueryClient();
  const [live, setLive] = useState(false);
  useEffect(() => {
    const source = new EventSource('/api/events');
    let timer: ReturnType<typeof setTimeout> | undefined;
    source.onopen = () => setLive(true);
    source.onerror = () => setLive(false);
    source.addEventListener('wrt', (e) => {
      const event = JSON.parse((e as MessageEvent).data) as StreamEvent;
      qc.setQueryData<StreamEvent[]>(['events-recent'], (old) => (old && !old.some((o) => o.id === event.id) ? [event, ...old].slice(0, 100) : old));
      // Coalesce bursts (one tx can emit several events) into one refresh.
      clearTimeout(timer);
      timer = setTimeout(() => void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'events-recent' && q.queryKey[0] !== 'identities' }), 250);
    });
    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [qc]);
  return { live };
}

const LiveCtx = createContext(false);

/** Opens the one SSE connection for the app and shares its live/reconnecting state. */
export function LedgerStreamProvider({ children }: { children: ReactNode }) {
  const { live } = useLedgerStream();
  return createElement(LiveCtx.Provider, { value: live }, children);
}

export function useStreamLive(): { live: boolean } {
  return { live: useContext(LiveCtx) };
}
