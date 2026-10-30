import { strategyName } from "../../lib/displayNames";
import type { Language } from "../../lib/prefs";
import type { AccountsResponse, DraftField, Scalar, SettingsDiffRow, SettingsSection } from "../../api/contracts";
import type { Translate } from "../../i18n";

export type AccountRow = AccountsResponse["accounts"][number];

/** Best-effort legacy config: target names for run-control POSTs and strategy profile options. */
export type ConsoleConfig = import("../../lib/accountDirectory").DirectoryConfig;

export type EditMap = Partial<Record<DraftField, Scalar | null>>;

export const SECTION_ORDER: SettingsSection[] = ["strategy", "dca", "cash_reserve", "income_layer"];

export function platformLabel(config: ConsoleConfig | null, platform: string): string {
  return config?.platformMeta?.[platform]?.label || platform;
}

/** Run-control POSTs need the configured target name; fall back to the account key, never form input. */
export function targetNameFor(config: ConsoleConfig | null, platform: string, alias: string): string {
  const option = config?.accountOptions?.[platform]?.find(item => item.key === alias);
  return option?.target_name || alias;
}

export function profileOptions(config: ConsoleConfig | null, language: Language): { profile: string; label: string }[] {
  return (config?.strategyProfiles || [])
    .filter((item): item is { profile: string; label?: string; label_zh?: string; label_en?: string } => typeof item?.profile === "string" && item.profile.length > 0)
    .map(item => ({ profile: item.profile, label: strategyName(item.profile, language, language === "zh" ? item.label_zh : item.label_en) }));
}

/** Backend label_key first; fall back to the page dictionary when the key is not translated. */
export function fieldLabel(t: Translate, row: Pick<SettingsDiffRow, "label_key" | "field">): string {
  const translated = t(row.label_key);
  return translated === row.label_key ? t(`accounts.field.${row.field}`) : translated;
}

export function sectionLabel(t: Translate, section: SettingsSection): string {
  return t(`accounts.section.${section}`);
}

/** Display a settings scalar; unknown current values and nulls stay honest. */
export function scalarText(t: Translate, field: DraftField, value: Scalar, unknownValue = false, language: Language = "en"): string {
  if (unknownValue) return t("common.unknown");
  if (value === null || value === undefined || value === "") return t("common.na");
  if (typeof value === "boolean") return t(value ? "accounts.bool.on" : "accounts.bool.off");
  if (field === "dca_mode" && (value === "fixed" || value === "smart")) return t(`accounts.dca_mode.${value}`);
  if (field === "strategy_profile") return strategyName(String(value), language);
  return String(value);
}

/** Effective value of a field after applying local edits on top of the saved draft. */
export function proposedValue(row: SettingsDiffRow, edits: EditMap): Scalar {
  if (Object.prototype.hasOwnProperty.call(edits, row.field)) {
    const edited = edits[row.field];
    return edited === null ? row.current : edited === undefined ? row.current : edited;
  }
  return row.overridden ? row.draft : row.current;
}

/** True when the local edit changes the field relative to the saved draft state. */
export function fieldChanged(row: SettingsDiffRow, edits: EditMap): boolean {
  const baseline = row.overridden ? row.draft : row.current;
  return String(proposedValue(row, edits) ?? "") !== String(baseline ?? "");
}

/** The combined draft accepts strings and booleans; numeric scalars are submitted as decimal strings. */
function overrideValue(value: Scalar): string | boolean | null {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? String(value) : value;
}

/** The complete override set to submit: local edits win, untouched saved overrides are retained. */
export function buildOverrides(rows: SettingsDiffRow[], edits: EditMap): Partial<Record<DraftField, string | boolean | null>> {
  const overrides: Partial<Record<DraftField, string | boolean | null>> = {};
  for (const row of rows) {
    if (row.field === "option_overlay_enabled") {
      if (row.overridden) overrides.option_overlay_enabled = null;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(edits, row.field)) {
      overrides[row.field] = overrideValue(edits[row.field] as Scalar);
    } else if (row.overridden) {
      overrides[row.field] = overrideValue(row.draft);
    }
  }
  return overrides;
}

export function groupBySection<T extends { section: SettingsSection }>(rows: T[]): { section: SettingsSection; rows: T[] }[] {
  const groups: { section: SettingsSection; rows: T[] }[] = [];
  for (const section of SECTION_ORDER) {
    const group = rows.filter(row => row.section === section);
    if (group.length) groups.push({ section, rows: group });
  }
  return groups;
}

export function isValidDecimal(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value));
}

export function isValidRatio(value: string): boolean {
  if (!isValidDecimal(value)) return false;
  const parsed = Number(value);
  return parsed >= 0 && parsed <= 1;
}

export function isValidDcaAmount(value: string): boolean {
  return value.length <= 32 && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)) && Number(value) > 0;
}
