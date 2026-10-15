import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useT } from "../i18n";

export interface ConfirmRequest {
  title: string;
  target?: string;
  summary?: ReactNode;
  consequence?: ReactNode;
  tone?: "normal" | "danger";
  confirmLabel?: string;
  /** Require checking this acknowledgement before confirming. */
  ackLabel?: string;
  /** Require typing this exact value (e.g. account alias) before confirming. */
  typeToConfirm?: { label: string; expected: string; mismatch: string };
  body?: ReactNode;
}

/** Unified confirmation dialog; supports acknowledgement checkbox and type-to-confirm. */
export function ConfirmationDialog({ request, onResolve }: { request: ConfirmRequest; onResolve: (confirmed: boolean) => void }) {
  const t = useT();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [acked, setAcked] = useState(false);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const typeOk = !request.typeToConfirm || typed.trim() === request.typeToConfirm.expected;
  const ackOk = !request.ackLabel || acked;
  const canConfirm = typeOk && ackOk;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onResolve(false);
      return;
    }
    if (event.key !== "Tab") return;
    const items = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    );
    if (!items?.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onResolve(false);
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        ref={dialogRef}
        onKeyDown={onKeyDown}
      >
        <h2 id="confirm-title">{request.title}</h2>
        {request.target && <p className="dialog-target">{request.target}</p>}
        {request.summary && <div className="dialog-summary">{request.summary}</div>}
        {request.body}
        {request.consequence && <p className={`dialog-consequence ${request.tone === "danger" ? "danger" : ""}`}>{request.consequence}</p>}
        {request.ackLabel && (
          <label className="checkbox-row">
            <input type="checkbox" checked={acked} onChange={event => setAcked(event.target.checked)} />
            <span>{request.ackLabel}</span>
          </label>
        )}
        {request.typeToConfirm && (
          <label className="field" style={{ marginTop: 12 }}>
            <span>{request.typeToConfirm.label}</span>
            <input
              className="input"
              value={typed}
              onChange={event => setTyped(event.target.value)}
              autoComplete="off"
              aria-invalid={!typeOk && typed.length > 0}
            />
            {!typeOk && typed.length > 0 && <span style={{ color: "var(--danger)", fontSize: 12 }}>{request.typeToConfirm.mismatch}</span>}
          </label>
        )}
        <div className="dialog-actions">
          <button ref={cancelRef} className="button button-secondary" type="button" onClick={() => onResolve(false)}>
            {t("common.cancel")}
          </button>
          <button
            className={`button ${request.tone === "danger" ? "button-danger" : "button-primary"}`}
            type="button"
            disabled={!canConfirm}
            onClick={() => onResolve(true)}
          >
            {request.confirmLabel || t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Promise-based confirmation host; one dialog at a time. */
export function useConfirmation() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);

  const confirm = (next: ConfirmRequest): Promise<boolean> =>
    new Promise(resolve => {
      resolver.current?.(false);
      resolver.current = resolve;
      setRequest(next);
    });

  const resolve = (confirmed: boolean) => {
    resolver.current?.(confirmed);
    resolver.current = null;
    setRequest(null);
  };

  return { confirmRequest: request, confirm, resolveConfirm: resolve };
}
