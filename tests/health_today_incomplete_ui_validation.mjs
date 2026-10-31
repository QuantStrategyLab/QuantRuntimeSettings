import assert from 'node:assert/strict';
import { runActivityState, runActivityCounts, todayFailures } from '../web/strategy-switch-console/frontend/src/pages/health/status.ts';
const base = { status:'ok', activity:'read_incomplete', completeness:'incomplete', run_status:'incomplete', read_error_count:1, read_error_codes:['coverage_unconfirmed'], run_count:2, runs:[{activity:'unknown',errors_present:null},{activity:'no_rebalance',errors_present:false}] };
// Old contract: the same record with `run_status` omitted keeps classifying from
// the raw fields, so the conservative code/count/failure rules stay covered.
const legacy = {...base, run_status:undefined};
const disabled = {...base, read_error_codes:['target_disabled']};
const legacyDisabled = {...legacy, read_error_codes:['target_disabled']};
assert.equal(runActivityState(disabled), 'incomplete', 'a disabled-target diagnostic is incomplete, not a read failure or confirmed inactivity');
assert.equal(runActivityState(legacyDisabled), 'incomplete', 'old contract: a disabled target is incomplete');
assert.equal(runActivityState({...legacyDisabled,read_error_count:2,read_error_codes:['target_disabled','source_read_error']}), 'read_failed');
for (const state of ['failed','blocked']) assert.equal(runActivityState({...legacyDisabled,activity:state}), state);
assert.equal(runActivityState({...legacyDisabled,read_error_count:2}), 'unknown');
assert.deepEqual(todayFailures({status:'partial',counts:{runs:null,configured:1,observed:1},accounts:[disabled]}),{count:0,complete:false});
assert.equal(runActivityCounts([disabled]).incomplete, 1);
// A complete, clean record: the server reports success and the legacy classifier
// agrees. The new-contract fixture carries the server's own result; the old
// contract is exercised by omitting `run_status` altogether.
const cleanSuccess = { status:'ok', activity:'no_submission', completeness:'complete', run_status:'succeeded', read_error_count:0, read_error_codes:[], run_count:1, runs:[{activity:'no_submission',errors_present:false}] };
assert.equal(runActivityState({...cleanSuccess, run_status:undefined}), 'succeeded', 'old contract keeps the qualified-success rule');
assert.equal(runActivityState(cleanSuccess), 'succeeded', 'the server state for a clean record is success');
assert.equal(runActivityState(base), 'incomplete');
for (const code of ['coverage_unconfirmed','report_rejected','read_truncated','listing_truncated','schedule_unverified']) assert.equal(runActivityState({...legacy,read_error_codes:[code]}), 'incomplete', code);
for (const code of ['report_read_error','read_failed','list_failed','source_read_error']) assert.equal(runActivityState({...legacy,read_error_codes:[code]}), 'read_failed', code);
for (const [count,codes] of [[null,null],[0,[]],[2,['coverage_unconfirmed']],[2,['list_failed','unknown_code']],[1,['unknown_code']]]) assert.equal(runActivityState({...legacy,read_error_count:count,read_error_codes:codes}), 'unknown', JSON.stringify([count,codes]));
assert.equal(runActivityState({...base,activity:'failed',run_status:'failed',read_error_codes:null}), 'failed');
assert.equal(runActivityState({...base,activity:'blocked',run_status:'blocked',read_error_codes:null}), 'blocked');
assert.equal(runActivityState({...legacy,activity:'failed',read_error_codes:null}), 'failed', 'old contract: a failed activity');
assert.equal(runActivityState({...legacy,activity:'blocked',read_error_codes:null}), 'blocked', 'old contract: a blocked activity');
assert.equal(runActivityState({...base, activity:'market_closed', completeness:'complete', run_status:'not_run', read_error_count:0, read_error_codes:[], runs:[]}), 'market_closed', 'preserve the existing specific not-run label');
assert.equal(runActivityCounts([base]).incomplete, 1);
const summary={status:'partial',counts:{runs:null,configured:1,observed:1},accounts:[base]};
assert.deepEqual(todayFailures(summary),{count:0,complete:false});

// ---------------------------------------------------------------------------
// New contract vs old contract. The API already publishes `run_status`; the
// frontend consumes it instead of re-deriving the classification. A response
// without it keeps the conservative legacy classifier.
// ---------------------------------------------------------------------------
// The success baseline is the real record shape above: a partial-looking fixture
// with a null activity and no runs could not honestly claim success.
const clean = {...cleanSuccess, run_status:undefined};

assert.equal(runActivityState(clean), 'succeeded', 'old contract: a clean record keeps the qualified-success rule');
assert.equal(runActivityState({...clean, run_status:'bogus'}), 'unknown', 'a present but unrecognised run_status is unknown, never a legacy guess');
assert.equal(runActivityState({...clean, run_status:null}), 'unknown', 'a present null run_status is unknown, not the legacy contract');

// New contract: a valid API state is consumed as-is, including states the
// frontend cannot derive from activity alone.
for (const state of ['succeeded','failed','blocked','no_data','not_connected','not_run','unknown','read_failed','incomplete']) {
  assert.equal(runActivityState({...clean, run_status:state}), state, `new contract consumes ${state}`);
}
assert.equal(runActivityCounts([{...clean, run_status:'succeeded'}]).succeeded, 1);

