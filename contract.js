/* HighGround — contracted projects: the contractor's pay applications, checked against the plan and the ledger.
   Each month the business office types four totals from the pay-app summary (contract sum with change orders, work completed
   to date, retainage held, contingency left). From those and the board version's budget for the initiative this works out
   whether the project is on budget, using its contingency faster than the work, behind its dates, and whether the ledger
   agrees with what the pay apps say has been paid. Pay-app figures are NEVER added to ledger spending: they're a check on it.
   Pure; tested by contract_test.js. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HGContract = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const num = (v) => (v === null || v === undefined || v === '' || !isFinite(Number(v)) ? null : Number(v));
  const fmt = (v) => { const s = v < 0 ? '−' : ''; v = Math.abs(v); return s + (v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1000 ? '$' + Math.round(v / 1000) + 'k' : '$' + Math.round(v)); };
  const pct = (v) => (v == null ? '' : Math.round(v * 100) + '%');
  const dayNum = (iso) => (iso ? Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5 : null);
  /* thresholds, kept together so the help text and the checks agree */
  const LIMITS = { contingencyAhead: 0.15, scheduleBehind: 0.10, booksAbs: 5000, booksRel: 0.02 };

  /** newest pay app first is not assumed: sorted by through date, then pay-app number, then when entered */
  function sorted(entries) {
    return (entries || []).slice().sort((a, b) => (a.through_date < b.through_date ? -1 : a.through_date > b.through_date ? 1 : 0)
      || ((num(a.pay_app_no) || 0) - (num(b.pay_app_no) || 0)) || String(a.entered_at || '').localeCompare(String(b.entered_at || '')));
  }

  /**
   * contract: { original_sum, original_contingency, start_date, completion_date, contractor }
   * entries: contract_progress rows
   * opts: { planned: the board version's total for the initiative (null if unknown), ledgerSpent: spending to date on the accounts
   *         linked to the initiative (null if none linked), asOf: 'YYYY-MM-DD' for the schedule check (default: the latest pay app's date) }
   */
  function status(contract, entries, opts) {
    opts = opts || {};
    const list = sorted(entries), e = list[list.length - 1] || null;
    const origSum = num(contract && contract.original_sum), origCont = num(contract && contract.original_contingency) || 0;
    const out = { hasPayApp: !!e, latest: e, flags: [], contractor: (contract && contract.contractor) || '' };
    if (!e) return out;
    const sum = num(e.contract_sum), done = num(e.completed_to_date) || 0, ret = num(e.retainage) || 0, contLeft = num(e.contingency_remaining);
    out.contractSum = sum; out.completed = done; out.retainage = ret;
    out.pctComplete = sum > 0 ? Math.min(1, done / sum) : null;
    out.changeOrders = origSum != null && sum != null ? sum - origSum : null;
    out.changeOrdersPct = out.changeOrders != null && origSum > 0 ? out.changeOrders / origSum : null;
    // contingency: left is what the summary says; used is what's gone from the original
    out.contingencyLeft = contLeft;
    out.contingencyUsedPct = origCont > 0 && contLeft != null ? Math.max(0, Math.min(1, 1 - contLeft / origCont)) : null;
    if (out.contingencyUsedPct != null && out.pctComplete != null && out.contingencyUsedPct > out.pctComplete + LIMITS.contingencyAhead)
      out.flags.push({ k: 'contingency', level: 'warn', text: `Contingency is ${pct(out.contingencyUsedPct)} used with the work ${pct(out.pctComplete)} complete.` });
    // cost: the contract today plus all the contingency that's left (the conservative view), against the board version
    out.projectedFinal = (sum || 0) + (contLeft || 0);
    const planned = num(opts.planned);
    out.planned = planned;
    if (planned != null && planned > 0.5) {
      out.overBy = out.projectedFinal - planned;
      out.cost = out.overBy > 0.5 ? 'over' : 'within';
      if (out.cost === 'over') out.flags.push({ k: 'cost', level: 'bad', text: `Projected final cost ${fmt(out.projectedFinal)} is ${fmt(out.overBy)} over the ${fmt(planned)} the board version plans.` });
    } else out.cost = 'unknown';
    // schedule: straight line between the start and completion dates
    const s0 = dayNum(contract && contract.start_date), s1 = dayNum(contract && contract.completion_date), at = dayNum(opts.asOf || e.through_date);
    if (s0 != null && s1 != null && s1 > s0 && at != null) {
      out.expectedPct = Math.max(0, Math.min(1, (at - s0) / (s1 - s0)));
      out.schedule = out.pctComplete != null && out.pctComplete < out.expectedPct - LIMITS.scheduleBehind ? 'behind' : 'on';
      if (out.schedule === 'behind') out.flags.push({ k: 'schedule', level: 'warn', text: `${pct(out.pctComplete)} complete; the dates suggest about ${pct(out.expectedPct)} by now.` });
    } else { out.expectedPct = null; out.schedule = 'unknown'; }
    // paid per the pay apps (retainage is earned but not yet paid) and what's still to pay, retainage included
    out.paid = done - ret;
    out.stillToPay = (sum || 0) - out.paid;
    // the ledger against the pay apps
    const ledger = num(opts.ledgerSpent);
    out.ledgerSpent = ledger;
    if (ledger != null) {
      const tol = Math.max(LIMITS.booksAbs, LIMITS.booksRel * Math.max(out.paid, 0));
      out.booksDiff = ledger - out.paid;
      if (Math.abs(out.booksDiff) <= tol) out.books = 'match';
      else if (ret > 0.5 && Math.abs(ledger - done) <= tol) out.books = 'match-gross';   // the ledger records retainage as spent when earned
      else {
        out.books = 'differ';
        out.flags.push({ k: 'books', level: 'warn', text: `The ledger shows ${fmt(ledger)} spent; the pay apps say ${fmt(out.paid)} paid (${fmt(Math.abs(out.booksDiff))} ${out.booksDiff > 0 ? 'more' : 'less'} in the ledger).` });
      }
    } else out.books = 'unknown';
    out.status = out.flags.some((f) => f.level === 'bad') ? 'bad' : out.flags.length ? 'warn' : 'ok';
    return out;
  }

  /** one plain sentence for the board report */
  function sentence(name, x) {
    if (!x.hasPayApp) return `${name}: no pay application recorded yet.`;
    const bits = [`${pct(x.pctComplete)} complete`];
    if (x.changeOrders != null && Math.abs(x.changeOrders) > 0.5) bits.push(`${fmt(x.changeOrders)} in change orders (${(x.changeOrdersPct * 100).toFixed(1)}%)`);
    if (x.contingencyUsedPct != null) bits.push(`contingency ${pct(x.contingencyUsedPct)} used`);
    bits.push(x.planned ? `projected ${fmt(x.projectedFinal)} against ${fmt(x.planned)} planned` : `projected ${fmt(x.projectedFinal)}`);
    return `${name} · ${bits.join(' · ')}.`;
  }

  /** checks on a pay app before it's saved: errors stop the save, warnings ask "are you sure" */
  function checkEntry(e, contract, prevEntries) {
    const errors = [], warnings = [];
    const sum = num(e.contract_sum), done = num(e.completed_to_date), ret = num(e.retainage) || 0, left = num(e.contingency_remaining);
    if (!e.through_date || !/^\d{4}-\d{2}-\d{2}$/.test(e.through_date)) errors.push('Enter the date the pay application runs through.');
    if (!(sum > 0)) errors.push('Enter the contract sum to date (the original contract plus approved change orders).');
    if (done == null || done < 0) errors.push('Enter the work completed and stored to date.');
    if (sum > 0 && done > sum + 0.5) errors.push('Work completed can’t be more than the contract sum. Check both figures on the summary.');
    if (done != null && ret > done + 0.5) errors.push('Retainage can’t be more than the work completed.');
    if (left != null && left < 0) errors.push('Contingency left can’t be negative.');
    const prev = sorted(prevEntries).pop();
    if (prev && done != null && done < num(prev.completed_to_date) - 0.5) warnings.push(`Work completed (${fmt(done)}) is less than on the last pay app (${fmt(num(prev.completed_to_date))}).`);
    if (prev && e.through_date && e.through_date < prev.through_date) warnings.push('This pay app is dated before the last one recorded.');
    const oc = num(contract && contract.original_contingency);
    if (left != null && oc != null && left > oc + 0.5) warnings.push(`Contingency left (${fmt(left)}) is more than the original contingency (${fmt(oc)}).`);
    if (done > 0 && ret / done > 0.105) warnings.push(`Retainage is ${pct(ret / done)} of the work completed; Iowa public contracts usually hold no more than 5%.`);
    return { errors, warnings };
  }

  return { status, sentence, checkEntry, sorted, LIMITS };
});
