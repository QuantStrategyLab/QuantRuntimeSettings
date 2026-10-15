export const PERFORMANCE_RANGES = ["1m", "3m", "ytd", "1y", "all"];
const DAY = 86_400_000;
export function dateMs(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        return NaN;
    const ms = Date.parse(`${date}T00:00:00Z`);
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date ? ms : NaN;
}
export function rangeStart(range, today) {
    const ms = dateMs(today);
    if (!Number.isFinite(ms) || range === "all")
        return "0000-01-01";
    if (range === "ytd")
        return `${today.slice(0, 4)}-01-01`;
    const date = new Date(ms);
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - (range === "1m" ? 1 : range === "3m" ? 3 : 12));
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, last));
    return date.toISOString().slice(0, 10);
}
/** Conflicting duplicate dates are omitted, never arbitrarily picked. */
export function cleanPoints(points) {
    const dates = new Map();
    for (const point of points) {
        if (!Number.isFinite(dateMs(point.date)) || !Number.isFinite(point.value))
            continue;
        const prior = dates.get(point.date);
        if (prior === undefined)
            dates.set(point.date, point);
        else if (prior === null || JSON.stringify(prior) !== JSON.stringify(point))
            dates.set(point.date, null);
    }
    return [...dates.values()].filter((p) => p !== null).sort((a, b) => a.date.localeCompare(b.date));
}
export function sliceRange(points, range, today) {
    const start = rangeStart(range, today);
    return cleanPoints(points).filter(p => p.date >= start && p.date <= today);
}
export function hasGap(previous, point) {
    return point.breakBefore === true || dateMs(point.date) - dateMs(previous.date) > DAY;
}
/** Rebase a positive index/price to percentage return; never fill missing dates. */
export function rebase(points, start) {
    const rows = cleanPoints(points).filter(p => !start || p.date >= start);
    const base = rows[0]?.value;
    if (!(base > 0))
        return [];
    return rows.map((p, i) => ({ ...p, value: i === 0 ? 0 : (p.value / base - 1) * 100,
        breakBefore: i > 0 && hasGap(rows[i - 1], p) }));
}
/** End-flow TWR: 1+r = (V_end - F_end) / V_previous. */
export function chainReturns(points) {
    const rows = cleanPoints(points);
    const index = [];
    let growth = 1;
    let unknownFlow = false;
    let invalidPeriod = false;
    if (rows.length && !(rows[0].value > 0))
        return { index, unknownFlow, invalidPeriod: true };
    for (let i = 0; i < rows.length; i++) {
        const point = rows[i];
        if (i > 0) {
            const previous = rows[i - 1];
            const known = typeof point.externalFlow === "number" && Number.isFinite(point.externalFlow);
            unknownFlow ||= !known;
            // Unknown-flow series is explicitly an unadjusted estimate in the UI.
            const end = known ? point.value - point.externalFlow : point.value;
            if (!(previous.value > 0) || end < 0) {
                invalidPeriod = true;
                break;
            }
            growth *= end / previous.value;
            if (!Number.isFinite(growth)) {
                invalidPeriod = true;
                break;
            }
        }
        index.push({ date: point.date, value: growth, breakBefore: i > 0 && hasGap(rows[i - 1], point) });
    }
    return { index, unknownFlow, invalidPeriod };
}
/** Fixed cohort: no changing membership, carry-forward, or missing-account zeros. */
export function aggregateEquity(accounts) {
    const normalized = accounts.map(a => ({ id: a.id, points: cleanPoints(a.points) }));
    const missingAccounts = normalized.filter(a => !a.points.length).map(a => a.id);
    const members = normalized.filter(a => a.points.length);
    const maps = members.map(a => new Map(a.points.map((p, i) => [p.date, { p, i }])));
    const dates = [...new Set(members.flatMap(a => a.points.map(p => p.date)))].sort();
    const points = [];
    let omittedDates = 0;
    for (const date of dates) {
        const values = maps.map(m => m.get(date));
        if (values.some(v => !v)) {
            omittedDates++;
            continue;
        }
        const previous = points.at(-1);
        const flowKnown = values.every((v, i) => v && Number.isFinite(v.p.externalFlow)
            && (!previous || members[i].points[v.i - 1]?.date === previous.date));
        points.push({ date, value: values.reduce((sum, v) => sum + v.p.value, 0),
            externalFlow: flowKnown ? values.reduce((sum, v) => sum + v.p.externalFlow, 0) : null,
            breakBefore: !!previous && (dateMs(date) - dateMs(previous.date) > DAY || values.some(v => v.p.breakBefore)) });
    }
    return { points, missingAccounts, omittedDates };
}
/** Baseline never changes when the user hides a legend entry. */
export function alignReturns(primary, comparisons) {
    const own = cleanPoints(primary);
    const available = comparisons.map(s => ({ ...s, points: cleanPoints(s.points) })).filter(s => s.points.length);
    const dates = available.map(s => new Set(s.points.map(p => p.date)));
    const common = own.find(p => p.value > 0 && dates.every(d => d.has(p.date)))?.date;
    const start = common || own[0]?.date;
    return {
        start,
        primary: rebase(own, start),
        benchmarks: common ? available.map(s => ({ ...s, points: rebase(s.points, common) })) : [],
        noCommonDate: available.length > 0 && !common,
    };
}
