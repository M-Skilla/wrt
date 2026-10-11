import { useEffect, useRef, type ReactNode } from 'react';
import { Callout } from './ui';
import type { ApiError } from '../lib/api';

/**
 * Dialog (handoff §3): 8px radius, title, mono subtitle (the object ID), 36px close
 * button, body, then a footer on surface-2 with a hint on the left and actions on the right.
 * Uses the native <dialog> for focus trapping and Escape.
 */
export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  children,
  hint,
  actions,
  error,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  actions: ReactNode;
  error?: ApiError | null;
  width?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label={title}
      className="m-auto w-[calc(100vw-32px)] max-w-none rounded-dialog border border-line bg-surface p-0 text-ink shadow-dialog backdrop:bg-ink/40"
      style={{ maxWidth: width }}
    >
      {open && (
        <div className="flex max-h-[calc(100vh-48px)] flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-[17px] font-bold">{title}</h2>
              {subtitle && <p className="m-0 mt-1 break-all font-mono text-[12px] text-muted">{subtitle}</p>}
            </div>
            <button type="button" aria-label="Close" onClick={onClose} className="grid h-9 w-9 flex-none cursor-pointer place-items-center rounded-card border border-input-line bg-surface text-[18px] leading-none text-ink hover:bg-canvas">
              ×
            </button>
          </div>
          <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
            {children}
            {error && (
              <Callout tone="error" title={error.code}>
                <span className="break-words">{error.message}</span>
              </Callout>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-2 px-5 py-3">
            <div className="min-w-0 flex-1">{hint}</div>
            <div className="flex flex-wrap gap-2">{actions}</div>
          </div>
        </div>
      )}
    </dialog>
  );
}
