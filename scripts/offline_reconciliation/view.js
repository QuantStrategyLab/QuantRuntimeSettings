// Observation Ledger: read-only forward reconciliation view.
// The only data source is the additive accounts[].forward_reconciliation field.
(() => {
  'use strict';

  const START_DATE = '2026-11-03';
  const STORAGE_LANG = 'ol-lang';
  const STORAGE_THEME = 'ol-theme';
  const DIMS = ['opening', 'positions', 'cash', 'fills', 'events', 'fees'];
  const DIM_KEYS = {
    opening: 'col_opening', positions: 'col_positions', cash: 'col_cash',
    fills: 'col_fills', events: 'col_events', fees: 'col_fees',
  };
  const STATUS = {
    ok: { cls: 'ok', mark: '✓', label: 's_ok' },
    bad: { cls: 'bad', mark: '✕', label: 's_bad' },
    open: { cls: 'open', mark: '–', label: 's_open' },
    np: { cls: 'np', mark: '?', label: 's_np' },
  };
  const PLATFORM_LABELS = Object.freeze({
    ibkr: 'IBKR', binance: 'Binance', schwab: 'Schwab',
    longbridge: 'LongBridge', firstrade: 'Firstrade',
  });

  const LOCALES = {
    'zh-CN': {
      u_left: 'QuantStrategyLab · 对账观测', u_zh: '中文', u_en: 'EN',
      u_light: '浅色', u_dark: '深色',
      m_title: '对账观测簿', m_issue: '第 {day} 号 · 观测第 {day} 日',
      m_asof: '读取生成：{time}', m_asof_none: '读取生成：未提供',
      m_sample: '示例数据 · 仅供设计评审', m_readonly: '只读观测 · 不触发任何操作',
      d1: '仅向前观测，起始于 2026-11-03', d2: '不回填历史',
      d3: '不编造期初快照', d4: '缺失维度保持“未对账”',
      l_cap: '今日要闻', l_h_a: '{accounts} 个平台、{dims} 个维度：',
      l_h_em_zero: '尚无对平证据', l_h_em_bad: '{bad} 处不符',
      l_h_b_zero: '，其余格子仍在等待证据。', l_h_b_bad: '，其余格子仍在等待证据。',
      l_p: '观测簿只记录能被证明的事实。仅向前观测，缺少期初快照的格子保持“未对账”，未知值不会显示为零。这不是故障，而是刻意的诚实。',
      s_ok: '已对平', s_bad: '不符', s_open: '未对账', s_np: '未证实',
      t_ok: '两侧来源一致', t_bad: '差额已记录，待处理',
      t_open: '缺少一侧或两侧数据', t_np: '读取能力尚未被证明',
      x_title: '平台 × 维度 对照表', x_cap: '{cells} 格 · 今日 · {accounts} 个账户',
      v_title: '证据时间', v_cap: '原生时间与生成时间分开显示',
      v_platform: '平台', v_source: '来源', v_captured: '采集窗口',
      v_generated: '读取生成', v_opening: '期初快照', v_later: '后续锚点', v_notice: '通知',
      v_missing: '未提供', v_unknown: '未知', v_present: '可用', v_stale: '已过期',
      v_opening_present: '已提供（仅元数据）', v_opening_missing: '缺失（未提供期初快照）',
      v_no_source: '无来源时间',
      n_unknown: '未知', n_pending: '待确认', n_confirmed: '已确认',
      e_cap: '不符条目', e_h: '契约未提供不符条目',
      e_p: '观测簿只登记已被提供的差额；它不自动修正，也不据此阻止或放行任何交易。执行与安全闸门另行判断。',
      e_r1: '券商报告持仓', e_r2: '内部记录持仓', e_r3: '今日已识别成交',
      e_r4: '已识别公司行为', e_r5: '未解释差额',
      e_empty: '没有不符证据；所有数值保持未提供，不以零代替。',
      a_title: '旁注', a_days: '观测日历',
      a_days_n: '从 2026-11-03 起仅向前记录。之后的格子在当日结束前保持空白。',
      a_pull: '缺失不是零，未知不是通过。',
      a_src: '来源', a_src_body: '来源状态：可用 {present}，已过期 {stale}，未知 {unknown}。',
      a_gen: '最近读取生成：{time}',
      a_base: '期初快照', a_base_body: '缺失 {missing}，已提供 {present}。已提供仅为元数据，不代表已对平。',
      a_notice: '通知', a_notice_body: '未知 {unknown}，待确认 {pending}，已确认 {confirmed}。通知状态独立于对账维度。',
      f_l: '账户标识不显示；标签为中性序号（如“账户 1”）。本页为只读观测，不触发任何操作。',
      f_r: 'QuantStrategyLab · 对账观测簿',
      err_title: '读取失败。', err_body: '未取得账户事实；页面不会保留旧计数或旧表格。',
      err_source: '数据源必须为同源相对路径。', err_api: '账户事实读取不可用。',
      err_lead: '未取得读取结果',
      sample_banner: '示例数据 · 仅供设计评审；不代表真实账户或运行时事实。',
      account_label: '账户 {n}',
      col_platform: '平台', col_opening: '期初', col_positions: '持仓', col_cash: '现金',
      col_fills: '成交', col_events: '资金事件', col_fees: '费用',
    },
    en: {
      u_left: 'QuantStrategyLab · Reconciliation', u_zh: '中文', u_en: 'EN',
      u_light: 'Light', u_dark: 'Dark',
      m_title: 'The Observation Ledger', m_issue: 'No. {day} · Observation day {day}',
      m_asof: 'Generated: {time}', m_asof_none: 'Generated: not supplied',
      m_sample: 'Sample data · design review only', m_readonly: 'Read-only observation · no action',
      d1: 'Forward-only from 2026-11-03', d2: 'No historical backfill',
      d3: 'No invented opening snapshot', d4: 'Missing dimensions stay Unreconciled',
      l_cap: 'Today’s lead', l_h_a: '{accounts} platforms, {dims} dimensions: ',
      l_h_em_zero: 'no reconciled evidence yet', l_h_em_bad: '{bad} mismatch',
      l_h_b_zero: ', and the remaining cells are still waiting for evidence.',
      l_h_b_bad: ', and the remaining cells are still waiting for evidence.',
      l_p: 'The ledger records only what can be proven. It is forward-only from 2026-11-03; a missing opening snapshot stays unreconciled, and unknown values are never shown as zero. That is not a fault; it is deliberate honesty.',
      s_ok: 'Reconciled', s_bad: 'Mismatch', s_open: 'Unreconciled', s_np: 'Not proven',
      t_ok: 'Both sources agree', t_bad: 'Difference recorded, open',
      t_open: 'One or both sides missing', t_np: 'Read capability not yet proven',
      x_title: 'Platform × dimension', x_cap: '{cells} cells · today · {accounts} accounts',
      v_title: 'Evidence timestamps', v_cap: 'Native and generated times kept separate',
      v_platform: 'Platform', v_source: 'Source', v_captured: 'Captured',
      v_generated: 'Generated', v_opening: 'Opening', v_later: 'Later anchor', v_notice: 'Notice',
      v_missing: 'Not supplied', v_unknown: 'Unknown', v_present: 'Present', v_stale: 'Stale',
      v_opening_present: 'Present (metadata only)', v_opening_missing: 'Missing (opening snapshot not supplied)',
      v_no_source: 'No source timestamp',
      n_unknown: 'Unknown', n_pending: 'Pending', n_confirmed: 'Confirmed',
      e_cap: 'Mismatch entry', e_h: 'No mismatch entry supplied',
      e_p: 'The ledger records only differences that were supplied. It never auto-corrects, and it never blocks or permits trading; execution and safety gates decide that separately.',
      e_r1: 'Broker-reported position', e_r2: 'Internal record', e_r3: 'Fills identified today',
      e_r4: 'Corporate actions identified', e_r5: 'Unexplained difference',
      e_empty: 'No mismatch evidence; values stay unsupplied rather than zero.',
      a_title: 'Marginalia', a_days: 'Observation calendar',
      a_days_n: 'Forward-only from 2026-11-03. Later squares stay blank until that day closes.',
      a_pull: 'Missing is not zero. Unknown is not a pass.',
      a_src: 'Source', a_src_body: 'Source status: {present} present, {stale} stale, {unknown} unknown.',
      a_gen: 'Latest generated read: {time}',
      a_base: 'Opening baseline', a_base_body: '{missing} missing, {present} present. Present is metadata only; it does not prove reconciliation.',
      a_notice: 'Notification', a_notice_body: '{unknown} unknown, {pending} pending, {confirmed} confirmed. Notice state is independent of reconciliation dimensions.',
      f_l: 'Account identifiers are not displayed; labels are neutral ordinals (for example “Account 1”). Read-only observation; this page triggers no action.',
      f_r: 'QuantStrategyLab · Observation Ledger',
      err_title: 'Read failed.', err_body: 'Account facts were not obtained; no stale tally or table is kept.',
      err_source: 'The source must be a same-origin relative path.', err_api: 'Account facts are unavailable.',
      err_lead: 'No read result',
      sample_banner: 'Sample data · design review only; not a real account or runtime fact.',
      account_label: 'Account {n}',
      col_platform: 'Platform', col_opening: 'Opening', col_positions: 'Positions', col_cash: 'Cash',
      col_fills: 'Fills', col_events: 'Cash events', col_fees: 'Fees',
    },
  };

  const SAMPLE_ACCOUNTS = [
    {
      platform: 'ibkr', account_key: 'acct-0001', forward_reconciliation: {
        schema_version: 'qsl.forward_reconciliation_read.v1', informational_only: true,
        generated_at: null, forward_start_date: '2026-11-03', source_status: 'unknown', source: null,
        baseline_status: 'missing', baseline_reason: 'opening_snapshot_missing', baseline: null,
        later_anchor: null, dimensions: { positions: 'UNRECONCILED', cash: 'UNRECONCILED', events: 'UNRECONCILED' },
        notification: { status: 'unknown', requested_at: null, confirmed_at: null },
      },
    },
    {
      platform: 'binance', account_key: 'acct-0002', forward_reconciliation: {
        schema_version: 'qsl.forward_reconciliation_read.v1', informational_only: true,
        generated_at: '2026-11-03T00:40:00+08:00', forward_start_date: '2026-11-03',
        source_status: 'stale', source: {
          source_as_of: '2026-11-03T00:05:00+08:00', timezone: 'Asia/Singapore',
          capture_started_at: '2026-11-03T00:04:00+08:00', capture_finished_at: '2026-11-03T00:05:00+08:00',
        }, baseline_status: 'missing', baseline_reason: 'opening_snapshot_missing', baseline: null,
        later_anchor: null, dimensions: { positions: 'UNRECONCILED', cash: 'UNRECONCILED', events: 'UNRECONCILED' },
        notification: { status: 'pending', requested_at: '2026-11-03T00:30:00+08:00', confirmed_at: null },
      },
    },
    {
      platform: 'schwab', account_key: 'acct-0003', forward_reconciliation: {
        schema_version: 'qsl.forward_reconciliation_read.v1', informational_only: true,
        generated_at: '2026-11-03T00:40:00+08:00', forward_start_date: '2026-11-03',
        source_status: 'present', source: {
          source_as_of: '2026-11-03T00:35:00+08:00', timezone: 'Asia/Singapore',
          capture_started_at: '2026-11-03T00:33:00+08:00', capture_finished_at: '2026-11-03T00:35:00+08:00',
        }, baseline_status: 'present', baseline_reason: null, baseline: {
          source_as_of: '2026-11-03T00:10:00+08:00', timezone: 'Asia/Singapore',
          capture_started_at: '2026-11-03T00:08:00+08:00', capture_finished_at: '2026-11-03T00:10:00+08:00',
        }, later_anchor: {
          source_as_of: '2026-11-03T00:35:00+08:00', timezone: 'Asia/Singapore',
          capture_started_at: '2026-11-03T00:33:00+08:00', capture_finished_at: '2026-11-03T00:35:00+08:00',
        }, dimensions: { positions: 'UNRECONCILED', cash: 'UNRECONCILED', events: 'UNRECONCILED' },
        notification: { status: 'confirmed', requested_at: '2026-11-03T00:31:00+08:00', confirmed_at: '2026-11-03T00:38:00+08:00' },
      },
    },
    {
      platform: 'longbridge', account_key: 'acct-0004', forward_reconciliation: {
        schema_version: 'qsl.forward_reconciliation_read.v1', informational_only: true,
        generated_at: '2026-11-03T00:40:00+08:00', forward_start_date: '2026-11-03',
        source_status: 'present', source: {
          source_as_of: '2026-11-03T00:36:00+08:00', timezone: 'Asia/Hong_Kong',
          capture_started_at: '2026-11-03T00:35:00+08:00', capture_finished_at: '2026-11-03T00:36:00+08:00',
        }, baseline_status: 'missing', baseline_reason: 'opening_snapshot_missing', baseline: null,
        later_anchor: null, dimensions: { positions: 'UNRECONCILED', cash: 'UNRECONCILED', events: 'UNRECONCILED' },
        notification: { status: 'unknown', requested_at: null, confirmed_at: null },
      },
    },
    {
      platform: 'firstrade', account_key: 'acct-0005', forward_reconciliation: {
        schema_version: 'qsl.forward_reconciliation_read.v1', informational_only: true,
        generated_at: null, forward_start_date: '2026-11-03', source_status: 'unknown', source: null,
        baseline_status: 'missing', baseline_reason: 'opening_snapshot_missing', baseline: null,
        later_anchor: null, dimensions: { positions: 'UNRECONCILED', cash: 'UNRECONCILED', events: 'UNRECONCILED' },
        notification: { status: 'unknown', requested_at: null, confirmed_at: null },
      },
    },
  ];

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ESCAPES[ch]);
  const format = (template, values) => String(template).replace(/\{(\w+)\}/g,
    (_, key) => Object.hasOwn(values, key) ? String(values[key]) : `{${key}}`);

  function platformLabel(platform) {
    const key = typeof platform === 'string' ? platform.toLowerCase() : '';
    if (PLATFORM_LABELS[key]) return PLATFORM_LABELS[key];
    return '—';
  }

  const exact = (value, keys) => value !== null && typeof value === 'object'
    && !Array.isArray(value) && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));

  function validInstant(value) {
    if (typeof value !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value)
        || /[+-]14:(?!00)/.test(value)) return false;
    const local = value.slice(0, 19);
    const localMs = Date.parse(`${local}Z`);
    return Number.isFinite(Date.parse(value)) && Number.isFinite(localMs)
      && new Date(localMs).toISOString().slice(0, 19) === local;
  }

  function validSnapshot(value) {
    return exact(value, ['source_as_of', 'timezone', 'capture_started_at', 'capture_finished_at'])
      && ['UTC', 'America/New_York', 'Asia/Hong_Kong', 'Asia/Singapore'].includes(value.timezone)
      && ['source_as_of', 'capture_started_at', 'capture_finished_at'].every(key => validInstant(value[key]))
      && Date.parse(value.capture_started_at) <= Date.parse(value.capture_finished_at)
      && Date.parse(value.source_as_of) <= Date.parse(value.capture_finished_at);
  }

  // Validate the read contract, without treating imported metadata as authentic
  // evidence or recomputing an explicit stale status from the wrapper timestamp.
  function isForward(value) {
    if (!exact(value, ['schema_version', 'informational_only', 'generated_at', 'forward_start_date',
      'source_status', 'source', 'baseline_status', 'baseline_reason', 'baseline', 'later_anchor',
      'dimensions', 'notification'])
        || value.schema_version !== 'qsl.forward_reconciliation_read.v1'
        || value.informational_only !== true || value.forward_start_date !== START_DATE
        || (value.generated_at !== null && !validInstant(value.generated_at))
        || !['unknown', 'stale', 'present'].includes(value.source_status)
        || (value.source_status === 'unknown' ? value.source !== null : !validSnapshot(value.source))
        || !['missing', 'present'].includes(value.baseline_status)
        || (value.baseline_status === 'missing'
          ? value.baseline !== null || value.baseline_reason !== 'opening_snapshot_missing'
          : !validSnapshot(value.baseline) || value.baseline.source_as_of.slice(0, 10) !== START_DATE
            || value.baseline_reason !== null)
        || (value.later_anchor !== null && !validSnapshot(value.later_anchor))
        || !exact(value.dimensions, ['positions', 'cash', 'events'])
        || !Object.values(value.dimensions).every(status => status === 'UNRECONCILED')) return false;
    const notice = value.notification;
    if (!exact(notice, ['status', 'requested_at', 'confirmed_at'])) return false;
    if (notice.status === 'unknown') return notice.requested_at === null && notice.confirmed_at === null;
    if (!validInstant(notice.requested_at)) return false;
    if (notice.status === 'pending') return notice.confirmed_at === null;
    return notice.status === 'confirmed' && validInstant(notice.confirmed_at)
      && Date.parse(notice.requested_at) <= Date.parse(notice.confirmed_at);
  }

  function cellStatus(forward, dim) {
    if (dim === 'opening') {
      if (!forward) return 'open';
      if (forward.baseline_status === 'present') return 'np';
      if (forward.baseline_status === 'missing') return 'open';
      return 'np';
    }
    if (dim === 'fills' || dim === 'fees') return 'np';
    const value = forward && forward.dimensions ? forward.dimensions[dim] : null;
    if (value === 'UNRECONCILED') return 'open';
    if (value == null) return 'open';
    return 'np';
  }

  function buildRows(accounts) {
    return accounts.map((account, index) => {
      const platform = account && typeof account.platform === 'string' && account.platform
        ? account.platform : 'unknown';
      const forward = account && account.forward_reconciliation != null
        ? account.forward_reconciliation : null;
      if (forward !== null && !isForward(forward)) throw new Error('invalid_forward_metadata');
      return {
        platform,
        platformLabel: platformLabel(platform),
        ordinal: index + 1,
        forward,
        cells: Object.fromEntries(DIMS.map(dim => [dim, cellStatus(forward, dim)])),
      };
    });
  }

  function buildTally(rows) {
    const tally = { ok: 0, bad: 0, open: 0, np: 0 };
    for (const row of rows) {
      for (const dim of DIMS) tally[row.cells[dim]] += 1;
    }
    return tally;
  }

  function latestGenerated(rows) {
    let best = null;
    let bestMs = -Infinity;
    for (const row of rows) {
      const value = row.forward && row.forward.generated_at;
      if (typeof value !== 'string') continue;
      const ms = Date.parse(value);
      if (Number.isFinite(ms) && ms > bestMs) { bestMs = ms; best = value; }
    }
    return best;
  }

  function countBy(rows, keyFn) {
    const out = { present: 0, stale: 0, missing: 0, unknown: 0, pending: 0, confirmed: 0 };
    for (const row of rows) {
      const key = keyFn(row);
      if (Object.hasOwn(out, key)) out[key] += 1;
      else out.unknown += 1;
    }
    return out;
  }

  function sgtDateKey(ms) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(ms));
    const get = type => (parts.find(part => part.type === type) || {}).value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  function observationDay(now, startDate) {
    const start = Date.parse(`${startDate}T00:00:00Z`);
    const today = Date.parse(`${sgtDateKey(now)}T00:00:00Z`);
    const day = Math.floor((today - start) / 86400000) + 1;
    return Number.isFinite(day) ? Math.max(1, day) : 1;
  }

  function sgtDate(lang, now) {
    return new Intl.DateTimeFormat(lang === 'zh-CN' ? 'zh-CN' : 'en-GB', {
      timeZone: 'Asia/Singapore', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    }).format(new Date(now));
  }

  function isRelativeSource(source) {
    const value = String(source || '').trim();
    return value.length > 0
      && !/[\\\u0000-\u0020\u007f]/.test(value)
      && !value.startsWith('/')
      && !value.startsWith('//')
      && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
  }

  function errorWith(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  async function loadPayload(params, fetchImpl) {
    if (params.get('sample') === '1') return { ok: true, accounts: SAMPLE_ACCOUNTS };
    let url = '/api/account-facts';
    const source = params.get('source');
    if (source !== null && source !== '') {
      if (!isRelativeSource(source)) throw errorWith('source_rejected');
      url = source;
    }
    if (typeof fetchImpl !== 'function') throw errorWith('fetch_unavailable');
    const response = await fetchImpl(url, { cache: 'no-store', headers: { accept: 'application/json' } });
    if (!response || !response.ok) throw errorWith('read_failed');
    let payload;
    try { payload = await response.json(); } catch { throw errorWith('invalid_json'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || payload.ok !== true || !Array.isArray(payload.accounts)) {
      throw errorWith('invalid_payload');
    }
    return payload;
  }

  const appState = {
    lang: 'zh-CN', theme: 'light', now: Date.now(), sample: false,
    generatedAt: null, rows: null, error: false, errorCode: null,
  };
  const translator = () => {
    const table = LOCALES[appState.lang];
    return key => (Object.hasOwn(table, key) ? table[key] : key);
  };

  function chooseLang(params, win) {
    const query = params.get('lang');
    if (query === 'zh-CN' || query === 'en') return query;
    try {
      const stored = win.localStorage ? win.localStorage.getItem(STORAGE_LANG) : null;
      if (stored === 'zh-CN' || stored === 'en') return stored;
    } catch { /* storage may be unavailable */ }
    const nav = win.navigator && (win.navigator.language
      || (Array.isArray(win.navigator.languages) ? win.navigator.languages[0] : ''));
    return /^zh/i.test(nav || '') ? 'zh-CN' : 'en';
  }

  function chooseTheme(params, win) {
    const query = params.get('theme');
    if (query === 'light' || query === 'dark') return query;
    try {
      const stored = win.localStorage ? win.localStorage.getItem(STORAGE_THEME) : null;
      if (stored === 'light' || stored === 'dark') return stored;
    } catch { /* storage may be unavailable */ }
    return typeof win.matchMedia === 'function' && win.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark' : 'light';
  }

  function setText(doc, id, value) {
    const node = doc.getElementById(id);
    if (node) node.textContent = value;
  }

  function setMarkup(doc, id, value) {
    const node = doc.getElementById(id);
    if (node) node.innerHTML = value;
  }

  function markHtml(status, t, visibleLabel) {
    const meta = STATUS[status] || STATUS.np;
    const label = esc(t(meta.label));
    return `<span class="mk ${meta.cls}" title="${label}" aria-label="${label}">`
      + `<i aria-hidden="true">${meta.mark}</i>`
      + (visibleLabel ? `<span>${label}</span>` : `<span class="sr-only">${label}</span>`)
      + '</span>';
  }

  function renderStatic(doc, t) {
    if (doc.documentElement) {
      doc.documentElement.lang = appState.lang;
      if (doc.documentElement.dataset) doc.documentElement.dataset.theme = appState.theme;
    }
    if (doc.title !== undefined) doc.title = t('m_title');
    const translated = doc.querySelectorAll ? doc.querySelectorAll('[data-i18n]') : [];
    translated.forEach(node => { node.textContent = t(node.dataset.i18n) || ''; });
    const languageButtons = doc.querySelectorAll ? doc.querySelectorAll('.js-l') : [];
    languageButtons.forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.v === appState.lang));
    });
    const themeButtons = doc.querySelectorAll ? doc.querySelectorAll('.js-t') : [];
    themeButtons.forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.v === appState.theme));
    });
  }

  function renderChrome(doc, t) {
    const start = appState.rows && appState.rows.length
      ? (appState.rows.find(row => row.forward && row.forward.forward_start_date) || {}).forward
      : null;
    const startDate = start && start.forward_start_date ? start.forward_start_date : START_DATE;
    const day = observationDay(appState.now, startDate);
    setMarkup(doc, 'mast-left', `${esc(format(t('m_issue'), { day }))}<br>${esc(sgtDate(appState.lang, appState.now))}`);
    const generated = appState.generatedAt
      ? format(t('m_asof'), { time: appState.generatedAt }) : t('m_asof_none');
    setMarkup(doc, 'mast-right',
      `${esc(generated)}<br>${esc(t(appState.sample ? 'm_sample' : 'm_readonly'))}`);

    const banner = doc.getElementById('error-banner');
    if (banner) banner.hidden = !appState.error;
    const sampleBanner = doc.getElementById('sample-banner');
    if (sampleBanner) sampleBanner.hidden = !appState.sample || appState.error;

    const lead = doc.getElementById('lead-title');
    if (lead) {
      if (appState.error || !appState.rows) {
        lead.textContent = t('err_lead');
      } else {
        const tally = buildTally(appState.rows);
        const emphasis = tally.bad > 0
          ? format(t('l_h_em_bad'), { bad: tally.bad }) : t('l_h_em_zero');
        const tail = tally.bad > 0 ? t('l_h_b_bad') : t('l_h_b_zero');
        lead.innerHTML = esc(format(t('l_h_a'), { accounts: appState.rows.length, dims: DIMS.length }))
          + `<i>${esc(emphasis)}</i>` + esc(tail);
      }
    }
  }

  function sourceCell(forward, t) {
    const status = forward && forward.source_status;
    if (status !== 'present' && status !== 'stale') {
      return `<span class="muted">${esc(t('v_unknown'))}</span>`;
    }
    const cls = status === 'stale' ? 'c-open' : '';
    const label = esc(t(status === 'stale' ? 'v_stale' : 'v_present'));
    const source = forward.source && forward.source.source_as_of;
    return `<span class="${cls}">${label}</span><br>`
      + (source ? `<span class="num">${esc(source)}</span>`
        : `<span class="muted">${esc(t('v_no_source'))}</span>`);
  }

  function captureCell(forward, t) {
    const source = forward && forward.source;
    if (!source) return `<span class="muted">${esc(t('v_missing'))}</span>`;
    return `<span class="num">${esc(source.capture_started_at)}</span><br>`
      + `<span class="num">${esc(source.capture_finished_at)}</span>`;
  }

  function openingCell(forward, t) {
    if (!forward) return `<span class="muted">${esc(t('v_unknown'))}</span>`;
    if (forward.baseline_status === 'present') {
      const baseline = forward.baseline && forward.baseline.source_as_of;
      return `<span>${esc(t('v_opening_present'))}</span>`
        + (baseline ? `<br><span class="num">${esc(baseline)}</span>` : '');
    }
    if (forward.baseline_status === 'missing') {
      return `<span class="c-open">${esc(t('v_opening_missing'))}</span>`;
    }
    return `<span class="muted">${esc(t('v_unknown'))}</span>`;
  }

  function laterCell(forward, t) {
    const later = forward && forward.later_anchor && forward.later_anchor.source_as_of;
    return later ? `<span class="num">${esc(later)}</span>`
      : `<span class="muted">${esc(t('v_missing'))}</span>`;
  }

  function noticeCell(forward, t) {
    const notice = forward && forward.notification;
    if (!notice || notice.status === 'unknown' || !['pending', 'confirmed'].includes(notice.status)) {
      return `<span class="muted">${esc(t('n_unknown'))}</span>`;
    }
    const label = esc(t(notice.status === 'confirmed' ? 'n_confirmed' : 'n_pending'));
    const lines = [`<span>${label}</span>`];
    if (notice.requested_at) lines.push(`<span class="num">${esc(notice.requested_at)}</span>`);
    if (notice.confirmed_at) lines.push(`<span class="num">${esc(notice.confirmed_at)}</span>`);
    return lines.join('<br>');
  }

  function renderMatrix(doc, t) {
    const headerKeys = ['col_platform', ...DIMS.map(dim => DIM_KEYS[dim])];
    const head = `<thead><tr>${headerKeys.map(key => `<th scope="col">${esc(t(key))}</th>`).join('')}</tr></thead>`;
    const body = appState.rows.map(row => {
      const cells = DIMS.map(dim => `<td>${markHtml(row.cells[dim], t, false)}</td>`).join('');
      const label = esc(format(t('account_label'), { n: row.ordinal }));
      return `<tr><th scope="row" class="pf"><b>${esc(row.platformLabel)}</b>`
        + `<span>${label}</span></th>${cells}</tr>`;
    }).join('');
    setMarkup(doc, 'mx', head + `<tbody>${body}</tbody>`);
  }

  function renderCards(doc, t) {
    const cards = appState.rows.map(row => {
      const marks = DIMS.map(dim => {
        const label = esc(t(DIM_KEYS[dim]));
        return `<div class="dimension" role="group" aria-label="${label}">`
          + `<span class="dimension-label">${label}</span>${markHtml(row.cells[dim], t, true)}</div>`;
      }).join('');
      const label = esc(format(t('account_label'), { n: row.ordinal }));
      return `<div class="card"><div class="top pf"><b>${esc(row.platformLabel)}</b>`
        + `<span>${label}</span></div><div class="row">${marks}</div></div>`;
    }).join('');
    setMarkup(doc, 'cards', cards);
  }

  function renderEvidence(doc, t) {
    const headerKeys = ['v_platform', 'v_source', 'v_captured', 'v_generated', 'v_opening', 'v_later', 'v_notice'];
    const head = `<thead><tr>${headerKeys.map(key => `<th scope="col">${esc(t(key))}</th>`).join('')}</tr></thead>`;
    const body = appState.rows.map(row => {
      const forward = row.forward;
      const label = esc(format(t('account_label'), { n: row.ordinal }));
      return `<tr><th scope="row"><b>${esc(row.platformLabel)}</b><br><span class="num">${label}</span></th>`
        + `<td>${sourceCell(forward, t)}</td>`
        + `<td>${captureCell(forward, t)}</td>`
        + `<td>${forward && forward.generated_at
          ? `<span class="num">${esc(forward.generated_at)}</span>`
          : `<span class="muted">${esc(t('v_missing'))}</span>`}</td>`
        + `<td>${openingCell(forward, t)}</td>`
        + `<td>${laterCell(forward, t)}</td>`
        + `<td>${noticeCell(forward, t)}</td></tr>`;
    }).join('');
    setMarkup(doc, 'ev', head + `<tbody>${body}</tbody>`);
  }

  function renderEntry(doc, t) {
    const labels = ['e_r1', 'e_r2', 'e_r3', 'e_r4'];
    const rows = labels.map(key => `<tr><td>${esc(t(key))}</td><td class="v">—</td></tr>`).join('');
    const total = `<tr class="tot"><td>${esc(t('e_r5'))}</td><td class="v">—</td></tr>`;
    setMarkup(doc, 'entry-body',
      `<table class="lg"><tbody>${rows}${total}</tbody></table>`
      + `<p class="empty">${esc(t('e_empty'))}</p>`);
  }

  function renderDays(doc) {
    const start = appState.rows && appState.rows.length
      ? (appState.rows.find(row => row.forward && row.forward.forward_start_date) || {}).forward
      : null;
    const startDate = start && start.forward_start_date ? start.forward_start_date : START_DATE;
    const base = Date.parse(`${startDate}T00:00:00Z`);
    const squares = [];
    for (let index = 0; index < 7; index += 1) {
      const date = new Date(base + index * 86400000);
      const day = String(date.getUTCDate()).padStart(2, '0');
      squares.push(`<span class="${index === 0 ? 'd1' : ''}" title="${date.toISOString().slice(0, 10)}">${day}</span>`);
    }
    setMarkup(doc, 'days', squares.join(''));
  }

  function renderNotes(doc, t) {
    const source = countBy(appState.rows,
      row => (row.forward && ['present', 'stale'].includes(row.forward.source_status))
        ? row.forward.source_status : 'unknown');
    const baseline = countBy(appState.rows,
      row => (row.forward && row.forward.baseline_status === 'present') ? 'present'
        : (row.forward && row.forward.baseline_status === 'missing') ? 'missing' : 'unknown');
    const notice = countBy(appState.rows,
      row => (row.forward && ['pending', 'confirmed'].includes(row.forward.notification
        && row.forward.notification.status)) ? row.forward.notification.status : 'unknown');
    const generated = appState.generatedAt || t('v_missing');
    setMarkup(doc, 'note-source', `<span class="cap">${esc(t('a_src'))}</span>`
      + `<p>${esc(format(t('a_src_body'), source))}</p>`
      + `<p class="num">${esc(format(t('a_gen'), { time: generated }))}</p>`);
    setMarkup(doc, 'note-baseline', `<span class="cap">${esc(t('a_base'))}</span>`
      + `<p>${esc(format(t('a_base_body'), baseline))}</p>`);
    setMarkup(doc, 'note-notice', `<span class="cap">${esc(t('a_notice'))}</span>`
      + `<p>${esc(format(t('a_notice_body'), notice))}</p>`);
  }

  function renderData(doc, t) {
    const tally = buildTally(appState.rows);
    setText(doc, 'n-ok', tally.ok);
    setText(doc, 'n-bad', tally.bad);
    setText(doc, 'n-open', tally.open);
    setText(doc, 'n-np', tally.np);
    const tallyBox = doc.getElementById('tally');
    if (tallyBox) tallyBox.hidden = false;
    setText(doc, 'x-cap', format(t('x_cap'),
      { cells: appState.rows.length * DIMS.length, accounts: appState.rows.length }));
    renderMatrix(doc, t);
    renderCards(doc, t);
    renderEvidence(doc, t);
    renderEntry(doc, t);
    renderDays(doc);
    renderNotes(doc, t);
  }

  function renderError(doc, t) {
    setText(doc, 'n-ok', '—');
    setText(doc, 'n-bad', '—');
    setText(doc, 'n-open', '—');
    setText(doc, 'n-np', '—');
    const tallyBox = doc.getElementById('tally');
    if (tallyBox) tallyBox.hidden = true;
    setText(doc, 'x-cap', '');
    setMarkup(doc, 'mx', '');
    setMarkup(doc, 'cards', '');
    setMarkup(doc, 'ev', '');
    setMarkup(doc, 'entry-body', '');
    setMarkup(doc, 'days', '');
    setMarkup(doc, 'note-source', '');
    setMarkup(doc, 'note-baseline', '');
    setMarkup(doc, 'note-notice', '');
    const banner = doc.getElementById('error-banner');
    if (banner) banner.hidden = false;
    setText(doc, 'error-detail', appState.errorCode === 'source_rejected'
      ? t('err_source') : t('err_api'));
  }

  function renderAll(doc) {
    const t = translator();
    try {
      renderStatic(doc, t);
      renderChrome(doc, t);
      if (appState.error || !appState.rows) {
        renderError(doc, t);
        return;
      }
      renderData(doc, t);
    } catch {
      appState.rows = null;
      appState.generatedAt = null;
      appState.error = true;
      appState.errorCode = 'render_failed';
      renderError(doc, t);
      renderChrome(doc, t);
    }
  }

  function bindToggles(doc, win) {
    if (!doc.querySelectorAll) return;
    const buttons = doc.querySelectorAll('.js-l, .js-t');
    buttons.forEach(button => {
      button.addEventListener('click', () => {
        const isLanguage = button.classList && button.classList.contains('js-l');
        const value = button.dataset ? button.dataset.v : null;
        if (isLanguage && (value === 'zh-CN' || value === 'en')) appState.lang = value;
        if (!isLanguage && (value === 'light' || value === 'dark')) appState.theme = value;
        try {
          if (win.localStorage && value) {
            win.localStorage.setItem(isLanguage ? STORAGE_LANG : STORAGE_THEME, value);
          }
        } catch { /* storage may be unavailable */ }
        renderAll(doc);
      });
    });
  }

  async function main(options = {}) {
    const doc = options.document || (typeof document !== 'undefined' ? document : null);
    const win = options.window || globalThis;
    if (!doc) return { error: true, errorCode: 'document_unavailable', rows: null, tally: null };
    const search = options.search !== undefined
      ? options.search : (typeof location !== 'undefined' ? location.search : '');
    const params = new URLSearchParams(search || '');
    appState.lang = chooseLang(params, win);
    appState.theme = chooseTheme(params, win);
    appState.now = Number.isFinite(options.now) ? options.now : Date.now();
    appState.sample = params.get('sample') === '1';
    appState.rows = null;
    appState.generatedAt = null;
    appState.error = false;
    appState.errorCode = null;
    try {
      const payload = await loadPayload(params, options.fetchImpl || win.fetch);
      appState.rows = buildRows(payload.accounts);
      appState.generatedAt = latestGenerated(appState.rows);
    } catch (error) {
      appState.rows = null;
      appState.error = true;
      appState.errorCode = error && typeof error.code === 'string' ? error.code : 'read_failed';
    }
    renderAll(doc);
    bindToggles(doc, win);
    return {
      rows: appState.rows,
      tally: appState.rows ? buildTally(appState.rows) : null,
      error: appState.error,
      errorCode: appState.errorCode,
    };
  }

  globalThis.ObservationLedger = {
    LOCALES, SAMPLE_ACCOUNTS, STATUS, DIMS, buildRows, buildTally, cellStatus, main,
  };

  if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
    main().catch(() => {
      const banner = document.getElementById('error-banner');
      if (banner) banner.hidden = false;
    });
  }
})();
