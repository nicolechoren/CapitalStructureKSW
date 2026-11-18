/*
 * capstruct.js — the finance math for the AGE capital structure app.
 *
 * Plain functions only: nothing here touches the page, so every function can
 * be checked with Node, for example:
 *   node -e "const c=require('./capstruct.js'); console.log(c.roundHalfUp(0.14025*100,2))"
 *
 * Notation (as in CLAUDE.md): T = tax rate, D = amount borrowed,
 * n = shares outstanding before any buyback, P0 = today's price, A = total book assets.
 */
(function (root) {
  'use strict';

  // ---------- CSV ----------

  // Parses CSV text into an array of objects keyed by the header row.
  // Handles quoted fields (with commas or doubled quotes inside them).
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    const src = String(text).replace(/^﻿/, '');
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (inQuotes) {
        if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { field += ch; }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field); field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && src[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }

    const nonEmpty = rows.filter(r => r.some(c => c.trim() !== ''));
    if (!nonEmpty.length) return [];
    const headers = nonEmpty[0].map(h => h.trim());
    return nonEmpty.slice(1).map(r => {
      const obj = {};
      headers.forEach((h, j) => { obj[h] = (r[j] === undefined ? '' : r[j].trim()); });
      return obj;
    });
  }

  // '' -> null, otherwise a Number (NaN if it isn't one).
  function toNumber(s) {
    if (s === null || s === undefined) return null;
    const t = String(s).trim();
    if (t === '') return null;
    return Number(t.replace(/[$,]/g, ''));
  }

  // Turns rows of {key, value} into one object, e.g. assumptions.csv -> {tax_rate: 0.4}.
  function keyValue(rows, keyCol, valueCol) {
    const out = {};
    rows.forEach(r => { out[r[keyCol]] = toNumber(r[valueCol]); });
    return out;
  }

  // ---------- Rounding (half up on the decimal value) ----------

  // toFixed rounds the binary value and gets 14.025% and $3.495 wrong;
  // toPrecision(12) first strips the binary noise, then we round half up.
  function roundHalfUp(x, d) {
    const f = Math.pow(10, d);
    const scaled = Number((x * f).toPrecision(12));
    const r = Math.sign(scaled) * Math.round(Math.abs(scaled));
    return r / f;
  }

  // ---------- Statistics ----------

  // Probability-weighted mean, standard deviation and coefficient of variation.
  function distribution(values, probs) {
    if (values.some(v => v === null)) return { mean: null, sd: null, cv: null };
    const mean = values.reduce((s, v, i) => s + probs[i] * v, 0);
    const variance = values.reduce((s, v, i) => s + probs[i] * (v - mean) * (v - mean), 0);
    const sd = Math.sqrt(variance);
    return { mean, sd, cv: mean !== 0 ? sd / mean : null };
  }

  // ---------- Question c: Firm U and Firm L ----------

  // scenarios: [{probability, sales, operating_costs}]
  function leverageExample(opts) {
    const { totalAssets, debt, interestRate, taxRate, scenarios } = opts;
    const equity = totalAssets - debt;
    const interest = interestRate * debt;
    const years = scenarios.map(s => {
      const ebit = s.sales - s.operating_costs;
      const ebt = ebit - interest;
      const taxes = taxRate * ebt;
      const netIncome = ebt - taxes;
      return {
        probability: s.probability,
        sales: s.sales,
        operatingCosts: s.operating_costs,
        ebit, interest, ebt, taxes, netIncome,
        roe: netIncome / equity,
        tie: interest > 0 ? ebit / interest : null // no interest -> n/a, not infinity
      };
    });
    const probs = years.map(y => y.probability);
    return {
      assets: totalAssets,
      debt,
      equity,
      interestRate,
      years,
      roe: distribution(years.map(y => y.roe), probs),
      tie: distribution(years.map(y => y.tie), probs)
    };
  }

  // ---------- Question d: CDSS ----------

  // cdss: object from cdss.csv (item -> value)
  function cdssEbit(cdss) {
    return cdss.sales * (1 - cdss.variable_cost_rate) - cdss.fixed_costs;
  }

  // One amount of borrowing, both buyback methods.
  // row: {debt, cost_of_debt, cost_of_equity}; ctx: {ebit, taxRate, shares, price, assets}
  function cdssAtDebt(row, ctx) {
    const D = row.debt;
    const rd = row.cost_of_debt;
    const rs = row.cost_of_equity;
    const { ebit, taxRate: T, shares: n, price: P0, assets: A } = ctx;
    if (D > 0 && (rd === null || isNaN(rd))) {
      throw new Error('The banker\'s schedule has no cost of debt at $' + D + '.');
    }
    const interest = D > 0 ? rd * D : 0;
    const netIncome = (ebit - interest) * (1 - T);
    const tie = interest > 0 ? ebit / interest : null;
    const debtCostAfterTax = D > 0 ? rd * (1 - T) : 0;

    // Case method, questions d(3) and d(4): buy back at today's price.
    const caseRepurchased = D / P0;
    const caseRemaining = n - caseRepurchased;
    const caseEps = netIncome / caseRemaining;
    const casePrice = caseEps / rs;
    const waccBook = (D / A) * debtCostAfterTax + ((A - D) / A) * rs;

    // New-price method: buy back at the price after the announcement.
    const S = netIncome / rs;
    const V = S + D;
    const newPrice = V / n;
    const newRepurchased = D / newPrice;
    const newRemaining = n - newRepurchased;
    const newEps = netIncome / newRemaining;
    const waccMarket = (D / V) * debtCostAfterTax + (S / V) * rs;

    return {
      debt: D, rd, rs, interest, netIncome, tie,
      caseMethod: {
        repurchased: caseRepurchased,
        remaining: caseRemaining,
        eps: caseEps,
        dps: caseEps, // all earnings paid out
        price: casePrice,
        wacc: waccBook
      },
      newPriceMethod: {
        equityValue: S,
        firmValue: V,
        repurchased: newRepurchased,
        remaining: newRemaining,
        eps: newEps,
        dps: newEps,
        price: newPrice,
        wacc: waccMarket,
        // Checks from CLAUDE.md
        epsCheck: Math.abs(newEps - rs * newPrice) < 1e-9 * Math.max(1, Math.abs(newEps)),
        waccCheck: Math.abs(waccMarket - ebit * (1 - T) / V) < 1e-12
      }
    };
  }

  // Index of the best row by a score; on an exact tie keep the smaller debt.
  function bestIndex(rows, score, higherIsBetter) {
    let best = -1;
    rows.forEach((r, i) => {
      const v = score(r);
      if (best === -1) { best = i; return; }
      const b = score(rows[best]);
      const better = higherIsBetter ? v > b : v < b;
      const tieSmallerDebt = v === b && r.debt < rows[best].debt;
      if (better || tieSmallerDebt) best = i;
    });
    return best;
  }

  // The full CDSS analysis across the banker's schedule.
  function cdssAnalysis(cdss, taxRate, schedule) {
    const sorted = schedule.slice().sort((a, b) => a.debt - b.debt);
    const ctx = {
      ebit: cdssEbit(cdss),
      taxRate,
      shares: cdss.shares_outstanding,
      price: cdss.share_price,
      assets: cdss.total_assets
    };
    const rows = sorted.map(r => cdssAtDebt(r, ctx));

    const pick = (fn, hi) => { const i = bestIndex(rows, fn, hi); return i === -1 ? null : rows[i].debt; };
    const summary = {
      bestPriceCase: pick(r => r.caseMethod.price, true),
      bestPriceNew: pick(r => r.newPriceMethod.price, true),
      lowestWaccBook: pick(r => r.caseMethod.wacc, false),
      lowestWaccMarket: pick(r => r.newPriceMethod.wacc, false),
      highestEpsCase: pick(r => r.caseMethod.eps, true),
      highestEpsNew: pick(r => r.newPriceMethod.eps, true)
    };
    const picks = [summary.bestPriceCase, summary.bestPriceNew, summary.lowestWaccBook, summary.lowestWaccMarket];
    summary.allAgree = picks.every(p => p === picks[0]);

    // Check: EPS / r_s with no debt should equal today's price in cdss.csv.
    const zero = rows.find(r => r.debt === 0);
    const warnings = [];
    if (!zero) {
      warnings.push('The banker\'s schedule has no $0 row, so the app can\'t check today\'s price.');
    } else if (Math.abs(zero.caseMethod.price - ctx.price) > 1e-6 * ctx.price) {
      warnings.push('With no debt, EPS / r_s = $' + roundHalfUp(zero.caseMethod.price, 2).toFixed(2) +
        ', but cdss.csv says the share price is $' + roundHalfUp(ctx.price, 2).toFixed(2) +
        '. The schedule\'s cost of equity at $0 doesn\'t match today\'s price.');
    }
    rows.forEach(r => {
      if (!r.newPriceMethod.epsCheck) warnings.push('New-price check failed at $' + r.debt + ': EPS ≠ r_s × P.');
      if (!r.newPriceMethod.waccCheck) warnings.push('New-price check failed at $' + r.debt + ': WACC ≠ EBIT(1−T)/V.');
    });

    return { inputs: ctx, rows, summary, warnings };
  }

  const api = {
    parseCSV, toNumber, keyValue, roundHalfUp, distribution,
    leverageExample, cdssEbit, cdssAtDebt, cdssAnalysis, bestIndex
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CapStruct = api;
})(typeof window !== 'undefined' ? window : this);
