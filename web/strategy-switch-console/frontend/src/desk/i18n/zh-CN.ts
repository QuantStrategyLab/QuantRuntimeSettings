/**
 * Desk copy, zh-CN (primary). Keys are the source of truth for DeskKey; en.ts must
 * provide every key (enforced by its type). Glossary: design/README.md of the
 * Meridian job. Field keys and log text stay verbatim and are not translated.
 */
export const zh = {
  // Ages and clocks.
  "age.s": "{s} 秒",
  "age.m": "{m} 分钟",
  "age.hm": "{h} 小时 {m} 分",
  "age.dh": "{d} 天 {h} 小时",
  "age.ago": "{age}前",
  "clock.utc": "{time} UTC",
  "weekday.0": "周日",
  "weekday.1": "周一",
  "weekday.2": "周二",
  "weekday.3": "周三",
  "weekday.4": "周四",
  "weekday.5": "周五",
  "weekday.6": "周六",
  "date.month_day": "{month}月{day}日 {weekday}",

  // Read<T> rendering: unknown is first-class and never shown as 0 or "stopped".
  "read.unknown": "未知",
  "read.unknown_mark": "?",
  "read.stale": "已过期 · {age}前",
  "read.reason.never_read": "从未读取",
  "read.reason.read_failed": "读取失败",
  "read.reason.source_unavailable": "来源不可用",
  "read.reason.identity_unverified": "身份未验证",
  "read.reason.not_supported": "不支持",
  "read.reason.insufficient_history": "历史不足",
  "read.reason.other": "原因未知",
  "read.unknown_not_stopped": "未知不等于已停止",

  // Shared state vocabulary.
  "runtime.running": "运行中",
  "runtime.stopped": "已停止",
  "runtime.unknown": "运行状态未知",
  "config.synced": "保存 = 平台",
  "config.drift": "偏离 · {count} 项",
  "config.unknown": "配置未知",
  "compare.match": "一致",
  "compare.drift": "偏离",
  "compare.unknown": "未知",
  "mode.live": "实盘",
  "mode.paper": "模拟盘",
  "mode.dry_run": "演练",
  "severity.critical": "紧急",
  "severity.warning": "警告",
  "severity.info": "信息",
  "freshness.ready": "数据新鲜 · {age}前",
  "freshness.stale": "数据已过期 · {age}前",
  "freshness.unavailable": "数据不可用",
  "basis.native_ibkr_twr": "时间加权（IBKR）",
  "basis.nav_change_unadjusted": "净资产变化，未扣除出入金",
  "basis.mixed": "混合口径",
  "basis.unavailable": "收益口径不可用",
  "drawdown.ok": "回撤正常",
  "drawdown.near_limit": "回撤接近上限",
  "drawdown.breached": "回撤超出上限",
  "drawdown.unknown": "回撤未知",
  "mock.badge": "模拟数据",
} as const;

export type DeskKey = keyof typeof zh;
