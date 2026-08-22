(function () {
  'use strict';

  var DATA = window.PARTNER_PORTAL_DATA;
  var SESSION_KEY = 'pp_session';
  var THEME_KEY = 'pp_theme';
  var TABS = [
    { id: 'dashboard', label: 'Overview' },
    { id: 'clients', label: 'My Clients' },
    { id: 'payouts', label: 'Payouts' }
  ];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatMoney(amount, currency) {
    var cur = currency && currency !== 'UNKNOWN' ? currency : '';
    if (cur === 'INR') return '\u20B9' + (amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
    if (cur === 'USD') return '$' + (amount || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
    return (cur ? cur + ' ' : '') + (amount || 0).toLocaleString();
  }

  function aggregatePayments(lists) {
    var totals = {};
    (lists || []).forEach(function (list) {
      (list || []).forEach(function (p) {
        totals[p.currency] = (totals[p.currency] || 0) + p.amount;
      });
    });
    return Object.keys(totals)
      .map(function (currency) {
        return { currency: currency, amount: totals[currency] };
      })
      .sort(function (a, b) { return b.amount - a.amount; });
  }

  function formatPayments(payments) {
    if (!payments || payments.length === 0) return '\u2014';
    return payments.map(function (p) { return formatMoney(p.amount, p.currency); }).join(' + ');
  }

  function fmtDate(d) {
    if (!d) return '\u2014';
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtTimestamp(iso) {
    if (!iso) return '\u2014';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function currentMonthKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function shiftMonth(key, delta) {
    var parts = key.split('-').map(Number);
    var d = new Date(Date.UTC(parts[0], parts[1] - 1 + delta, 1));
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
  }

  function monthLabel(key) {
    var parts = key.split('-').map(Number);
    return new Date(Date.UTC(parts[0], parts[1] - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  function monthShort(key) {
    var parts = key.split('-').map(Number);
    return new Date(Date.UTC(parts[0], parts[1] - 1, 1)).toLocaleDateString('en-US', { month: 'short' });
  }

  function getSession() {
    try {
      var id = localStorage.getItem(SESSION_KEY);
      if (!id) return null;
      var p = DATA.partners.find(function (x) { return x.id === id; });
      if (!p) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return p;
    } catch (e) {
      return null;
    }
  }

  function setSession(id) {
    localStorage.setItem(SESSION_KEY, id);
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function applyTheme(pref) {
    var root = document.documentElement;
    var theme = pref || localStorage.getItem(THEME_KEY) || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    root.classList.toggle('dark', theme === 'dark');
    return theme;
  }

  function toggleTheme() {
    var next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    render();
  }

  function termChip(t) {
    if (t.card_paused_at) return '<span class="chip chip-paused">Paused</span>';
    if (t.card_cancelled_at) return '<span class="chip chip-cancelled">Cancelled</span>';
    if (t.status === 'active') return '<span class="chip chip-active">Active</span>';
    return '<span class="chip chip-ended">Ended</span>';
  }

  function payoutChip(status) {
    if (status === 'paid') return '<span class="chip chip-paid">Paid</span>';
    if (status === 'processing') return '<span class="chip chip-processing">Processing</span>';
    return '<span class="chip chip-pending">Pending</span>';
  }

  function activeCount(partner) {
    return partner.terms.filter(function (t) { return t.status === 'active'; }).length;
  }

  function payoutFor(partner, monthKey) {
    return partner.payouts.find(function (p) { return p.month === monthKey; }) || null;
  }

  function renderLogin() {
    var options = DATA.partners.map(function (p) {
      return (
        '<button class="partner-option" data-partner="' + esc(p.id) + '">' +
          '<span class="avatar">' + esc(p.name.charAt(0)) + '</span>' +
          '<span><span class="po-name">' + esc(p.name) + '</span><br /><span class="po-sub">' +
            activeCount(p) + ' active client' + (activeCount(p) === 1 ? '' : 's') + ' \u00B7 joined ' + fmtDate(p.joined_on) +
          '</span></span>' +
          '<span class="po-arrow">\u2192</span>' +
        '</button>'
      );
    }).join('');

    return (
      '<div class="login-wrap">' +
        '<div class="login-card">' +
          '<div class="login-head">' +
            '<div class="brand-mark">S</div>' +
            '<h1>Partner Portal</h1>' +
            '<p>View your assigned clients, monthly payouts and commission status.</p>' +
          '</div>' +
          options +
          '<div class="demo-note">Demo environment \u00B7 pick an account to explore with sample data</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderTopbar(user) {
    var isDark = document.documentElement.classList.contains('dark');
    return (
      '<header class="topbar">' +
        '<span class="brand-mark">S</span>' +
        '<span class="tb-title">Partner Portal <span>\u00B7 ' + esc(monthLabel(currentMonthKey())) + '</span></span>' +
        '<span class="tb-spacer"></span>' +
        '<button class="icon-btn" id="theme-btn" aria-label="Toggle theme" title="Toggle theme">' +
          (isDark
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.3 11.3 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>') +
        '</button>' +
        '<span class="user-chip"><span class="avatar">' + esc(user.name.charAt(0)) + '</span><span class="uc-name">' + esc(user.name) + '</span></span>' +
        '<button class="signout-btn" id="signout-btn">Sign out</button>' +
      '</header>'
    );
  }

  function renderTabs(activeTab) {
    return (
      '<nav class="tabs">' +
        TABS.map(function (t) {
          return '<button class="tab-btn' + (t.id === activeTab ? ' is-active' : '') + '" data-tab="' + t.id + '">' + t.label + '</button>';
        }).join('') +
      '</nav>'
    );
  }

  function statCard(label, valueHtml, subHtml) {
    return (
      '<div class="stat-card">' +
        '<div class="sc-label">' + label + '</div>' +
        '<div class="sc-value">' + valueHtml + '</div>' +
        (subHtml ? '<div class="sc-sub">' + subHtml + '</div>' : '') +
      '</div>'
    );
  }

  function renderDashboard(user) {
    var cur = currentMonthKey();
    var thisMonth = payoutFor(user, cur);
    var thisBuckets = thisMonth ? aggregatePayments([thisMonth.lines]) : [];
    var pendingBuckets = aggregatePayments(
      user.payouts.filter(function (p) { return p.status !== 'paid'; }).map(function (p) { return p.lines; })
    );
    var year = cur.slice(0, 4);
    var ytdBuckets = aggregatePayments(
      user.payouts.filter(function (p) { return p.status === 'paid' && p.month.indexOf(year) === 0; }).map(function (p) { return p.lines; })
    );
    var actives = user.terms.filter(function (t) { return t.status === 'active'; });

    var months = [];
    for (var i = -7; i <= 0; i++) months.push(shiftMonth(cur, i));
    var series = months.map(function (m) {
      var p = payoutFor(user, m);
      var b = p ? aggregatePayments([p.lines]) : [];
      var inr = b.find(function (x) { return x.currency === 'INR'; });
      return { month: m, bucket: b, value: inr ? inr.amount : 0 };
    });
    var maxVal = Math.max.apply(null, [1].concat(series.map(function (s) { return s.value; })));
    var bars = series.map(function (s) {
      var pct = Math.max(2, Math.round((s.value / maxVal) * 100));
      return (
        '<div class="bar-col' + (s.month === cur ? ' is-current' : '') + '">' +
          '<div class="bar-value">' + (s.value ? formatMoney(s.value, 'INR') : '\u2014') + '</div>' +
          '<div class="bar-track"><div class="bar-fill" style="height:' + pct + '%" title="' + esc(monthLabel(s.month)) + ': ' + esc(formatPayments(s.bucket)) + '"></div></div>' +
          '<div class="bar-label">' + monthShort(s.month) + '</div>' +
        '</div>'
      );
    }).join('');

    var recent = user.payouts.slice(-4).reverse().map(function (p) {
      var buckets = aggregatePayments([p.lines]);
      return (
        '<tr>' +
          '<td><span class="cell-main">' + esc(monthLabel(p.month)) + '</span></td>' +
          '<td class="num">' + esc(formatPayments(buckets)) + '</td>' +
          '<td>' + payoutChip(p.status) + '</td>' +
          '<td>' + esc(p.post_date ? fmtDate(p.post_date) : 'Expected ' + fmtDate(p.expected_post_date)) + '</td>' +
        '</tr>'
      );
    }).join('');

    var thisSub = thisMonth
      ? payoutChip(thisMonth.status)
      : '<span class="chip chip-ended">No activity</span>';

    return (
      '<section class="stat-grid">' +
        statCard('August 2026 payout', esc(formatPayments(thisBuckets)), thisSub) +
        statCard('Awaiting commission', esc(formatPayments(pendingBuckets)), pendingBuckets.length ? 'Posts on the 1st' : '') +
        statCard('Earned in 2026', esc(formatPayments(ytdBuckets)), 'Paid payouts \u00B7 Jan\u2013Jul') +
        statCard('Active clients', String(actives.length), esc(user.terms.length) + ' total engagements') +
      '</section>' +
      '<div class="panel">' +
        '<div class="panel-head"><h3>Payout trend \u00B7 last 8 months</h3><span class="ph-sub">INR earnings shown</span></div>' +
        '<div class="panel-body"><div class="bar-chart">' + bars + '</div></div>' +
      '</div>' +
      '<div class="panel">' +
        '<div class="panel-head"><h3>Recent payouts</h3><button class="tab-btn is-active" data-tab="payouts" style="padding:4px 10px">View all</button></div>' +
        '<div class="table-scroll"><table class="data-table">' +
          '<thead><tr><th>Month</th><th class="num">Gross payout</th><th>Status</th><th>Posted / expected</th></tr></thead>' +
          '<tbody>' + recent + '</tbody>' +
        '</table></div>' +
      '</div>'
    );
  }

  function renderClients(user) {
    var cur = currentMonthKey();
    var filter = window.__ppClientFilter || 'all';
    var q = (window.__ppClientSearch || '').toLowerCase();

    var filtered = user.terms.filter(function (t) {
      if (filter === 'active' && t.status !== 'active') return false;
      if (filter === 'ended' && t.status === 'active') return false;
      if (q) {
        var hay = (t.business_name + ' ' + t.subscription_name + ' ' + t.plan_label).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    var rows = filtered.map(function (t) {
      var isActive = t.status === 'active';
      var pay = isActive
        ? '<span class="cell-main">' + esc(formatMoney(t.month_payment, t.currency)) + '</span>' +
          (t.additional_payment > 0
            ? '<div class="pay-extra">+' + esc(formatMoney(t.additional_payment, t.currency)) + ' \u00B7 ' + t.additional_hours + ' add\u2019l hrs</div>'
            : '')
        : '\u2014';
      var end = t.work_end_date || t.unassigned_date;
      return (
        '<tr>' +
          '<td><span class="cell-main">' + esc(t.business_name) + '</span><div class="cell-sub">' + esc(t.subscription_name || '') + '</div></td>' +
          '<td>' + esc(t.plan_label || '\u2014') + '<span class="tier-chip">' + esc(t.plan_tier || '') + '</span></td>' +
          '<td>' + termChip(t) + '</td>' +
          '<td>' + esc(fmtDate(t.work_start_date || t.assigned_date)) + '</td>' +
          '<td>' + esc(end ? fmtDate(end) : '\u2014') + '</td>' +
          '<td class="num">' + (isActive ? t.committed_weekly_hours + ' h/wk' : '\u2014') + '</td>' +
          '<td class="num">' + pay + '</td>' +
        '</tr>'
      );
    }).join('');

    return (
      '<div class="page-head">' +
        '<h2>Clients assigned to you</h2>' +
        '<span class="ph-sub">Engagement dates &amp; ' + esc(monthLabel(cur)) + ' payouts</span>' +
      '</div>' +
      '<div class="panel">' +
        '<div class="panel-head">' +
          '<div class="filters">' +
            '<span class="seg-group">' +
              ['all', 'active', 'ended'].map(function (f) {
                return '<button class="seg-btn' + (filter === f ? ' is-active' : '') + '" data-filter="' + f + '">' + f.charAt(0).toUpperCase() + f.slice(1) + '</button>';
              }).join('') +
            '</span>' +
            '<input class="search-input" id="client-search" type="search" placeholder="Search clients\u2026" value="' + esc(window.__ppClientSearch || '') + '" />' +
          '</div>' +
          '<span class="ph-sub">' + filtered.length + ' shown</span>' +
        '</div>' +
        (filtered.length
          ? '<div class="table-scroll"><table class="data-table">' +
              '<thead><tr><th>Client</th><th>Plan</th><th>Status</th><th>Start date</th><th>End date</th><th class="num">Commitment</th><th class="num">August payout</th></tr></thead>' +
              '<tbody>' + rows + '</tbody>' +
            '</table></div>'
          : '<div class="empty-state">No clients match your filters.</div>') +
      '</div>'
    );
  }

  var expandedMonths = {};

  function renderPayouts(user) {
    var rows = user.payouts.map(function (p) {
      var buckets = aggregatePayments([p.lines]);
      var postCell = p.status === 'paid'
        ? esc(fmtDate(p.post_date))
        : 'Expected ' + esc(fmtDate(p.expected_post_date));
      var isOpen = !!expandedMonths[p.month];
      var mainRow =
        '<tr class="row-click" data-month="' + esc(p.month) + '" aria-expanded="' + isOpen + '">' +
          '<td><span class="cell-main">' + esc(monthLabel(p.month)) + '</span><div class="cell-sub">' + p.lines.length + ' client' + (p.lines.length === 1 ? '' : 's') + '</div></td>' +
          '<td class="num"><span class="cell-main">' + esc(formatPayments(buckets)) + '</span></td>' +
          '<td>' + payoutChip(p.status) + '</td>' +
          '<td>' + postCell + '</td>' +
        '</tr>';
      var detailRow = isOpen
        ? '<tr><td colspan="4" class="breakdown-cell"><ul class="breakdown-list">' +
            p.lines.map(function (l) {
              return (
                '<li>' +
                  '<span class="cell-main">' + esc(l.client) + '</span>' +
                  (l.note ? '<span class="bl-note">' + esc(l.note) + '</span>' : '') +
                  '<span class="bl-amt">' + esc(formatMoney(l.amount, l.currency)) + '</span>' +
                '</li>'
              );
            }).join('') +
          '</ul></td></tr>'
        : '';
      return mainRow + detailRow;
    }).join('');

    return (
      '<div class="page-head">' +
        '<h2>Monthly payouts &amp; commission</h2>' +
        '<span class="ph-sub">Click any month to see the per-client breakdown</span>' +
      '</div>' +
      '<div class="panel">' +
        (rows
          ? '<div class="table-scroll"><table class="data-table">' +
              '<thead><tr><th>Payout month</th><th class="num">Gross payout</th><th>Commission status</th><th>Post date</th></tr></thead>' +
              '<tbody>' + rows + '</tbody>' +
            '</table></div>'
          : '<div class="empty-state">No payouts yet.</div>') +
      '</div>' +
      '<div class="footer-note">Payouts are posted on the 1st of the following month \u00B7 Demo environment \u2014 sample data only</div>'
    );
  }

  function renderApp(user, tab) {
    var content;
    if (tab === 'clients') content = renderClients(user);
    else if (tab === 'payouts') content = renderPayouts(user);
    else content = renderDashboard(user);

    return (
      '<div class="app-shell">' +
        renderTopbar(user) +
        renderTabs(tab) +
        '<main class="content" id="view">' + content + '</main>' +
        '<div class="footer-note">SquadHub Partner Portal \u00B7 Demo environment \u2014 sample data only</div>' +
      '</div>'
    );
  }

  function render() {
    var root = document.getElementById('root');
    var hash = location.hash.replace(/^#\/?/, '');
    var user = getSession();

    if (!user) {
      root.innerHTML = renderLogin();
      Array.prototype.forEach.call(root.querySelectorAll('.partner-option'), function (btn) {
        btn.addEventListener('click', function () {
          setSession(btn.getAttribute('data-partner'));
          location.hash = '#/dashboard';
          render();
        });
      });
      return;
    }

    var tab = TABS.some(function (t) { return t.id === hash; }) ? hash : 'dashboard';
    if (hash !== tab) location.hash = '#/' + tab;

    root.innerHTML = renderApp(user, tab);

    document.getElementById('theme-btn').addEventListener('click', toggleTheme);
    document.getElementById('signout-btn').addEventListener('click', function () {
      expandedMonths = {};
      window.__ppClientFilter = 'all';
      window.__ppClientSearch = '';
      clearSession();
      if (location.hash) location.hash = '';
      render();
    });

    Array.prototype.forEach.call(document.querySelectorAll('.tab-btn[data-tab]'), function (btn) {
      btn.addEventListener('click', function () {
        location.hash = '#/' + btn.getAttribute('data-tab');
      });
    });

    if (tab === 'clients') {
      Array.prototype.forEach.call(root.querySelectorAll('.seg-btn'), function (btn) {
        btn.addEventListener('click', function () {
          window.__ppClientFilter = btn.getAttribute('data-filter');
          rerenderView(user, tab);
        });
      });
      var search = root.querySelector('#client-search');
      search.addEventListener('input', function () {
        window.__ppClientSearch = search.value;
        var pos = search.selectionStart;
        rerenderView(user, tab);
        var next = document.getElementById('client-search');
        next.focus();
        next.setSelectionRange(pos, pos);
      });
    }

    if (tab === 'payouts') {
      Array.prototype.forEach.call(root.querySelectorAll('tr.row-click'), function (tr) {
        tr.addEventListener('click', function () {
          var m = tr.getAttribute('data-month');
          expandedMonths[m] = !expandedMonths[m];
          rerenderView(user, tab);
        });
      });
    }
  }

  function rerenderView(user, tab) {
    var view = document.getElementById('view');
    var html;
    if (tab === 'clients') html = renderClients(user);
    else if (tab === 'payouts') html = renderPayouts(user);
    else html = renderDashboard(user);
    view.innerHTML = html;

    if (tab === 'clients') {
      Array.prototype.forEach.call(view.querySelectorAll('.seg-btn'), function (btn) {
        btn.addEventListener('click', function () {
          window.__ppClientFilter = btn.getAttribute('data-filter');
          rerenderView(user, tab);
        });
      });
      var search = view.querySelector('#client-search');
      search.addEventListener('input', function () {
        window.__ppClientSearch = search.value;
        var pos = search.selectionStart;
        rerenderView(user, tab);
        var next = document.getElementById('client-search');
        next.focus();
        next.setSelectionRange(pos, pos);
      });
    }

    if (tab === 'payouts') {
      Array.prototype.forEach.call(view.querySelectorAll('tr.row-click'), function (tr) {
        tr.addEventListener('click', function () {
          var m = tr.getAttribute('data-month');
          expandedMonths[m] = !expandedMonths[m];
          rerenderView(user, tab);
        });
      });
      return;
    }
  }

  window.addEventListener('hashchange', render);
  applyTheme();
  render();
})();