// `not_run` carries no reason of its own, so the four activity sublabels stay
// visible; once a run exists the API state is the honest one.
for (const activity of ['market_closed','not_due','outside_window','within_grace']) {
  assert.equal(runActivityState({...clean, activity, run_count:0, runs:[], run_status:'not_run'}), activity, `not_run keeps ${activity}`);
  // The sublabel is only for a day with no run at all; a real run makes the API
  // state the honest one. (The run itself must be clean, or it declares a problem.)
  assert.equal(runActivityState({...clean, activity, run_status:'not_run', run_count:1,
    runs:[{activity:'no_rebalance', errors_present:false}]}), 'not_run', `a real run outranks the ${activity} sublabel`);
}

// Coverage metadata is not a contradiction for a recognised non-success state: a
// partial or incomplete record keeps the server's own state. This is the case the
// partial production records hit, and the frontend must not re-derive it.
for (const state of ['failed','blocked','no_data','not_connected','not_run','unknown','read_failed','incomplete']) {
  assert.equal(runActivityState({...clean, status:'partial', completeness:'incomplete', run_status:state}), state,
    `partial metadata follows the API ${state}`);
}
// Partial summary status alone never overrides a recognised state, success included.
assert.equal(runActivityState({...clean, status:'partial', run_status:'succeeded'}), 'succeeded',
  'a partial summary status alone does not override a recognised success');

// Reproduced false successes on a clean no_submission record. Only JSON absence
// is the legacy contract; a present null or empty string is unknown, and an
// optimistic success is refused when the record is incomplete or has a read error
// — the legacy classifier's own success is never passed through.
assert.equal(runActivityState({...cleanSuccess, run_status:null}), 'unknown', 'a present null run_status is not a state');
assert.equal(runActivityState({...cleanSuccess, run_status:''}), 'unknown', 'a present empty run_status is not a state');
assert.equal(runActivityState({...cleanSuccess, completeness:'incomplete', run_status:'succeeded'}), 'unknown',
  'an incomplete record cannot report success');
assert.equal(runActivityState({...cleanSuccess, read_error_count:1, read_error_codes:['unknown_code'], run_status:'succeeded'}), 'unknown',
  'a read error contradicts an optimistic success');
assert.equal(runActivityState({...cleanSuccess, status:'no_data', run_status:'succeeded'}), 'no_data',
  'an explicit no_data record cannot report success');

// Explicit failure evidence still outranks an optimistic server success. Only
// evidence counts here: a failure, a block, a read failure or a read error — not
// partial coverage.
const PROBLEMS = {
  'incomplete read': { activity:'read_incomplete', read_error_count:1, read_error_codes:['coverage_unconfirmed'] },
  'disabled target': { activity:'read_incomplete', read_error_count:1, read_error_codes:['target_disabled'] },
  'failed run': { activity:'failed', run_count:1, runs:[{activity:'failed', errors_present:true}] },
  'blocked run': { activity:'blocked', run_count:1, runs:[{activity:'blocked', errors_present:null}] },
  'read failed status': { status:'read_failed' },
  'not connected status': { status:'not_connected' },
  'unexplained read error': { read_error_count:1, read_error_codes:['unknown_code'] },
};
for (const [name, problem] of Object.entries(PROBLEMS)) {
  const state = runActivityState({...clean, ...problem, run_status:'succeeded'});
  assert.notEqual(state, 'succeeded', `a ${name} must not become success`);
}
// The contradictory-read case resolves to the conservative unknown, not success.
assert.equal(runActivityState({...clean, read_error_count:2, read_error_codes:['target_disabled'], run_status:'succeeded'}), 'unknown');

// A stale frontend vocabulary must not downgrade a known server state: an
// unrecognised read code keeps the server's non-success state instead of being
// re-derived, and an unrecognised enum never derives success from the raw fields.
assert.equal(runActivityState({...clean, run_status:'incomplete', read_error_count:1, read_error_codes:['some_future_code']}), 'incomplete', 'a known server state survives an unknown read code');
assert.equal(runActivityState({...clean, run_status:'read_failed', read_error_count:1, read_error_codes:['some_future_code']}), 'read_failed');
assert.equal(runActivityState({...cleanSuccess, run_status:'bogus'}), 'unknown', 'an unrecognised enum never derives success from the legacy fields');

// Known failure and block still outrank every read state under both contracts.
for (const state of ['failed','blocked']) {
  assert.equal(runActivityState({...clean, activity:state, run_status:state}), state);
  assert.equal(runActivityState({...clean, activity:state}), state, `legacy ${state}`);
}

// target_disabled is incomplete under both contracts; a real failure code wins.
assert.equal(runActivityState({...clean, activity:'read_incomplete', completeness:'incomplete', read_error_count:1, read_error_codes:['target_disabled'], run_status:'incomplete'}), 'incomplete');
assert.equal(runActivityState({...clean, activity:'read_incomplete', completeness:'incomplete', read_error_count:2, read_error_codes:['target_disabled','source_read_error'], run_status:'read_failed'}), 'read_failed');

// Partial summary with a null total stays incomplete-or-unknown, never complete.
assert.deepEqual(todayFailures({status:'partial',counts:{runs:null,configured:1,observed:1},
  accounts:[{...clean, run_status:'incomplete'}]}),{count:0,complete:false});
console.log('health today incomplete UI: PASS');
