import { useDisplayNames } from "../../lib/useDisplayNames";
import { useId, useState } from "react";
import type { DraftField, Scalar, SettingsDiffResponse, SettingsDiffRow, SettingsSection } from "../../api/contracts";
import { loadAccountSettings, loadSettingsDiff, saveCombinedDraft } from "../../api/endpoints";
import { HttpError } from "../../api/client";
import { useLanguage, useT } from "../../i18n";
import type { Translate } from "../../i18n";
import type { AsyncState } from "../../lib/hooks";
import { Badge, ErrorState, Skeleton } from "../../components/primitives";
import { DiffTable, type DiffRowLike } from "../../components/DiffTable";
import { useToast } from "../../components/Toast";
import type { ConfirmRequest } from "../../components/Dialog";
import {
  buildOverrides,
  fieldLabel,
  groupBySection,
  isValidDecimal,
  isValidDcaAmount,
  isValidRatio,
  profileOptions,
  proposedValue,
  scalarText,
  sectionLabel,
  type AccountRow,
  type ConsoleConfig,
  type EditMap,
} from "./helpers";

type DiffState = AsyncState<SettingsDiffResponse> & { reload: () => void };
type Confirm = (request: ConfirmRequest) => Promise<boolean>;

const DCA_FIELDS: DraftField[] = ["dca_mode", "dca_base_investment_usd"];

function hasOwn(map: EditMap, field: DraftField): boolean {
  return Object.prototype.hasOwnProperty.call(map, field);
}

