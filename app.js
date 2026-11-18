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

  // ---------- CDSS ----------
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
      rows.map(x => '<tr' + (x.debt === bestDebt ? ' class="best"' : '') + '>' +
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

      // Question c
      const base = { totalAssets: example.total_assets, interestRate: example.interest_rate, taxRate, scenarios };
      const firmU = C.leverageExample(Object.assign({}, base, { debt: 0 }));
      const firmL = C.leverageExample(Object.assign({}, base, { debt: example.firm_l_debt }));
      $('firms-intro').textContent = 'Both firms have ' + dollars(example.total_assets) + ' of assets and a ' +
        pct(taxRate) + ' tax rate. Firm L borrows ' + dollars(example.firm_l_debt) + ' at ' + pct(example.interest_rate) +
        '. ROE uses book equity; TIE = EBIT / interest, so it is n/a for Firm U, which pays no interest.';
      $('firm-u-debt').textContent = 'no debt';
      $('firm-l-debt').textContent = dollars(example.firm_l_debt) + ' debt at ' + pct(example.interest_rate);
      firmTable($('firm-u'), firmU);
      firmTable($('firm-l'), firmL);
      firmStats($('firm-stats'), firmU, firmL);
      $('firms').hidden = false;

      // Question d
      const a = C.cdssAnalysis(cdss, taxRate, schedule);
      const inp = a.inputs;
      document.querySelectorAll('.p0').forEach(e => { e.textContent = cents(inp.price); });
      $('cdss-inputs').innerHTML =
        '<div><span>EBIT</span><strong>' + dollars(inp.ebit) + '</strong><small>' + dollars(cdss.sales) + ' × (1 − ' +
          pct(cdss.variable_cost_rate) + ') − ' + dollars(cdss.fixed_costs) + ', the same at every debt level</small></div>' +
        '<div><span>Shares today (n)</span><strong>' + grouped(inp.shares, 0) + '</strong></div>' +
        '<div><span>Price today (P₀)</span><strong>' + cents(inp.price) + '</strong></div>' +
        '<div><span>Book assets (A)</span><strong>' + dollars(inp.assets) + '</strong></div>' +
        '<div><span>Tax rate (T)</span><strong>' + pct(inp.taxRate) + '</strong><small>All earnings paid out, so dividends per share = EPS and g = 0</small></div>';

      scheduleTable($('case-table'), a.rows, 'caseMethod', a.summary.bestPriceCase, 'WACC (book)');
      scheduleTable($('new-table'), a.rows, 'newPriceMethod', a.summary.bestPriceNew, 'WACC (market)');
      $('cdss-summary').innerHTML = summaryHtml(a.summary);
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
