(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const form = $('#analyze-form');
  const status = $('#status');
  const reportSection = $('#report');
  let currentReport = null;
  let shownCommits = 12;
  let selectedNode = null;

  // Lightweight canvas starfield; it pauses when the page is hidden and respects reduced motion.
  const canvas = $('#stars');
  const ctx = canvas?.getContext('2d');
  let stars = [], raf = 0, lastFrame = 0;
  function resizeStars() {
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.floor(innerWidth * dpr); canvas.height = Math.floor(innerHeight * dpr);
    canvas.style.width = `${innerWidth}px`; canvas.style.height = `${innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stars = Array.from({ length: Math.min(110, Math.floor(innerWidth / 9)) }, () => ({
      x: Math.random() * innerWidth, y: Math.random() * innerHeight,
      r: Math.random() * 1.2 + .2, a: Math.random() * .45 + .12, s: Math.random() * .12 + .025
    }));
    if (reducedMotion) drawStars(0); else startStars();
  }
  function drawStars(time) {
    if (!ctx) return;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const s of stars) {
      const twinkle = reducedMotion ? 1 : .75 + Math.sin(time * .0005 + s.x) * .25;
      ctx.fillStyle = `rgba(170, 220, 255, ${s.a * twinkle})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      if (!reducedMotion) { s.y -= s.s; if (s.y < -2) { s.y = innerHeight + 2; s.x = Math.random() * innerWidth; } }
    }
  }
  function startStars(time = 0) {
    if (document.hidden || reducedMotion || raf) return;
    raf = requestAnimationFrame((now) => {
      raf = 0;
      if (now - lastFrame > 30) { drawStars(now); lastFrame = now; }
      startStars(now);
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && raf) { cancelAnimationFrame(raf); raf = 0; }
    else if (!reducedMotion) startStars();
  });
  window.addEventListener('resize', resizeStars, { passive: true }); resizeStars();

  // Scroll reveal with a no-observer fallback.
  const revealItems = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reducedMotion) {
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
    }), { threshold: .08 });
    revealItems.forEach((item) => observer.observe(item));
  } else revealItems.forEach((item) => item.classList.add('is-visible'));

  const menuButton = $('.menu-toggle');
  menuButton?.addEventListener('click', () => {
    const nav = $('.nav nav'); const open = nav.classList.toggle('open');
    menuButton.setAttribute('aria-expanded', String(open));
  });
  $('.nav nav')?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    $('.nav nav').classList.remove('open'); menuButton?.setAttribute('aria-expanded', 'false');
  }));

  const fmtDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Unknown date' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  function renderSummary(report) {
    const items = [
      ['COMMITS ANALYZED', report.summary.commits_analyzed],
      ['FILES TOUCHED', report.summary.files_touched],
      ['CONTRIBUTORS', report.summary.contributors],
      ['CO-CHANGE LINKS', report.summary.cochange_links]
    ];
    const parent = $('#summary-cards'); parent.replaceChildren();
    for (const [label, value] of items) {
      const card = el('div', 'summary-card'); card.append(el('span', '', label), el('strong', '', Number(value).toLocaleString())); parent.append(card);
    }
  }
  function renderTimeline(report) {
    const parent = $('#timeline-list'); parent.replaceChildren();
    const commits = report.timeline || [];
    $('#timeline-count').textContent = `${commits.length} RECORDS`;
    commits.slice(0, shownCommits).forEach((commit) => {
      const row = el('article', 'commit-row'); row.append(el('span', 'commit-dot'));
      const body = el('div'); const subject = el('p', 'commit-subject', commit.subject || '(no subject)');
      const meta = el('div', 'commit-meta'); meta.append(el('span', commit.short_sha, commit.short_sha), el('span', '', '·'), el('span', '', commit.author), el('span', '', '·'), el('span', '', fmtDate(commit.date)));
      if (commit.commit_url) { const a = el('a', '', 'Open commit ↗'); a.href = commit.commit_url; a.target = '_blank'; a.rel = 'noreferrer'; meta.append(a); }
      body.append(subject, meta);
      if (commit.changed_files?.length) body.append(el('div', 'commit-files', `${commit.changed_files.length} file${commit.changed_files.length === 1 ? '' : 's'} · ${commit.changed_files.slice(0, 4).join(', ')}${commit.changed_files.length > 4 ? ` +${commit.changed_files.length - 4} more` : ''}`));
      row.append(body); parent.append(row);
    });
    $('#more-commits').hidden = commits.length <= shownCommits;
  }
  function renderFiles(report) {
    const parent = $('#files-list'); parent.replaceChildren();
    const files = (report.files || []).slice(0, 12); const max = Math.max(1, ...files.map((f) => f.change_count));
    if (!files.length) { parent.append(el('p', 'graph-disclaimer', 'No changed files were recorded in the analyzed history.')); return; }
    files.forEach((file) => {
      const item = el('div', 'file-item'); const line = el('div', 'file-line');
      const path = el('span', 'file-path', file.path); path.title = file.path;
      line.append(path, el('span', 'file-count', file.change_count.toLocaleString()));
      const track = el('div', 'file-track'); const bar = el('div', 'file-bar'); bar.style.width = `${Math.max(2, file.change_count / max * 100)}%`; track.append(bar); item.append(line, track); parent.append(item);
    });
  }
  function renderGraph(report) {
    const svg = $('#cochange-graph'); const detail = $('#graph-detail'); svg.replaceChildren(); selectedNode = null;
    const nodes = report.graph?.nodes || []; const edges = report.graph?.edges || [];
    const width = Math.max(320, svg.clientWidth || 700), height = Math.max(260, svg.clientHeight || 360);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    if (!nodes.length) { detail.textContent = 'No file nodes were found in this history window.'; return; }
    const NS = 'http://www.w3.org/2000/svg';
    const make = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v)); return n; };
    const positions = new Map();
    nodes.forEach((node, i) => {
      const angle = (Math.PI * 2 * i / nodes.length) - Math.PI / 2;
      const radiusX = Math.min(width * .37, width / 2 - 60), radiusY = Math.min(height * .34, height / 2 - 35);
      positions.set(node.id, { x: width / 2 + Math.cos(angle) * Math.max(25, radiusX), y: height / 2 + Math.sin(angle) * Math.max(25, radiusY) });
    });
    const edgeEls = [];
    edges.forEach((edge) => {
      const a = positions.get(edge.source), b = positions.get(edge.target); if (!a || !b) return;
      const line = make('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'graph-edge', 'stroke-width': Math.min(4, 1 + edge.weight * .55) });
      line.dataset.source = edge.source; line.dataset.target = edge.target; line.dataset.weight = edge.weight; svg.append(line); edgeEls.push(line);
    });
    const nodeEls = new Map();
    nodes.forEach((node) => {
      const pos = positions.get(node.id); const group = make('g', { class: 'graph-node', tabindex: '0', role: 'button', 'aria-label': `${node.path}, ${node.change_count} changes` });
      const radius = Math.min(12, 5 + Math.log2(node.change_count + 1));
      group.append(make('circle', { cx: pos.x, cy: pos.y, r: radius }));
      const label = make('text', { x: pos.x, y: pos.y + radius + 13, 'text-anchor': 'middle' });
      const short = node.path.length > 19 ? `…${node.path.slice(-17)}` : node.path; label.textContent = short; label.setAttribute('title', node.path); group.append(label);
      group.addEventListener('click', () => selectNode(node)); group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNode(node); } });
      svg.append(group); nodeEls.set(node.id, group);
    });
    function selectNode(node) {
      selectedNode = node.id;
      nodeEls.forEach((g, id) => g.classList.toggle('selected', id === node.id));
      const linked = edges.filter((e) => e.source === node.id || e.target === node.id).sort((a, b) => b.weight - a.weight);
      detail.replaceChildren(); const heading = el('strong', '', node.path); detail.append(heading, document.createTextNode(` · ${node.change_count} observed file-change commits`));
      if (!linked.length) detail.append(el('p', '', 'No co-change links were observed for this file in the analyzed window.'));
      else { const list = el('ul'); linked.slice(0, 10).forEach((edge) => { const other = edge.source === node.id ? edge.target : edge.source; const li = el('li', '', `${other} — changed together in ${edge.weight} commit${edge.weight === 1 ? '' : 's'}`); list.append(li); }); detail.append(list); }
      edgeEls.forEach((line) => { const active = line.dataset.source === node.id || line.dataset.target === node.id; line.setAttribute('stroke-opacity', active ? '.95' : '.12'); });
    }
    if (nodes.length) selectNode(nodes[0]);
  }
  function renderEvidence(report) {
    const meta = $('#repo-meta'); meta.replaceChildren();
    const add = (label, value) => { const span = el('span', '', `${label}: `); const strong = el('strong', '', value || 'Not available'); strong.style.color = '#d6dcf4'; strong.style.fontWeight = '400'; span.append(strong); meta.append(span); };
    add('Branch', report.branch); add('HEAD', report.head ? report.head.slice(0, 8) : null);
    if (report.remote) { const a = el('a', '', 'Open repository ↗'); a.href = report.remote; a.target = '_blank'; a.rel = 'noreferrer'; meta.append(a); }
    const dates = report.date_range || {};
    add('Earliest', dates.earliest ? fmtDate(dates.earliest) : null); add('Latest', dates.latest ? fmtDate(dates.latest) : null);
    const list = $('#notes-list'); list.replaceChildren(); (report.notes || []).forEach((note) => list.append(el('li', '', note)));
    if (!(report.notes || []).length) list.append(el('li', '', 'No additional notes were returned by the analysis engine.'));
  }
  function renderReport(report) {
    currentReport = report; shownCommits = 12;
    $('#report-title').textContent = report.repository || 'Repository findings';
    $('#report-subtitle').textContent = `${report.summary.commits_analyzed} commits analyzed · ${report.remote || 'Local repository report'}`;
    renderSummary(report); renderTimeline(report); renderFiles(report); renderGraph(report); renderEvidence(report);
    reportSection.hidden = false;
    reportSection.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]'); const label = button.querySelector('.submit-label');
    const url = $('#repo-url').value.trim(); const maxCommits = Number($('#max-commits').value);
    status.className = 'status loading'; status.textContent = 'Preparing a temporary clone and examining commit history…';
    button.disabled = true; label.textContent = 'Excavating history…';
    try {
      const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, max_commits: maxCommits }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || `Analysis failed (HTTP ${response.status}).`);
      if (!payload.summary || !Array.isArray(payload.timeline) || !payload.graph) throw new Error('The server returned an incomplete report.');
      status.className = 'status success'; status.textContent = `Analysis complete — ${payload.summary.commits_analyzed} commits inspected.`;
      renderReport(payload);
    } catch (error) {
      status.className = 'status error'; status.textContent = error instanceof TypeError ? 'Could not reach the MINDTRACE API. Check that the server is running and try again.' : (error.message || 'Unexpected analysis error.');
    } finally { button.disabled = false; label.textContent = 'Analyze repository'; }
  });
  $('#more-commits').addEventListener('click', () => { shownCommits += 12; if (currentReport) renderTimeline(currentReport); });
  $('#clear-report').addEventListener('click', () => { reportSection.hidden = true; currentReport = null; $('#excavate').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' }); $('#repo-url').focus({ preventScroll: true }); });
  window.addEventListener('resize', () => { if (currentReport && !reportSection.hidden) renderGraph(currentReport); }, { passive: true });
})();
