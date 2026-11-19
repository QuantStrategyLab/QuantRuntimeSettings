declare module "../../../application/runtime_instances/account_management_text.js" {
  export interface BilingualManagementCopy {
    readonly "zh-CN": string;
    readonly en: string;
  }
  export const MANAGEMENT_STATUS_TEXT: Readonly<{
    managed: BilingualManagementCopy;
    management_disabled: BilingualManagementCopy;
    not_under_management: BilingualManagementCopy;
    unknown: BilingualManagementCopy;
  }>;
  export const MANAGEMENT_EVIDENCE_TEXT: Readonly<{
    unknown: BilingualManagementCopy;
    conflict: BilingualManagementCopy;
    stale: BilingualManagementCopy;
  }>;
}
