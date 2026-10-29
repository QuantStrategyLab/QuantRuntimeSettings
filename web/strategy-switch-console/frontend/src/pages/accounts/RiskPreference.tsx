import { useEffect, useId, useRef, useState } from "react";
import { postJson } from "../../api/client";
import { loadAccountSettings } from "../../api/endpoints";
import { createAccountSettingsController, refreshAccountSettingsReadback, sameIdentity } from "../../accountSettingsState";
import { Skeleton } from "../../components/primitives";
import { useT } from "../../i18n";

/**
 * Unknown risk saves outlive this component (account or tab switch) so a
 * dropped response is never silently forgotten and blindly resent. The
 * controller keys entries by `platform:key` and refuses a new save while one
 * is unresolved.
 */
const unresolvedSaves: Parameters<typeof createAccountSettingsController>[0] = new Map();

const PREFERENCES = ["CAPITAL_PRESERVATION", "BALANCED_COMPOUNDING", "GROWTH_COMPOUNDING"] as const;


type ReadError = "" | "denied" | "mismatch" | "unavailable";
type Verify = "" | "saved" | "mismatch" | "unverified" | "conflict";

export function RiskPreference({ platform, accountKey }: { platform: string; accountKey: string }) {
  const t = useT();
  const selectId = useId();
  const controller = useRef(createAccountSettingsController(unresolvedSaves)).current;
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
    const started = controller.startSave("risk");
    const body = controller.requestBody(started);
    if (!started || !body || !controller.markSaving(started, "risk")) return;
    setVerify("");
    sync();
    let acknowledged = false;
    let failure: "" | "conflict" | "unknown" = "";
    let savedRevision: number | null = null;
    try {
      const saved = await postJson<Record<string, any>>("/api/account-settings", body);
      if (!controller.isCurrent(started)) return;
      acknowledged = controller.applySave(started, saved, "");
      if (acknowledged) savedRevision = saved.risk?.revision;
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
      // A resolved snapshot means the re-read matched the exact expected
      // post-save state, which confirms the write without resending it.
      if (!controller.view().review.risk) setVerify("saved");
      return;
    }
    const fresh = controller.view().settings;
    const actual = typeof fresh?.risk?.preference === "string" ? fresh?.risk?.preference : "";
    const wanted = body.risk_preference === null || body.risk_preference === undefined ? "" : String(body.risk_preference);
    setVerify(actual === wanted && sameIdentity(fresh?.identity, body.identity) && fresh?.risk?.revision === savedRevision ? "saved" : "mismatch");
  };

  const gateOpen = settings?.operations?.save_risk_preference === true;
  const currentValue = typeof settings?.risk?.preference === "string" ? settings?.risk?.preference : "";
  const label = (value: string) =>
    value === "CAPITAL_PRESERVATION" ? t("risk.capital")
      : value === "BALANCED_COMPOUNDING" ? t("risk.balanced")
        : value === "GROWTH_COMPOUNDING" ? t("risk.growth")
          : t("risk.other");
  const unrecognized = view.preference !== "" && !(PREFERENCES as readonly string[]).includes(view.preference);
  const dirty = controller.riskDirty();
  const revisionReady = Boolean(settings?.identity && typeof settings.identity === "object" && Number.isSafeInteger(settings?.risk?.revision));
  const editable = readState === "ready" && gateOpen && !view.saving && verify !== "unverified" && verify !== "mismatch";
  const canSave = editable && revisionReady && dirty && !view.review.risk && !unrecognized;
  const outcome = verify === "conflict" ? { tone: "error" as const, text: t("risk.conflict") }
    : verify === "mismatch" ? { tone: "error" as const, text: t("risk.mismatch") }
      : verify === "unverified" ? { tone: "error" as const, text: t("risk.unverified") }
        : verify === "saved" ? { tone: "success" as const, text: t("risk.saved") }
          : view.review.risk ? { tone: "error" as const, text: t("risk.review") }
            : null;
  const readMessage = readError === "denied" ? t("risk.denied") : readError === "mismatch" ? t("risk.readMismatch") : t("risk.readFailed");

  return (
    <section className="card">
      <h2 className="card-title">{t("risk.title")}</h2>
      <p className="card-note">{t("risk.note")}</p>
      {readState === "loading" && <Skeleton height={96} />}
      {readState === "failed" && (
        <p className="accounts-inline-note error" role="alert">
          {readMessage}{" "}
          <button type="button" className="accounts-alias-button" onClick={() => setReadAttempt(value => value + 1)}>{t("risk.reread")}</button>
        </p>
      )}
      {readState === "stale" && (
        <p className="accounts-inline-note error" role="alert">
          {readMessage} {t("risk.stale")}{" "}
          <button type="button" className="accounts-alias-button" onClick={() => setReadAttempt(value => value + 1)}>{t("risk.reread")}</button>
        </p>
      )}
      {outcome && (
        <p className={`accounts-inline-note ${outcome.tone}`} role={outcome.tone === "success" ? "status" : "alert"}>
          {outcome.text}{" "}
          {outcome.tone !== "success" && (
            <button type="button" className="accounts-alias-button" onClick={() => setReadAttempt(value => value + 1)}>{t("risk.reread")}</button>
          )}
        </p>
      )}
      {view.saving && <p className="accounts-inline-note" role="status">{t("risk.saving")}</p>}
      {readState !== "loading" && settings && (
        <>
          <div className="accounts-field-rows">
            <div className="accounts-field-row">
              <label className="accounts-field-label" htmlFor={selectId}>{t("risk.field")}</label>
              <div className="accounts-field-body">
                <div className="accounts-field-control">
                  <select
                    id={selectId}
                    className="input"
                    value={view.preference}
                    disabled={!editable}
                    onChange={event => {
                      setVerify("");
                      controller.edit({ preference: event.target.value });
                      sync();
                    }}
                  >
                    <option value="">{t("risk.unset")}</option>
                    {PREFERENCES.map(value => <option key={value} value={value}>{label(value)}</option>)}
                    {unrecognized && <option value={view.preference}>{t("risk.other")}</option>}
                  </select>
                </div>
                <span className="accounts-field-current">{t("risk.savedValue")} · {currentValue === "" ? t("risk.unset") : label(currentValue)}</span>
              </div>
            </div>
          </div>
          <div className="accounts-toolbar">
            <button type="button" className="button button-primary" disabled={!canSave} onClick={() => void save()}>{t("risk.save")}</button>
            {dirty && (
              <button type="button" className="button button-secondary" onClick={() => { controller.revertRisk(); setVerify(""); sync(); }}>{t("risk.discard")}</button>
            )}
            {!gateOpen && <span className="card-note">{t("risk.gate")}</span>}
          </div>
          {view.review.risk && (
            <button type="button" className="button button-secondary button-sm" onClick={() => { if (!controller.acknowledgeReview("risk")) setReadAttempt(value => value + 1); sync(); }}>{t("risk.ack")}</button>
          )}
        </>
      )}
    </section>
  );
}
