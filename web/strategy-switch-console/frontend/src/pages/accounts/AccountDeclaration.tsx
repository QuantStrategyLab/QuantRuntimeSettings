import { useEffect, useId, useRef, useState } from "react";
import { postJson } from "../../api/client";
import { loadAccountSettings } from "../../api/endpoints";
import { createAccountSettingsController, refreshAccountSettingsReadback, sameIdentity } from "../../accountSettingsState";
import { Skeleton } from "../../components/primitives";
import { useT } from "../../i18n";

/**
 * Unknown declaration saves outlive this component (account or tab switch) so
 * a dropped response is never silently forgotten and blindly resent. The
 * controller keys entries by `platform:key` and refuses a new save while one
 * is unresolved.
 */
const unresolvedDeclarations: Parameters<typeof createAccountSettingsController>[0] = new Map();

const ENVIRONMENTS = ["live", "paper"] as const;
const ACCOUNT_TYPES = ["cash", "margin"] as const;

type ReadError = "" | "denied" | "mismatch" | "unavailable";
type Verify = "" | "saved" | "mismatch" | "unverified" | "conflict";

function declaredText(value: unknown): string {
  return value === "live" || value === "paper" || value === "cash" || value === "margin" ? value : "";
}

export function AccountDeclaration({ platform, accountKey, onSaved }: { platform: string; accountKey: string; onSaved: () => void }) {
  const t = useT();
  const environmentId = useId();
  const accountTypeId = useId();
  const controller = useRef(createAccountSettingsController(unresolvedDeclarations)).current;
  const [, setTick] = useState(0);
  const [readAttempt, setReadAttempt] = useState(0);
  const [readState, setReadState] = useState<"loading" | "refreshing" | "ready" | "stale" | "failed">("loading");
  const [readError, setReadError] = useState<ReadError>("");
  const [verify, setVerify] = useState<Verify>("");
  const sync = () => setTick(value => value + 1);
  const view = controller.view();
  const settings = view.settings;

  useEffect(() => {
    const id = `${platform}:${accountKey}`;
    const same = controller.selectedId() === id;
    if (same && controller.view().saving) return;
    const kept = same && Boolean(controller.view().settings);
    const op = same ? controller.start("refresh") : controller.select({ platform, key: accountKey });
    setReadState(kept ? "refreshing" : "loading");
    setReadError("");
    setVerify("");
    let cancelled = false;
    void (async () => {
      try {
        const payload = await loadAccountSettings(platform, accountKey);
        if (cancelled) return;
        const applied = same ? controller.applyRefresh(op, payload) : controller.applyRead(op, payload);
        if (!applied) {
          if (controller.isCurrent(op)) throw new Error("account_settings_readback_mismatch");
          return;
        }
        setReadState("ready");
        sync();
      } catch (error) {
        if (cancelled) return;
        const status = Number((error as { status?: number })?.status || 0);
        const reason: ReadError = status === 401 || status === 403
          ? "denied"
          : (error as { message?: string })?.message === "account_settings_readback_mismatch" ? "mismatch" : "unavailable";
        if (kept) {
          if (!controller.isCurrent(op)) return;
          controller.abandon(op);
          setReadError(reason);
          setReadState("stale");
          sync();
          return;
        }
        if (!controller.applyUnavailable(op, "")) return;
        setReadState("failed");
        sync();
      }
    })();
    return () => { cancelled = true; controller.abandon(op); };
  }, [platform, accountKey, readAttempt, controller]);

  const save = async () => {
    const started = controller.startSave("declaration");
    const body = controller.requestBody(started);
    if (!started || !body || !controller.markSaving(started, "declaration")) return;
    setVerify("");
    sync();
    let acknowledged = false;
    let failure: "" | "conflict" | "unknown" = "";
    let savedRevision: number | null = null;
    try {
      const saved = await postJson<Record<string, any>>("/api/account-settings", body);
      if (!controller.isCurrent(started)) return;
      acknowledged = controller.applySave(started, saved, "");
      if (acknowledged) savedRevision = saved.declaration?.revision;
      if (!acknowledged) failure = "unknown";
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (status === 409) {
        failure = "conflict";
        controller.fail(started, "", false);
      } else {
        // A timeout or dropped response may still have committed server-side.
        // Keep the snapshot unresolved so the next attempt cannot blind resend.
        failure = "unknown";
        controller.fail(started, "", true);
      }
    } finally {
      if (controller.finish(started)) sync();
    }
    if (!controller.isCurrent(started)) return;
    sync();
    const refresh = controller.start("refresh");
    const result = await refreshAccountSettingsReadback(controller, refresh, () => loadAccountSettings(platform, accountKey));
    sync();
    if (result.status === "superseded") return;
    if (result.status === "failed") {
      setVerify(acknowledged ? "unverified" : failure === "conflict" ? "conflict" : "");
      return;
    }
    if (failure === "conflict") {
      setVerify("conflict");
      return;
    }
    if (!acknowledged) {
      if (!controller.view().review.declaration) { setVerify("saved"); onSaved(); }
      return;
    }
    const fresh = controller.view().settings;
    const sent = body.declaration as { environment: string | null; account_type: string | null };
    const wantedEnvironment = sent.environment ?? "";
    const wantedType = sent.account_type ?? "";
    const actualEnvironment = declaredText(fresh?.declaration?.environment);
    const actualType = declaredText(fresh?.declaration?.account_type);
    const verified = actualEnvironment === wantedEnvironment && actualType === wantedType
      && sameIdentity(fresh?.identity, body.identity) && fresh?.declaration?.revision === savedRevision;
    setVerify(verified ? "saved" : "mismatch");
    if (verified) onSaved();
  };

  const gateOpen = settings?.operations?.save_declaration === true;
  const savedEnvironment = declaredText(settings?.declaration?.environment);
  const savedType = declaredText(settings?.declaration?.account_type);
  const dirty = controller.declarationDirty();
  const revisionReady = Boolean(settings?.identity && typeof settings.identity === "object" && Number.isSafeInteger(settings?.declaration?.revision));
  const editable = readState === "ready" && settings?.declaration?.status !== "identity_conflict" && gateOpen && !view.saving && verify !== "unverified" && verify !== "mismatch";
  const canSave = editable && revisionReady && dirty && !view.review.declaration;
  const outcome = verify === "conflict" ? { tone: "error" as const, text: t("accounts.declaration.conflict") }
    : verify === "mismatch" ? { tone: "error" as const, text: t("accounts.declaration.mismatch") }
      : verify === "unverified" ? { tone: "error" as const, text: t("accounts.declaration.unverified") }
        : verify === "saved" ? { tone: "success" as const, text: t("accounts.declaration.saved") }
          : view.review.declaration ? { tone: "error" as const, text: t("accounts.declaration.review") }
            : null;
  const readMessage = readError === "denied" ? t("accounts.declaration.denied") : readError === "mismatch" ? t("accounts.declaration.readMismatch") : t("accounts.declaration.readFailed");
  const environmentLabel = (value: string) =>
    value === "live" ? t("accounts.declaration.env.live") : value === "paper" ? t("accounts.declaration.env.paper") : t("accounts.declaration.unset");
  const accountTypeLabel = (value: string) =>
    value === "cash" ? t("accounts.declaration.type.cash") : value === "margin" ? t("accounts.declaration.type.margin") : t("accounts.declaration.unset");

  return (
    <section className="card">
      <h2 className="card-title">{t("accounts.declaration.title")}</h2>
      <p className="card-note">{t("accounts.declaration.note")}</p>
      {readState === "loading" && <Skeleton height={96} />}
      {readState === "failed" && (
        <p className="accounts-inline-note error" role="alert">
          {readMessage}{" "}
          <button type="button" className="accounts-alias-button" onClick={() => setReadAttempt(value => value + 1)}>{t("accounts.declaration.reread")}</button>
        </p>
      )}
      {readState === "stale" && (
        <p className="accounts-inline-note error" role="alert">
          {readMessage} {t("accounts.declaration.stale")}{" "}
          <button type="button" className="accounts-alias-button" onClick={() => setReadAttempt(value => value + 1)}>{t("accounts.declaration.reread")}</button>
        </p>
      )}
      {outcome && (
        <p className={`accounts-inline-note ${outcome.tone}`} role={outcome.tone === "success" ? "status" : "alert"}>
          {outcome.text}{" "}
          {outcome.tone !== "success" && (
            <button type="button" className="accounts-alias-button" onClick={() => setReadAttempt(value => value + 1)}>{t("accounts.declaration.reread")}</button>
          )}
        </p>
      )}
      {view.saving && <p className="accounts-inline-note" role="status">{t("accounts.declaration.saving")}</p>}
      {readState !== "loading" && settings && (
        <>
          <div className="accounts-field-rows">
            <div className="accounts-field-row">
              <label className="accounts-field-label" htmlFor={environmentId}>{t("accounts.declaration.environment")}</label>
              <div className="accounts-field-body">
                <div className="accounts-field-control">
                  <select
                    id={environmentId}
                    className="input"
                    value={view.declaration.environment}
                    disabled={!editable}
                    onChange={event => {
                      setVerify("");
                      controller.editDeclaration({ environment: event.target.value as "" | "live" | "paper" });
                      sync();
                    }}
                  >
                    <option value="">{t("accounts.declaration.unset")}</option>
                    {ENVIRONMENTS.map(value => <option key={value} value={value}>{environmentLabel(value)}</option>)}
                  </select>
                </div>
                <span className="accounts-field-current">{t("accounts.declaration.savedValue")} · {savedEnvironment === "" ? t("accounts.declaration.unset") : environmentLabel(savedEnvironment)}</span>
              </div>
            </div>
            {platform !== "binance" && (
            <div className="accounts-field-row">
              <label className="accounts-field-label" htmlFor={accountTypeId}>{t("accounts.declaration.account_type")}</label>
              <div className="accounts-field-body">
                <div className="accounts-field-control">
                  <select
                    id={accountTypeId}
                    className="input"
                    value={view.declaration.accountType}
                    disabled={!editable}
                    onChange={event => {
                      setVerify("");
                      controller.editDeclaration({ accountType: event.target.value as "" | "cash" | "margin" });
                      sync();
                    }}
                  >
                    <option value="">{t("accounts.declaration.unset")}</option>
                    {ACCOUNT_TYPES.map(value => <option key={value} value={value}>{accountTypeLabel(value)}</option>)}
                  </select>
                </div>
                <span className="accounts-field-current">{t("accounts.declaration.savedValue")} · {savedType === "" ? t("accounts.declaration.unset") : accountTypeLabel(savedType)}</span>
              </div>
            </div>
            )}
          </div>
          <div className="accounts-toolbar">
            <button type="button" className="button button-primary" disabled={!canSave} onClick={() => void save()}>{t("accounts.declaration.save")}</button>
            {dirty && (
              <button type="button" className="button button-secondary" onClick={() => { controller.revertDeclaration(); setVerify(""); sync(); }}>{t("accounts.declaration.discard")}</button>
            )}
            {!gateOpen && <span className="card-note">{t("accounts.declaration.gate")}</span>}
          </div>
          {view.review.declaration && (
            <button type="button" className="button button-secondary button-sm" onClick={() => { if (!controller.acknowledgeReview("declaration")) setReadAttempt(value => value + 1); sync(); }}>{t("accounts.declaration.ack")}</button>
          )}
        </>
      )}
    </section>
  );
}
