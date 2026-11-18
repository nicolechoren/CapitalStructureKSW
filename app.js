/* app.js — loads data/*.csv, runs capstruct.js, and draws the page. */
(function () {
  'use strict';
  const C = window.CapStruct;
  const r = C.roundHalfUp;

  // ---------- Formatting ----------
  const grouped = (x, d) => r(x, d).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const dollars = x => (x < 0 ? '−$' : '$') + grouped(Math.abs(x), 0);
  const deduction = x => '(' + grouped(Math.abs(x), 0) + ')';
  const cents = x => (x < 0 ? '−$' : '$') + grouped(Math.abs(x), 2);
  const pct = x => (x === null ? 'n/a' : r(x * 100, 2).toFixed(2) + '%');
  const mult = x => (x === null ? 'n/a' : r(x, 2).toFixed(2) + '×');
  const num2 = x => (x === null ? 'n/a' : r(x, 2).toFixed(2));
  const shares = x => grouped(x, 2);
  const shortDebt = d => d === 0 ? '$0' : d >= 1e6 ? '$' + (d / 1e6) + 'M' : '$' + (d / 1e3) + 'K';

  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function loadCSV(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Could not load ' + path + ' (' + res.status + ').');
    return C.parseCSV(await res.text());
  }

  // Tick labels under a slider
  function ticks(el, labels) {
    el.innerHTML = labels.map(l => '<span>' + esc(l) + '</span>').join('');
  }

  // ---------- Firm U and Firm L ----------
  function firmTable(el, firm) {
    const yrs = firm.years;
    // Columns are sorted by EBIT, so with three scenarios they are bad, normal and good years.
    const labels = yrs.length === 3 ? ['Bad', 'Normal', 'Good'] : yrs.map((_, i) => 'Year ' + (i + 1));
    const head = '<thead><tr><th scope="col"></th>' + labels.map(l => '<th scope="col">' + l + '</th>').join('') + '</tr></thead>';
    const row = (label, cells, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '><th scope="row">' + label + '</th>' +
      cells.map(c => '<td>' + c + '</td>').join('') + '</tr>';
    const body = [
      row('Assets', yrs.map(() => dollars(firm.assets))),
      row('Equity', yrs.map(() => dollars(firm.equity))),
      row('Probability', yrs.map(y => num2(y.probability))),
      row('Sales', yrs.map(y => dollars(y.sales))),
      row('Oper. costs', yrs.map(y => deduction(y.operatingCosts))),
      row('EBIT', yrs.map(y => dollars(y.ebit)), 'em'),
      row('Interest', yrs.map(y => deduction(y.interest))),
      row('EBT', yrs.map(y => dollars(y.ebt))),
      row('Taxes', yrs.map(y => y.taxes < 0 ? dollars(-y.taxes) + ' credit' : deduction(y.taxes))),
      row('Net income', yrs.map(y => dollars(y.netIncome)), 'em'),
      row('ROE', yrs.map(y => pct(y.roe)), 'em'),
      row('TIE', yrs.map(y => mult(y.tie)))
    ].join('');
    el.innerHTML = head + '<tbody>' + body + '</tbody>';
  }

  function firmStats(el, u, l) {
    const row = (label, a, b) => '<tr><th scope="row">' + label + '</th><td>' + a + '</td><td>' + b + '</td></tr>';
    el.innerHTML = '<thead><tr><th scope="col"></th><th scope="col">Firm U</th><th scope="col">Firm L</th></tr></thead><tbody>' +
      row('E(ROE)', pct(u.roe.mean), pct(l.roe.mean)) +
      row('σ(ROE)', pct(u.roe.sd), pct(l.roe.sd)) +
      row('CV(ROE)', num2(u.roe.cv), num2(l.roe.cv)) +
      row('E(TIE)', mult(u.tie.mean), mult(l.tie.mean)) +
      row('σ(TIE)', mult(u.tie.sd), mult(l.tie.sd)) +
      '</tbody>';
  }

  // ---------- CDSS tables ----------
  function scheduleTable(el, rows, method, bestDebt, waccLabel) {
    const cols = [
      ['Debt', x => dollars(x.debt)],
      ['r_d', x => x.debt > 0 ? pct(x.rd) : '—'],
      ['r_s', x => pct(x.rs)],
      ['Shares repurchased', x => shares(x[method].repurchased)],
      ['Shares remaining', x => shares(x[method].remaining)],
      ['EPS', x => cents(x[method].eps)],
      ['TIE', x => mult(x.tie)],
      ['Share price', x => cents(x[method].price)],
      [waccLabel, x => pct(x[method].wacc)]
    ];
    const label = h => h.replace('r_d', 'r<sub>d</sub>').replace('r_s', 'r<sub>s</sub>');
    el.innerHTML = '<thead><tr>' + cols.map(c => '<th scope="col">' + label(c[0]) + '</th>').join('') + '</tr></thead><tbody>' +
      rows.map(x => '<tr data-debt="' + x.debt + '"' + (x.debt === bestDebt ? ' class="best"' : '') + '>' +
        cols.map((c, i) => (i === 0 ? '<th scope="row" data-label="Debt">' : '<td data-label="' + esc(c[0]) + '">') +
          c[1](x) + (i === 0 ? (x.debt === bestDebt ? ' <span class="badge">best price</span>' : '') + '</th>' : '</td>')).join('') +
        '</tr>').join('') + '</tbody>';
  }

  function summaryHtml(s) {
    const d = dollars;
    const lines = [
      ['Highest share price, case method', d(s.bestPriceCase)],
      ['Highest share price, new-price method', d(s.bestPriceNew)],
      ['Lowest WACC, book weights', d(s.lowestWaccBook)],
      ['Lowest WACC, market weights', d(s.lowestWaccMarket)],
      ['Highest EPS, case method', d(s.highestEpsCase)],
      ['Highest EPS, new-price method', d(s.highestEpsNew)]
    ];
    const verdict = s.allAgree
      ? '<p><strong>All four agree:</strong> both buyback methods give the highest price, and both sets of weights give the lowest WACC, at ' + d(s.bestPriceCase) + ' of debt.</p>'
      : '<p class="warn-inline"><strong>They don\'t all agree.</strong> The price-maximizing and WACC-minimizing amounts differ, so the page doesn\'t pick one.</p>';
    return '<h3>Which amount of borrowing?</h3><dl>' +
      lines.map(l => '<div><dt>' + l[0] + '</dt><dd>' + l[1] + '</dd></div>').join('') + '</dl>' + verdict;
  }

  // ---------- CDSS debt lever ----------
  function mgmtCell(m) {
    if (!m) return 'n/a';
    if (m.status === 'all') return '100.00%*';
    if (m.status === 'sell') return '<span class="warn-text">must sell</span>';
    return pct(m.stake);
  }

  function renderCdssLever(state) {
    const a = state.analysis;
    const x = a.rows[state.cdssIndex];
    const c = x.caseMethod;
    const n = x.newPriceMethod;
    $('cdss-value').textContent = dollars(x.debt);
    $('cdss-slider').setAttribute('aria-valuetext', dollars(x.debt));
    $('cdss-rd').textContent = x.debt > 0 ? pct(x.rd) : '—';
    $('cdss-rs').textContent = pct(x.rs);

    const row = (label, cv, nv, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '><th scope="row">' + label + '</th><td>' + cv + '</td><td>' + nv + '</td></tr>';
    $('cdss-lever').innerHTML =
      '<thead><tr><th scope="col"></th><th scope="col">Case method<small>buy back at ' + cents(a.inputs.price) + '</small></th>' +
      '<th scope="col">New-price method<small>buy back at ' + cents(n.price) + '</small></th></tr></thead><tbody>' +
      row('Share price', cents(c.price), cents(n.price), 'em') +
      row('Shares repurchased', shares(c.repurchased), shares(n.repurchased)) +
      row('Shares remaining', shares(c.remaining), shares(n.remaining)) +
      row('EPS', cents(c.eps), cents(n.eps)) +
      row('Dividends per share', cents(c.dps), cents(n.dps)) +
      row('TIE', mult(x.tie), mult(x.tie)) +
      row('WACC', pct(c.wacc) + '<small>book weights</small>', pct(n.wacc) + '<small>market weights</small>') +
      row("Management's share", mgmtCell(c.management), mgmtCell(n.management)) +
      '</tbody>';

    // Notes about management's stake
    const notes = [];
    const who = { caseMethod: 'the case method', newPriceMethod: 'the new-price method' };
    ['caseMethod', 'newPriceMethod'].forEach(k => {
      const m = x[k].management;
      if (m && m.status === 'all') notes.push('<p class="note">* Under ' + who[k] + ', the buyback takes every outside share, so management would own 100% and no outside shareholders would be left.</p>');
      if (m && m.status === 'sell') notes.push('<div class="warning">Under ' + who[k] + ', the buyback needs more shares than outside investors own, so management would have to sell some of its shares. There is no stake to show.</div>');
    });
    $('lever-mgmt-note').innerHTML = notes.join('');

    // Highlight the chosen row in both schedule tables
    document.querySelectorAll('table.schedule tbody tr').forEach(tr => {
      tr.classList.toggle('selected', Number(tr.dataset.debt) === x.debt);
    });
  }

  function setCdssDebt(state, debt) {
    const i = state.analysis.rows.findIndex(row => row.debt === debt);
    if (i === -1) return;
    state.cdssIndex = i;
    $('cdss-slider').value = String(i);
    renderCdssLever(state);
  }

  function buttonNote(kind, t) {
    const what = kind === 'price' ? 'highest share price' : 'highest EPS';
    if (t.agree) return 'Both buyback methods give the ' + what + ' at ' + dollars(t.debt) + ' of debt.';
    return 'The methods disagree: the case method gives the ' + what + ' at ' + dollars(t.caseDebt) +
      ' and the new-price method at ' + dollars(t.newDebt) + '. The slider shows the case method\'s amount.';
  }

  // ---------- Firm L lever ----------
  function renderFirmL(state) {
    const d = state.firmLDebt;
    const firmL = C.leverageExample(Object.assign({}, state.firmBase, { debt: d }));
    $('firm-l-value').textContent = dollars(d);
    $('firm-l-slider').setAttribute('aria-valuetext', dollars(d));
    $('firm-l-debt').textContent = d > 0
      ? dollars(d) + ' debt at ' + pct(state.firmBase.interestRate)
      : 'no debt (same as Firm U)';
    firmTable($('firm-l'), firmL);
    firmStats($('firm-stats'), state.firmU, firmL);
  }

  // ---------- Main ----------
  async function main() {
    try {
      const [cdssRows, assumptionRows, scheduleRows, exampleRows, scenarioRows] = await Promise.all([
        loadCSV('data/cdss.csv'),
        loadCSV('data/assumptions.csv'),
        loadCSV('data/banker_schedule.csv'),
        loadCSV('data/example_firms.csv'),
        loadCSV('data/ebit_scenarios.csv')
      ]);

      const cdss = C.keyValue(cdssRows, 'item', 'value');
      const taxRate = C.keyValue(assumptionRows, 'assumption', 'value').tax_rate;
      const example = C.keyValue(exampleRows, 'item', 'value');
      const scenarios = scenarioRows.map(s => ({
        probability: C.toNumber(s.probability),
        sales: C.toNumber(s.sales),
        operating_costs: C.toNumber(s.operating_costs)
      })).sort((a, b) => (a.sales - a.operating_costs) - (b.sales - b.operating_costs));
      const schedule = scheduleRows.map(s => ({
        debt: C.toNumber(s.debt),
        cost_of_debt: C.toNumber(s.cost_of_debt),
        cost_of_equity: C.toNumber(s.cost_of_equity)
      }));

      const state = {};

      // ----- Question c -----
      state.firmBase = { totalAssets: example.total_assets, interestRate: example.interest_rate, taxRate, scenarios };
      state.firmU = C.leverageExample(Object.assign({}, state.firmBase, { debt: 0 }));
      state.firmLDebt = example.firm_l_debt;
      $('firms-intro').textContent = 'Both firms have ' + dollars(example.total_assets) + ' of assets and a ' +
        pct(taxRate) + ' tax rate. In the case, Firm L borrows ' + dollars(example.firm_l_debt) + ' at ' + pct(example.interest_rate) +
        '. ROE uses book equity (assets − debt). TIE = EBIT / interest, so it is n/a for Firm U, which pays no interest.';
      $('firm-u-debt').textContent = 'no debt';
      firmTable($('firm-u'), state.firmU);

      const fl = $('firm-l-slider');
      fl.min = '0';
      fl.max = String(example.slider_max);
      fl.step = String(example.slider_step);
      fl.value = String(example.firm_l_debt);
      const flTicks = [];
      for (let d = 0; d <= example.slider_max + 1e-9; d += example.slider_step) flTicks.push(shortDebt(d));
      ticks($('firm-l-ticks'), flTicks);
      $('firm-l-rate-note').textContent = 'The interest rate is held at ' + pct(example.interest_rate) +
        ' at every amount, so the slider shows what debt does to Firm L\'s return and risk, not how lenders would respond.';
      fl.addEventListener('input', () => { state.firmLDebt = Number(fl.value); renderFirmL(state); });
      $('btn-case').addEventListener('click', () => {
        state.firmLDebt = example.firm_l_debt;
        fl.value = String(example.firm_l_debt);
        renderFirmL(state);
      });
      renderFirmL(state);
      $('firms').hidden = false;

      // ----- Question d -----
      const a = C.cdssAnalysis(cdss, taxRate, schedule);
      state.analysis = a;
      const inp = a.inputs;
      document.querySelectorAll('.p0').forEach(e => { e.textContent = cents(inp.price); });
      $('cdss-inputs').innerHTML =
        '<div><span>EBIT</span><strong>' + dollars(inp.ebit) + '</strong><small>' + dollars(cdss.sales) + ' × (1 − ' +
          pct(cdss.variable_cost_rate) + ') − ' + dollars(cdss.fixed_costs) + ', the same at every debt level</small></div>' +
        '<div><span>Shares today (n)</span><strong>' + grouped(inp.shares, 0) + '</strong><small>Management owns ' + pct(cdss.management_share) + '</small></div>' +
        '<div><span>Price today (P₀)</span><strong>' + cents(inp.price) + '</strong></div>' +
        '<div><span>Book assets (A)</span><strong>' + dollars(inp.assets) + '</strong></div>' +
        '<div><span>Tax rate (T)</span><strong>' + pct(inp.taxRate) + '</strong><small>All earnings paid out, so dividends per share = EPS and g = 0</small></div>';

      scheduleTable($('case-table'), a.rows, 'caseMethod', a.summary.bestPriceCase, 'WACC (book)');
      scheduleTable($('new-table'), a.rows, 'newPriceMethod', a.summary.bestPriceNew, 'WACC (market)');
      $('cdss-summary').innerHTML = summaryHtml(a.summary);

      const cs = $('cdss-slider');
      cs.max = String(a.rows.length - 1);
      ticks($('cdss-ticks'), a.rows.map(x => shortDebt(x.debt)));
      const note = $('lever-note');
      cs.addEventListener('input', () => {
        state.cdssIndex = Number(cs.value);
        note.hidden = true;
        renderCdssLever(state);
      });
      const goTo = kind => {
        const t = C.leverTarget(a.summary, kind);
        setCdssDebt(state, t.debt);
        note.textContent = buttonNote(kind, t);
        note.classList.toggle('disagree', !t.agree);
        note.hidden = false;
      };
      $('btn-best-price').addEventListener('click', () => goTo('price'));
      $('btn-highest-eps').addEventListener('click', () => goTo('eps'));
      setCdssDebt(state, a.rows[0].debt);
      $('cdss').hidden = false;

      $('warnings').innerHTML = a.warnings.map(w => '<div class="warning" role="alert">' + esc(w) + '</div>').join('');
      $('status').hidden = true;
    } catch (err) {
      const s = $('status');
      s.classList.add('error');
      s.textContent = err.message + (location.protocol === 'file:'
        ? ' This page reads its data with fetch, which browsers block for files opened directly from disk. Open it from GitHub Pages or a local web server.'
        : '');
    }
  }

  main();
})();