/** Read-only summary of the diff rows, grouped by section. Used by the overview tab and view mode. */
export function DiffSummary({ rows, t }: { rows: SettingsDiffRow[]; t: Translate }) {
  return (
    <>
      {groupBySection(rows).map(group => (
        <section className="accounts-diff-section" key={group.section}>
          <h3>{sectionLabel(t, group.section)}</h3>
          <div className="accounts-field-rows">
            {group.rows.map(row => (
              <div className="accounts-field-row" key={row.field}>
                <span className="accounts-field-label">{fieldLabel(t, row)}</span>
                <div className="accounts-field-body">
                  <span className="accounts-field-value">
                    {scalarText(t, row.field, row.current, row.current_status === "unknown")}
                  </span>
                  {row.overridden && (
                    <span className="accounts-field-current">
                      {t("accounts.draft_value", { value: scalarText(t, row.field, row.draft) })}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

interface ReviewRow extends DiffRowLike {
  section: SettingsSection;
}

function ReviewBody({ rows, t }: { rows: ReviewRow[]; t: Translate }) {
  return (
    <>
      {groupBySection(rows).map(group => (
        <div className="accounts-diff-section" key={group.section}>
          <h3>{sectionLabel(t, group.section)}</h3>
          <DiffTable rows={group.rows} />
        </div>
      ))}
    </>
  );
}

export function StrategyTab({
  account,
  diffState,
  config,
  editing,
  setEditing,
  edits,
  setEdits,
  confirm,
}: {
  account: AccountRow;
  diffState: DiffState;
  config: ConsoleConfig | null;
  editing: boolean;
  setEditing: (next: boolean) => void;
  edits: EditMap;
  setEdits: (next: EditMap | ((prev: EditMap) => EditMap)) => void;
  confirm: Confirm;
}) {
  const language = useLanguage();
  const names = useDisplayNames();
  const formId = useId();
  const controlId = (field: DraftField) => `${formId}-${field}`;
  const t = useT();
  const toast = useToast();
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<DraftField, string>>>({});

  if (diffState.phase === "loading") return <Skeleton height={220} />;
  if (diffState.phase === "error") return <ErrorState onRetry={diffState.reload} />;
  const diff = diffState.data;
  const rows = diff.rows;
  const identityConflict = diff.identity_status === "identity_conflict";
  const options = profileOptions(config, language);
  const dirty = Object.keys(edits).length > 0;

  const setEdit = (field: DraftField, value: Scalar | null) => {
    setFieldErrors(prev => ({ ...prev, [field]: undefined }));
    setEdits(prev => {
      const next: EditMap = { ...prev, [field]: value };
      // DCA mode and amount move as a pair; editing one binds the other.
      if (DCA_FIELDS.includes(field)) {
        const other: DraftField = field === "dca_mode" ? "dca_base_investment_usd" : "dca_mode";
        if (!hasOwn(next, other)) {
          const otherRow = rows.find(row => row.field === other);
          if (otherRow) next[other] = otherRow.overridden ? otherRow.draft : otherRow.current;
        }
      }
      return next;
    });
  };

  const undoEdit = (field: DraftField) => {
    setFieldErrors(prev => ({ ...prev, [field]: undefined }));
    setEdits(prev => {
      const next: EditMap = { ...prev };
      delete next[field];
      if (DCA_FIELDS.includes(field)) {
        delete next[field === "dca_mode" ? "dca_base_investment_usd" : "dca_mode"];
      }
      return next;
    });
  };

  const clearOverride = (field: DraftField) => {
    if (DCA_FIELDS.includes(field)) {
      setFieldErrors(prev => ({ ...prev, dca_mode: undefined, dca_base_investment_usd: undefined }));
      setEdits(prev => ({ ...prev, dca_mode: null, dca_base_investment_usd: null }));
      return;
    }
    setEdit(field, null);
  };

  const validate = (): boolean => {
    const errors: Partial<Record<DraftField, string>> = {};
    for (const field of Object.keys(edits) as DraftField[]) {
      const value = edits[field];
      if (value === null || value === undefined) continue;
      const text = String(value);
      if (field === "strategy_profile" && !text.trim()) errors[field] = t("accounts.form.select_profile");
      if (field === "reserved_cash_floor" && !isValidDecimal(text)) errors[field] = t("accounts.form.invalid_decimal");
      if (field === "reserved_cash_ratio" && !isValidRatio(text)) errors[field] = t("accounts.form.invalid_ratio");
      if (field === "dca_base_investment_usd" && !isValidDcaAmount(text)) errors[field] = t("accounts.form.invalid_dca_amount");
    }
    const overrides = buildOverrides(rows, edits);
    const modeSet = typeof overrides.dca_mode === "string" && overrides.dca_mode.length > 0;
    const amountSet = typeof overrides.dca_base_investment_usd === "string" && overrides.dca_base_investment_usd.length > 0;
    if (modeSet !== amountSet) errors.dca_mode = t("accounts.form.dca_pair_required");
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const doSave = async (fresh: SettingsDiffResponse) => {
    setSaving(true);
    setNotice(null);
    // The combined save requires the complete identity from the legacy read.
    // A failure here means nothing was sent — a plain retryable error, not an unknown result.
    let identity: Record<string, unknown>;
    try {
      const settings = await loadAccountSettings(account.platform, account.account_alias);
      if (!settings.identity || typeof settings.identity !== "object" || Array.isArray(settings.identity)) {
        throw new Error("identity_missing");
      }
      identity = settings.identity as Record<string, unknown>;
    } catch {
      setNotice({ kind: "error", text: t("error.generic") });
      setSaving(false);
      return;
    }
    try {
      await saveCombinedDraft({
        platform: account.platform,
        key: account.account_alias,
        identity,
        expected_draft_revision: fresh.draft_revision,
        overrides: buildOverrides(fresh.rows, edits),
      });
      setEdits({});
      setEditing(false);
      setNotice({ kind: "success", text: `${t("accounts.draft_saved")} ${t("accounts.draft_note")}` });
      diffState.reload();
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) {
        const code = (error.payload as { error?: string } | null)?.error;
        const text =
          code === "account_settings_draft_revision_conflict"
            ? t("accounts.conflict")
            : code === "account_settings_identity_conflict"
              ? t("accounts.identity_conflict")
              : t("error.conflict");
        setNotice({ kind: "error", text });
        diffState.reload();
      } else {
        // Timeout or unknown result: never blind-resend; the user must refresh and verify.
        setNotice({ kind: "error", text: t("accounts.save_unknown") });
      }
    } finally {
      setSaving(false);
    }
  };

  const review = async () => {
    if (!validate()) return;
    setChecking(true);
    setNotice(null);
    try {
      const fresh = await loadSettingsDiff(account.account_alias, account.platform);
      if (fresh.identity_status === "identity_conflict") {
        setNotice({ kind: "error", text: t("accounts.identity_conflict") });
        diffState.reload();
        return;
      }
      const changed: ReviewRow[] = fresh.rows
        .filter(row => {
          const baseline = row.overridden ? row.draft : row.current;
          const next = hasOwn(edits, row.field) ? edits[row.field] : baseline;
          return String(next ?? "") !== String(baseline ?? "");
        })
        .map(row => {
          const cleared = hasOwn(edits, row.field) && edits[row.field] === null;
          const proposed = cleared ? row.current : proposedValue(row, edits);
          return {
            section: row.section,
            field: row.field,
            label: fieldLabel(t, row),
            before: row.current_status === "unknown" ? null : row.current,
            after: cleared ? t("accounts.form.inherit") : proposed,
            affectsLive: row.affects_live,
          };
        });
      if (!changed.length) {
        toast({ kind: "info", text: t("accounts.no_changes") });
        return;
      }
      const accepted = await confirm({
        title: t("accounts.diff_dialog_title"),
        target: names.account(account.account_alias, account.platform),
        summary: t("accounts.draft_note"),
        body: <ReviewBody rows={changed} t={t} />,
        ackLabel: changed.some(row => row.affectsLive) ? t("accounts.ack_live") : undefined,
        confirmLabel: t("accounts.save_draft"),
        tone: "normal",
      });
      if (accepted) await doSave(fresh);
    } catch {
      toast({ kind: "error", text: t("error.generic") });
    } finally {
      setChecking(false);
    }
  };

  const cancelEdit = async () => {
    if (dirty) {
      const accepted = await confirm({
        title: t("common.unsaved_guard_title"),
        summary: t("common.unsaved_guard_body"),
        tone: "normal",
      });
      if (!accepted) return;
    }
    setEdits({});
    setFieldErrors({});
    setEditing(false);
  };

  const renderControl = (row: SettingsDiffRow) => {
    const proposed = proposedValue(row, edits);
    const edited = hasOwn(edits, row.field);
    const text = proposed === null || proposed === undefined ? "" : String(proposed);
    const error = fieldErrors[row.field];
    const accessibility = {
      id: controlId(row.field),
      "aria-invalid": Boolean(error),
      "aria-describedby": error ? `${controlId(row.field)}-error` : undefined,
    };
    let control;
    if (row.field === "strategy_profile") {
      const known = options.some(option => option.profile === text);
      control = (
        <select {...accessibility} className="input" value={text} onChange={event => setEdit(row.field, event.target.value)}>
          {!text && <option value="" disabled>{t("accounts.form.select_profile")}</option>}
          {text && !known && <option value={text}>{text}</option>}
          {options.map(option => (
            <option key={option.profile} value={option.profile}>{option.label}</option>
          ))}
        </select>
      );
    } else if (row.field === "dca_mode") {
      control = (
        <select {...accessibility} className="input" value={text} onChange={event => setEdit(row.field, event.target.value)}>
          {!text && <option value="" disabled>{t("common.na")}</option>}
          <option value="fixed">{t("accounts.dca_mode.fixed")}</option>
          <option value="smart">{t("accounts.dca_mode.smart")}</option>
        </select>
      );
    } else if (row.field === "income_layer_enabled" || row.field === "option_overlay_enabled") {
      control = (
        <select {...accessibility} className="input" value={text} onChange={event => setEdit(row.field, event.target.value === "true")}>
          {!text && <option value="" disabled>{t("common.na")}</option>}
          <option value="true">{t("accounts.bool.on")}</option>
          <option value="false">{t("accounts.bool.off")}</option>
        </select>
      );
    } else {
      control = (
        <input
          {...accessibility}
          className="input"
          value={text}
          inputMode="decimal"
          maxLength={32}
          onChange={event => setEdit(row.field, event.target.value)}
        />
      );
    }
    return (
      <div className="accounts-field-body">
        <div className="accounts-field-control">
          {control}
          {edited && (
            <button type="button" className="button button-secondary button-sm" onClick={() => undoEdit(row.field)}>
              {t("accounts.form.undo")}
            </button>
          )}
          {!edited && row.overridden && (
            <button type="button" className="button button-secondary button-sm" onClick={() => clearOverride(row.field)}>
              {t("accounts.form.clear_override")}
            </button>
          )}
        </div>
        <span className="accounts-field-current">
          {t("decisions.col.current")} · {scalarText(t, row.field, row.current, row.current_status === "unknown")}
        </span>
        {error && <span id={`${controlId(row.field)}-error`} className="accounts-field-error">{error}</span>}
      </div>
    );
  };

  return (
    <section className="card">
      <div className="accounts-toolbar">
        <Badge tone={editing ? "accent" : "unknown"}>{t(editing ? "accounts.editing" : "accounts.viewing")}</Badge>
        <span className="asof">{t("accounts.draft_revision", { value: diff.draft_revision })}</span>
        <span style={{ flex: 1 }} />
        {!editing && (
          <button type="button" className="button button-secondary" onClick={() => setEditing(true)}>
            {t("accounts.edit")}
          </button>
        )}
        {editing && (
          <>
            <button
              type="button"
              className="button button-primary"
              disabled={checking || saving || identityConflict}
              onClick={() => void review()}
            >
              {checking ? t("accounts.checking") : t("accounts.check_changes")}
            </button>
            <button type="button" className="button button-secondary" disabled={checking || saving} onClick={() => void cancelEdit()}>
              {t("common.cancel")}
            </button>
          </>
        )}
      </div>
      {identityConflict && (
        <p className="accounts-inline-note error" role="alert">
          {t("accounts.identity_conflict")}{" "}
          <button type="button" className="accounts-alias-button" onClick={diffState.reload}>{t("common.refresh")}</button>
        </p>
      )}
      {notice && (
        <p className={`accounts-inline-note ${notice.kind}`} role="status">
          {notice.text}{" "}
          {notice.kind === "error" && (
            <button type="button" className="accounts-alias-button" onClick={diffState.reload}>{t("common.refresh")}</button>
          )}
        </p>
      )}
      {saving && <p className="accounts-inline-note" role="status">{t("accounts.saving")}</p>}
      {editing ? (
        groupBySection(rows).map(group => (
          <section className="accounts-diff-section" key={group.section}>
            <h3>{sectionLabel(t, group.section)}</h3>
            <div className="accounts-field-rows">
              {group.rows.map(row => (
                <div className="accounts-field-row" key={row.field}>
                  <label className="accounts-field-label" htmlFor={controlId(row.field)}>{fieldLabel(t, row)}</label>
                  {renderControl(row)}
                </div>
              ))}
            </div>
          </section>
        ))
      ) : (
        <DiffSummary rows={rows} t={t} />
      )}
    </section>
  );
}
