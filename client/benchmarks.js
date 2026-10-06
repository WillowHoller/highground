// HighGround: inline benchmark callouts. Plain browser JS, no build step.
// Usage:
//   const c = await HGBench.load({ url: SUPABASE_URL, key: SUPABASE_KEY, de: '0009', fy: 2025 });
//   HGBench.attach(document.querySelector('#gf-transport'), c['exp|General|Student Transportation']);
// Put data-measure="exp|General|Student Transportation" on any number in the page and call
// HGBench.attachAll(document, c) to decorate every number that has a callout. Numbers within
// the normal range get nothing, so pages stay as they are unless something is unusual.
(function (g) {
  async function load({ url, key, de, fy, status = 'Actual', peer = 'size', tenant = null }) {
    const r = await fetch(url + '/rest/v1/rpc/ia_benchmark', {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_de: de, p_fy: fy, p_status: status, p_peer: peer, p_tenant: tenant })
    });
    if (!r.ok) throw new Error('benchmarks ' + r.status);
    const rows = await r.json();
    const out = {};
    for (const x of rows) out[x.measure_key] = x;   // every measure; x.flag is null when unremarkable
    return out;
  }
  function attach(el, row) {
    if (!el || !row || !row.flag) return;
    const tag = document.createElement('span');
    tag.className = 'hg-callout hg-' + row.flag;     // style .hg-high / .hg-low / .hg-jump in your CSS
    tag.textContent = row.flag === 'jump' ? 'Changed' : row.flag === 'high' ? 'High vs peers' : 'Low vs peers';
    tag.title = row.callout + '. Source: Iowa Data Hub (Certified Annual Report data).';
    tag.tabIndex = 0;
    el.after(tag);
  }
  function attachAll(root, map) {
    root.querySelectorAll('[data-measure]').forEach(el => attach(el, map[el.dataset.measure]));
  }
  g.HGBench = { load, attach, attachAll };
})(window);
