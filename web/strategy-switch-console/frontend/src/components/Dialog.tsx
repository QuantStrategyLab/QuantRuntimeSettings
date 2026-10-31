import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { expiryState } from "../api/cockpit";
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
  /** Server-bound validity. Pass only when the server clock is known. */
  expiresAt?: string | null;
  serverTime?: string | null;
  receivedAt?: string;
  /** Called once when the open dialog crosses the server expiry boundary. */
  onExpiry?: () => void;
}

/** Unified confirmation dialog; supports acknowledgement checkbox and type-to-confirm. */
export function ConfirmationDialog({ request, onResolve }: { request: ConfirmRequest; onResolve: (confirmed: boolean) => void }) {
  const t = useT();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [acked, setAcked] = useState(false);
  const [typed, setTyped] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const expiryFired = useRef(false);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!request.expiresAt) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [request.expiresAt]);

  // Only a server-derived expiry is enforced. Without a server clock the
  // dialog keeps the existing read-time validity check instead of guessing.
  const expiry = request.expiresAt
    ? expiryState(request.expiresAt, request.serverTime ?? null, request.receivedAt ?? new Date().toISOString(), now)
    : ({ state: "none" } as const);
  const expired = expiry.state === "expired";
  useEffect(() => {
    if (!expired || expiryFired.current) return;
    expiryFired.current = true;
    request.onExpiry?.();
  }, [expired, request]);

  const typeOk = !request.typeToConfirm || typed.trim() === request.typeToConfirm.expected;
  const ackOk = !request.ackLabel || acked;
  const canConfirm = typeOk && ackOk && !expired;

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
        {request.expiresAt && (
          <p className={`dialog-consequence ${expired ? "danger" : ""}`} role={expired ? "alert" : undefined}>
            {expired
              ? <>{t("cockpit.expiry.expired")} · {t("cockpit.expiry.boundary")}</>
              : t("cockpit.expiry.at", { value: request.expiresAt })}
          </p>
        )}
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
