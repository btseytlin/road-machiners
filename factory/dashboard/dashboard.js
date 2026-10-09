// Labels arrive with each snapshot from src/dashboard/labels.ts. A key with no label, like a stage from an old ledger line, shows as itself.
/** @param {Record<string, string>} labels @returns {Record<string, string>} */
function showRawKeys(labels) { return new Proxy(labels, { get: (target, key) => (typeof key === 'string' && Object.hasOwn(target, key) ? target[key] : String(key)) }); }
/** @typedef {import('../src/dashboard/analytics').PanelRows} PanelRows */
/** @typedef {NonNullable<ReturnType<typeof readOperations>>} Operations */
/** @typedef {ReturnType<typeof getRelease>} Release */
let stages = showRawKeys({});
let actions = showRawKeys({});
let reasons = showRawKeys({});
let queueNames = showRawKeys({});
let dwellNames = showRawKeys({});
let loopNames = showRawKeys({});
let gateNames = showRawKeys({});
/** @type {Record<string, string>} */
let columnNames = {};
/** @param {import('../src/dashboard/labels').Labels} labels */
function readLabels(labels) {
  stages = showRawKeys(labels.stages);
  actions = showRawKeys(labels.activities);
  reasons = showRawKeys(labels.reasons);
  queueNames = showRawKeys(labels.queues);
  dwellNames = showRawKeys(labels.dwell);
  loopNames = showRawKeys(labels.loops);
  gateNames = showRawKeys(labels.gates);
  columnNames = labels.columns;
}
const pages = new Map();
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });
/** @type {import('../src/dashboard/snapshot').Snapshot} */
let snapshot = /** @type {any} */ (null);
let selectedDays = 7;
let metric = 'cost';
let grouping = 'stage';
let connected = false;
let renderPending = false;
let renderFailed = false;
/** @type {HTMLElement | null} */
let detailOwner = null;
/** @param {string} selector @returns {HTMLElement[]} */
function queryAll(selector) { return /** @type {HTMLElement[]} */ ([...document.querySelectorAll(selector)]); }
/** @param {string} id @returns {any} The page's own ids exist, so a missing one throws at its first use. */
function getElement(id) { return document.getElementById(id); }
function createNode(tag, text = '', className = '') { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; }
function setText(id, value) { getElement(id).textContent = value; }
function formatNumber(value) { return value == null ? '—' : compact.format(value); }
function formatCost(value) { return value == null ? '—' : money.format(value); }
function formatBytes(value) { return value == null ? '—' : `${(value / 1073741824).toFixed(1)} GiB`; }
function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
function formatAge(at) {
  if (!at) return 'unknown';
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 1000));
  return seconds < 60 ? '<1m' : formatDuration(seconds * 1000);
}
function countInputTokens(tokens) { return tokens == null ? null : tokens.input + tokens.cacheRead + tokens.cacheWrite; }
function formatTokenCount(value) { return value == null ? '—' : `${formatNumber(value)} tokens`; }
function countTokens(tokens) { return tokens == null ? null : countInputTokens(tokens) + tokens.output; }
function createLink(text, href) {
  const url = new URL(href);
  if (url.protocol !== 'https:') throw new Error('Invalid public link');
  const node = createNode('a', text);
  node.href = url.href;
  node.rel = 'noopener noreferrer';
  node.dataset.key = url.href;
  return node;
}
function getIssueUrl(issue) { return `${snapshot.repoUrl}/issues/${issue}`; }
function replaceContents(id, nodes) {
  const target = getElement(id);
  const key = target.contains(document.activeElement) ? /** @type {HTMLElement} */ (document.activeElement).dataset.key : null;
  target.replaceChildren(...nodes);
  if (key) target.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
}
function requestRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    if (!snapshot) return;
    try { renderSnapshot(); renderFailed = false; }
    catch (error) { renderFailed = true; console.error('Dashboard render failed', error); setText('connection', 'Invalid data'); }
  });
}
function createPageButton(label, key, disabled, change) {
  const button = createNode('button', label === 'Previous' ? '←' : '→');
  button.setAttribute('aria-label', `${label} ${key.replaceAll('-', ' ')}`);
  button.dataset.key = `${key}-${label}`;
  button.disabled = disabled;
  button.addEventListener('click', () => { pages.set(key, (pages.get(key) ?? 0) + change); requestRender(); });
  return button;
}
function selectPage(key, rows, capacity) {
  const size = Math.max(1, capacity);
  const last = Math.max(0, Math.ceil(rows.length / size) - 1);
  const page = Math.min(pages.get(key) ?? 0, last);
  pages.set(key, page);
  const controls = rows.length > size ? [createPageButton('Previous', key, page === 0, -1), createNode('span', `${page * size + 1}–${Math.min((page + 1) * size, rows.length)} / ${rows.length}`), createPageButton('Next', key, page === last, 1)] : [];
  replaceContents(`${key}-pages`, controls);
  return rows.slice(page * size, (page + 1) * size);
}
function readTableCapacity(key) {
  const zone = getElement(`${key}-zone`);
  const header = zone.querySelector('thead').getBoundingClientRect().height;
  const row = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-height'));
  return Math.max(1, Math.floor((zone.clientHeight - header) / row));
}
function createEmptyRow(text, columnsCount) { const row = createNode('tr'); const cell = createNode('td', text, 'muted'); cell.colSpan = columnsCount; row.append(cell); return row; }
function renderTable(key, rows, renderRow, empty, columnCount) {
  const visible = selectPage(key, rows, readTableCapacity(key));
  replaceContents(`${key}-rows`, visible.length ? visible.map(renderRow) : [createEmptyRow(empty, columnCount)]);
}
function readOperations() { return snapshot.operations.value; }
function readLive() { return snapshot.live?.value ?? null; }
function readCards() { return snapshot.github.value?.cards ?? []; }
function readWorkerTitle(job) {
  if (job.issue === null) return stages[job.stage];
  const card = readCards().find((item) => item.issue === job.issue);
  return card ? `#${job.issue} ${card.title}` : `#${job.issue}`;
}
function readDoing(activity) {
  if (!activity?.activity) return 'Activity unavailable';
  if (activity.status === 'stale') return 'Activity stale';
  if (activity.phase === 'failed') return 'Command failed';
  if (activity.phase === 'completed') return 'Next operation pending';
  return formatActivity(activity);
}
function formatActivity(activity) {
  if (activity.milestone) return `${activity.milestone}: ${actions[activity.activity].toLowerCase()}`;
  return actions[activity.activity];
}
function createWorkerRow(job) {
  const row = createNode('tr');
  const title = createNode('td');
  const text = readWorkerTitle(job);
  if (job.issue === null) title.textContent = text;
  else title.append(createLink(text, getIssueUrl(job.issue)));
  const activity = readLive()?.workers.find((item) => item.key === job.key);
  const progress = activity?.progressAt ? formatAge(activity.progressAt) : '—';
  row.append(title, createNode('td', stages[job.stage]), createNode('td', readDoing(activity)), createNode('td', `${progress} / ${formatDuration(Date.now() - Date.parse(job.startedAt))}`, 'numeric'));
  row.lastChild.title = 'Time since last completed operation / total job time';
  return row;
}
function renderWorkers() {
  const operations = readOperations();
  renderTable('worker', operations?.jobs ?? [], createWorkerRow, operations ? 'No running jobs' : 'State unavailable', 4);
  renderCapacity(operations);
}
function readQueueWaits() {
  const decisions = readLive()?.scheduler?.decisions ?? [];
  return decisions.filter((item) => item.reasons.length > 0 && !item.reasons.includes('issue-running'));
}
/** @param {Operations | null} operations */
function readWaitingStatus(operations) {
  if (!operations) return 'State unavailable';
  if (operations.status === 'paused') return 'Starts paused';
  return readSchedulerAvailability(readLive()?.scheduler);
}
function readSchedulerAvailability(scheduler) {
  if (!scheduler) return 'Scheduler unavailable';
  if (scheduler.freshness !== 'ok') return 'Scheduler stale';
  if (scheduler.status !== 'ready') return readSchedulerStatus(scheduler.status);
  return null;
}
/** @param {Operations | null} operations */
function renderFreeSlots(operations) {
  if (!operations) {
    setText('free-count', '');
    return replaceContents('free-slots', [createNode('span', 'Capacity unavailable')]);
  }
  const queues = Object.entries(operations.queues);
  const total = queues.reduce((sum, [, queue]) => sum + queue.total, 0);
  const free = queues.reduce((sum, [, queue]) => sum + queue.total - queue.busy, 0);
  setText('free-count', `${snapshot.operations.status === 'ok' ? '' : 'Last known: '}${free} / ${total}`);
  const available = queues.filter(([, queue]) => queue.busy < queue.total).map(([name, queue]) => createNode('span', `${queueNames[name]}: ${queue.total - queue.busy} free`));
  replaceContents('free-slots', available.length ? available : [createNode('span', 'All slots occupied')]);
}
function createWaitingRow(item) {
  const row = createNode('div', '', 'capacity-row');
  row.append(createNode('span', item.issue === null ? stages[item.stage] : `#${item.issue} ${stages[item.stage]}`), createNode('span', item.reasons.map((reason) => reasons[reason]).join(', ')));
  return row;
}
/** @param {Operations | null} operations */
function renderCapacity(operations) {
  renderFreeSlots(operations);
  const status = readWaitingStatus(operations);
  setText('capacity-status', status ?? '');
  const waiting = status === null ? readQueueWaits() : [];
  const capacity = Math.max(1, Math.floor(getElement('capacity-rows').clientHeight / 24));
  const visible = selectPage('capacity', waiting, capacity);
  const empty = status === null ? 'No recorded waiting cards' : status === 'Starts paused' ? status : 'Reasons unavailable';
  replaceContents('capacity-rows', visible.length ? visible.map(createWaitingRow) : [createNode('p', empty, 'empty')]);
}
function renderFunnel() {
  const cards = snapshot.github.status === 'ok' ? snapshot.github.value?.cards : null;
  replaceContents('funnel', Object.keys(columnNames).map((column) => {
    const item = createNode('div');
    const value = cards ? cards.filter((card) => card.column === column).length : null;
    item.append(createNode('span', columnNames[column]), createNode('strong', formatNumber(value)));
    item.lastChild.title = value === null ? 'Unavailable' : value.toLocaleString();
    return item;
  }));
}
function getRelease() {
  const github = snapshot.github.value;
  const operations = readOperations();
  if (!github || !operations) return null;
  return github.releaseKey === operations.releaseKey ? github : null;
}
function formatReleaseGate(gate) {
  if (readOperations()?.release === null) return 'Release not cut';
  if (!gate) return 'Readiness not checked';
  if (gate.reason === 'release-tasks') return `${gate.issues.length} release tasks remain: ${gate.issues.map((issue) => `#${issue}`).join(', ')}`;
  const labels = { uncut: 'Release not cut', 'tracking-missing': 'Tracking issue unavailable', failed: 'Release job failed', playtest: 'Release playtest pending', 'playtest-blocked': 'Release playtest blocked', candidate: 'Candidate build pending', 'ship-approval': 'Needs committee ship approval' };
  return labels[gate.reason];
}
function renderRelease() {
  const release = getRelease();
  renderReleaseItems(release);
  setText('release-gate', formatReleaseGate(readLive()?.scheduler?.release));
  renderReleaseLinks(release);
  if (getElement('release-dialog').open) renderReleaseDialog(release);
}
function createReleaseItem(feature) {
  const item = createNode('li');
  item.append(createLink(`#${feature.issue} ${feature.title}`, getIssueUrl(feature.issue)));
  return item;
}
/** @param {Release | null} release */
function renderReleaseItems(release) {
  const features = release?.features ?? [];
  setText('release-count', release ? `${features.length} changes` : '');
  const visible = selectPage('release', features, 3);
  const empty = release ? 'No changes on dev' : 'Contents unavailable';
  replaceContents('release-items', visible.length ? visible.map(createReleaseItem) : [createNode('li', empty, 'muted')]);
}
function readDialogCapacity(id) {
  const list = getElement(id);
  const row = parseFloat(getComputedStyle(list).getPropertyValue('--dialog-row-height'));
  if (!Number.isFinite(row) || row <= 0) throw new Error('Invalid dialog row height');
  return Math.max(1, Math.floor(list.clientHeight / row));
}
/** @param {Release | null} release */
function renderReleaseDialog(release) {
  const features = release?.features ?? [];
  setText('release-dialog-count', release ? `${features.length} changes` : '');
  setText('release-dialog-gate', formatReleaseGate(readLive()?.scheduler?.release));
  renderReleaseDialogItems(features, release !== null);
}
function renderReleaseDialogItems(features, available) {
  const visible = selectPage('release-dialog', features, readDialogCapacity('release-dialog-rows'));
  const empty = available ? 'No changes on dev' : 'Contents unavailable';
  replaceContents('release-dialog-rows', visible.length ? visible.map(createReleaseItem) : [createNode('li', empty, 'muted')]);
}
/** @param {Release | null} release */
function renderReleaseLinks(release) {
  const operations = readOperations();
  const tracking = operations?.release;
  getElement('release-link').hidden = release === null;
  setText('release-link', tracking ? 'Tracking issue ↗' : 'Compare ↗');
  getElement('release-link').href = tracking ? getIssueUrl(tracking.issue) : `${snapshot.repoUrl}/compare/main...dev`;
  const candidateUrl = operations?.candidateUrl;
  getElement('candidate-link').hidden = !candidateUrl;
  if (candidateUrl) getElement('candidate-link').href = candidateUrl;
}
function readSchedulerStatus(status) {
  const labels = { checking: 'Checking queues', ready: 'Queues checked', paused: 'Factory paused', 'disk-low': 'Starts blocked by low disk space', failed: 'Scheduler failed' };
  return labels[status];
}
function readManagerAction(manager) {
  if (!manager) return 'Activity unavailable';
  if (manager.status !== 'ok') return 'Activity stale';
  if (manager.phase === 'completed') return `Idle for ${formatAge(manager.since)}`;
  const phase = manager.intent ? `${actions[manager.intent]}: ${actions[manager.activity].toLowerCase()}` : actions[manager.activity];
  return `${phase}, ${formatAge(manager.since)} in phase`;
}
function renderManager() {
  const live = readLive();
  const manager = live?.manager;
  setText('manager-action', readManagerAction(manager));
}
function createReading(label, value) { const node = createNode('div'); node.append(createNode('span', label), createNode('strong', value)); return node; }
function readRam(host) { const ram = host.ram.value; return ram ? `${(ram.used / 1073741824).toFixed(1)} / ${formatBytes(ram.total)}` : '—'; }
function readGpu(host) { const gpu = host.gpu.value; return gpu ? gpu.map((row) => `${row.utilization}%`).join(' / ') : '—'; }
function createResourceRow(resource) {
  const job = readOperations()?.jobs.find((item) => item.key === resource.jobId);
  const title = job ? readResourceTitle(job) : resource.service;
  const row = createNode('tr');
  row.append(createNode('td', title), createNode('td', `${resource.cpu.toFixed(1)}%`, 'numeric'), createNode('td', formatMemory(resource.memory), 'numeric'));
  return row;
}
function formatMemory(value) {
  if (value == null) return '—';
  if (value > 0 && value < 1048576) return '<1 MiB';
  return value < 1073741824 ? `${Math.round(value / 1048576)} MiB` : formatBytes(value);
}
function readResourceTitle(job) { return job.issue === null ? stages[job.stage] : `#${job.issue}`; }
function renderServer() {
  const host = snapshot.host.value;
  replaceContents('server-totals', createServerTotals(host));
  const containers = host?.containers?.value;
  const rows = containers ? [...containers].sort((a, b) => b.cpu - a.cpu) : [];
  renderTable('server', rows, createResourceRow, containers ? 'No measured containers' : 'Container readings unavailable', 3);
  setText('server-note', readStorageNote(host));
}
function createServerTotals(host) {
  if (!host) return [createReading('Readings', 'Unavailable')];
  const cpu = host.cpu.value === null ? '—' : `${host.cpu.value.toFixed(1)}%`;
  return [createReading('CPU', cpu), createReading('RAM', readRam(host)), createReading('GPU', readGpu(host))];
}
function readStorageNote(host) { return host?.ssd.value ? `Disk free ${formatBytes(host.ssd.value.free)}. Container usage only.` : 'Disk reading unavailable'; }
/** @type {Record<keyof PanelRows, string>} */
const panelTitles = {
  problems: 'Ledger check', coverage: 'Coverage', counters: 'Totals', usage_buckets: 'Usage chart', stage_time: 'Running time', waiting: 'Waiting time',
  waiting_stages: 'Waiting by stage', retries: 'Repeat attempts', stage_models: 'Tokens by stage and model', activity: 'Event log',
  delivery_coverage: 'Card coverage', lead: 'Lead time', dwell: 'Stage time', loops: 'Loops', rejections: 'Rejections', delivery_retries: 'Card retries',
};
/** @template {keyof PanelRows} K @param {K} name @param {1 | 7 | 30} days @returns {{ rows: PanelRows[K][] | null, problem: string }} */
function readPanel(name, days) {
  const result = snapshot.analytics.value?.[name];
  if (!result) return { rows: null, problem: 'Unavailable' };
  if (result.error !== null) return { rows: null, problem: `${panelTitles[name]} failed: ${result.error}` };
  return { rows: result.ranges[days], problem: '' };
}
/** @template {keyof PanelRows} K @param {K} name */
function readSelected(name) { return readPanel(name, /** @type {1 | 7 | 30} */ (selectedDays)); }
/** @template {keyof PanelRows} K @param {K} name @returns {{ row: PanelRows[K] | null, problem: string }} */
function readRow(name) { const { rows, problem } = readSelected(name); return { row: rows?.[0] ?? null, problem }; }
function createEvent(event) {
  const node = createNode('div', '', 'event');
  node.append(createNode('time', event.at.slice(11, 16)), createNode('span', `${stages[event.stage]} ${event.outcome}`));
  if (event.issue !== null) node.append(' ', createLink(`#${event.issue}`, getIssueUrl(event.issue)));
  node.title = event.at;
  return node;
}
function readEvents() { const events = readPanel('activity', 30); return snapshot.analytics.value ? events : { rows: null, problem: 'Events unavailable' }; }
function createDialogEvent(event) {
  const row = createNode('div', '', 'event-row');
  const time = createNode('time', `${event.at.slice(0, 16).replace('T', ' ')} UTC`);
  time.dateTime = event.at;
  row.append(time, createNode('span', `${stages[event.stage]} ${event.outcome}`));
  if (event.issue !== null) {
    const link = createLink(`#${event.issue}`, getIssueUrl(event.issue));
    link.dataset.key = `${event.at}-${event.stage}-${event.issue}`;
    row.append(link);
  }
  return row;
}
function renderEventDialog(events) {
  setText('event-dialog-count', events.rows ? `${events.rows.length} events` : '');
  const visible = selectPage('event-dialog', events.rows ?? [], readDialogCapacity('event-dialog-rows'));
  replaceContents('event-dialog-rows', visible.length ? visible.map(createDialogEvent) : [createNode('p', events.rows ? 'No recorded events' : events.problem, 'empty')]);
}
function renderEvents() {
  const events = readEvents();
  const width = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--event-width'));
  const capacity = Math.max(1, Math.floor(getElement('event-log').clientWidth / width));
  const visible = selectPage('event', events.rows ?? [], capacity);
  replaceContents('event-log', visible.length ? visible.map(createEvent) : [createNode('span', events.rows ? 'No recorded events' : events.problem, 'muted')]);
  if (getElement('event-dialog').open) renderEventDialog(events);
}
/** @param {PanelRows['counters']} row */
function readTokens(row) { return row.input === null ? null : { input: row.input, output: Number(row.output), cacheRead: Number(row.cache_read), cacheWrite: Number(row.cache_write) }; }
/** @param {PanelRows['counters']} row */
function readWastedTokens(row) { return row.wasted_input === null ? null : { input: row.wasted_input, output: Number(row.wasted_output), cacheRead: Number(row.wasted_cache_read), cacheWrite: Number(row.wasted_cache_write) }; }
function renderCounters() {
  const { row, problem } = readRow('counters');
  if (row) {
    renderTokenCounters(readTokens(row));
    setCounter('usage-time', formatDuration(row.worker_ms), `${row.worker_ms} ms`);
    setCounter('usage-cost', formatCost(row.cost), row.cost);
    setCounter('usage-wasted-cost', formatCost(row.wasted_cost), row.wasted_cost);
    const wasted = countTokens(readWastedTokens(row));
    setCounter('usage-wasted-tokens', formatTokenCount(wasted), wasted);
  } else for (const id of ['usage-tokens', 'usage-input', 'usage-output', 'usage-time', 'usage-cost', 'usage-wasted-cost', 'usage-wasted-tokens']) setCounter(id, '—', null);
  renderWaitCounter();
  setText('coverage', readCoverage(problem));
}
function renderWaitCounter() {
  const { row } = readRow('waiting');
  if (!row || row.waiting_ms === null || !row.span_ms) return setCounter('usage-wait', '—', null);
  setCounter('usage-wait', `${(row.waiting_ms / row.span_ms).toFixed(1)} cards`, `${formatDuration(row.waiting_ms)} summed card-time`);
}
function readHistoryParts() {
  const { row, problem } = readRow('coverage');
  if (!row) return [problem];
  return [row.since ? `History from ${row.since.slice(0, 10)} UTC` : 'No recorded history', `${row.missing_usage} runs lack token counts`];
}
function readLeftOut() {
  const { row, problem } = readRow('problems');
  if (!row) return problem;
  const left = row.unreadable + row.untimed + row.uncosted;
  return left ? `${left} ledger records left out` : '';
}
function readCoverage(countersProblem) {
  const waiting = readRow('waiting');
  const parts = [countersProblem, ...readHistoryParts(), waiting.row ? `${waiting.row.gaps} wait gaps` : waiting.problem, readLeftOut()];
  return [...new Set(parts.filter(Boolean))].join(', ');
}
function renderTokenCounters(tokens) {
  setCounter('usage-tokens', formatNumber(countTokens(tokens)), countTokens(tokens));
  setCounter('usage-input', formatNumber(countInputTokens(tokens)), countInputTokens(tokens));
  setCounter('usage-output', formatNumber(tokens?.output), tokens?.output);
}
function setCounter(id, display, exact) { setText(id, display); getElement(id).dataset.exact = exact == null ? 'Unavailable' : String(exact); }
/** @param {PanelRows['usage_buckets'][]} rows */
function readUsageSlots(rows) {
  const hourly = selectedDays === 1;
  const end = new Date(snapshot.generatedAt);
  if (hourly) end.setUTCMinutes(0, 0, 0); else end.setUTCHours(0, 0, 0, 0);
  const count = hourly ? 25 : selectedDays + 1;
  return Array.from({ length: count }, (_, index) => {
    const start = new Date(end.getTime() - (count - 1 - index) * (hourly ? 3600000 : 86400000)).toISOString().slice(0, hourly ? 13 : 10);
    return { label: hourly ? `${start.slice(11)}:00` : start.slice(5), bucket: rows.filter((row) => row.start === start) };
  });
}
/** @param {PanelRows['usage_buckets'][]} bucket @returns {Record<string, PanelRows['usage_buckets']>} */
function readSegments(bucket) { return Object.fromEntries(bucket.filter((row) => row.grouping === grouping).map((row) => [row.key, row])); }
/** @param {PanelRows['usage_buckets'][]} bucket @param {string} key */
function readSegmentValue(bucket, key) {
  if (!bucket.length || (metric === 'tokens' && bucket.every((row) => row.tokens === null))) return null;
  return readSegments(bucket)[key]?.[metric] ?? 0;
}
function readSegmentKeys(slots) {
  const totals = new Map();
  for (const slot of slots) for (const [key, segment] of Object.entries(readSegments(slot.bucket))) totals.set(key, (totals.get(key) ?? 0) + (segment[metric] ?? 0));
  return [...totals.keys()].filter((key) => totals.get(key) > 0).sort((a, b) => totals.get(b) - totals.get(a));
}
function readSegmentLabel(key) {
  if (grouping === 'stage') return stages[key];
  return key === 'unattributed' ? 'No model data' : key.replace(/^claude-/, '');
}
function formatUsageValue(value) { return metric === 'tokens' ? formatNumber(value) : formatCost(value); }
const segmentColors = ['#dac7a2', '#9db482', '#edbf78', '#e99a85', '#8fb3c4', '#b49ac4', '#c4b06a', '#7d9164', '#a5aaa7', '#c48f6a'];
const usageTooltip = {
  backgroundColor: '#171c1f', borderColor: '#dac7a2', borderWidth: 1, cornerRadius: 0, padding: 12, boxPadding: 6,
  titleColor: '#dac7a2', titleFont: { family: 'Plex', size: 12 }, bodyColor: '#e0d8ca', bodyFont: { family: 'Barlow', size: 15 }, footerColor: '#e0d8ca', footerFont: { family: 'Barlow', size: 15, weight: 'bold' },
  filter: (item) => item.raw !== null && item.raw > 0,
  itemSort: (a, b) => b.raw - a.raw,
  callbacks: {
    label: (item) => `${item.dataset.label}: ${formatUsageValue(item.raw)}`,
    footer: (items) => `Total: ${formatUsageValue(items.reduce((sum, item) => sum + item.raw, 0))}`,
  },
};
/** @type {any} */
let usageChart = null;
function createUsageChart() {
  Chart.defaults.color = '#a5aaa7';
  Chart.defaults.font.family = 'Plex';
  Chart.defaults.font.size = 10;
  return new Chart(getElement('usage-chart'), { type: 'bar', data: { labels: [], datasets: [] }, options: {
    animation: false, maintainAspectRatio: false,
    scales: { x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0 } }, y: { stacked: true, grid: { color: '#424d52' }, ticks: { callback: (value) => formatUsageValue(value) } } },
    plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { family: 'Barlow', size: 12 } } }, tooltip: usageTooltip },
    interaction: { mode: 'index', intersect: false },
  } });
}
function renderUsageChart() {
  setText('usage-title', metric === 'cost' ? 'Spend' : 'Tokens');
  usageChart ??= createUsageChart();
  const hidden = new Set(usageChart.data.datasets.filter((_, index) => !usageChart.isDatasetVisible(index)).map((dataset) => dataset.label));
  const { rows, problem } = readSelected('usage_buckets');
  const slots = rows ? readUsageSlots(rows) : [];
  const keys = readSegmentKeys(slots);
  usageChart.data.labels = slots.map((slot) => slot.label);
  usageChart.data.datasets = keys.map((key, index) => {
    const label = readSegmentLabel(key);
    return { label, hidden: hidden.has(label), data: slots.map((slot) => readSegmentValue(slot.bucket, key)), backgroundColor: segmentColors[index % segmentColors.length] };
  });
  usageChart.update();
  setText('usage-empty', rows ? 'No recorded usage' : problem);
  getElement('usage-empty').hidden = keys.length > 0;
}
/** @param {PanelRows['stage_time'][]} running @param {PanelRows['waiting_stages'][]} waiting */
function readStageRows(running, waiting) {
  const names = new Set([...running.map((row) => row.stage), ...waiting.map((row) => row.stage)]);
  return [...names].map((stage) => ({ stage, run: running.find((row) => row.stage === stage)?.worker_ms ?? 0, wait: waiting.find((row) => row.stage === stage)?.waiting_ms ?? 0 }));
}
function createStageBar(row, maximum, waitingKnown) {
  const node = createNode('div', '', 'stage-row');
  const bar = createNode('div', '', 'stage-bar');
  for (const [name, value] of [['running', row.run], ['waiting', row.wait]]) {
    const segment = createNode('span', '', name);
    segment.style.width = `${100 * value / maximum}%`;
    bar.append(segment);
  }
  const wait = waitingKnown ? formatDuration(row.wait) : '—';
  node.append(createNode('span', stages[row.stage]), bar, createNode('span', `${formatDuration(row.run)} / ${wait}`, 'stage-amount'));
  node.tabIndex = 0;
  node.dataset.detail = `${stages[row.stage]}: ${formatDuration(row.run)} running, ${wait} waiting`;
  return node;
}
function isWaitingKnown() { return readSelected('waiting_stages').rows !== null && readRow('waiting').row?.waiting_ms != null; }
function renderStageChart() {
  const running = readSelected('stage_time');
  const rows = running.rows ? readStageRows(running.rows, readSelected('waiting_stages').rows ?? []) : [];
  const waitingKnown = isWaitingKnown();
  const maximum = Math.max(1, ...rows.map((row) => row.run + row.wait));
  const capacity = Math.max(1, Math.floor(getElement('stage-chart').clientHeight / 34));
  const visible = selectPage('stage', rows, capacity);
  const empty = running.rows ? 'No measured time' : running.problem;
  replaceContents('stage-chart', visible.length ? visible.map((row) => createStageBar(row, maximum, waitingKnown)) : [createNode('p', empty, 'empty')]);
}
/** @param {PanelRows['retries']} item */
function createRetryRow(item) { const row = createNode('tr'); row.append(createNode('td', item.outcome), createNode('td', String(item.runs), 'numeric'), createNode('td', formatDuration(item.worker_ms), 'numeric'), createNode('td', formatCost(item.cost), 'numeric')); return row; }
function readStageModelLabel(stage) { return stage === null ? 'Total' : stages[stage]; }
function createStageModelCell(stage, model, usage, measure) {
  const value = usage ? measure === 'input' ? countInputTokens(usage) : usage.output : null;
  const cell = createNode('td', formatNumber(value), 'numeric');
  if (usage) cell.dataset.exact = measure === 'input'
    ? `${readStageModelLabel(stage)}, ${model}: ${value} input including ${usage.cacheRead} cache read and ${usage.cacheWrite} cache write, ${formatCost(usage.cost)} estimated cost`
    : `${readStageModelLabel(stage)}, ${model}: ${value} output`;
  return cell;
}
/** @param {PanelRows['stage_models']} row */
function readModelUsage(row) { return { stage: row.stage, model: row.model, input: row.input, output: row.output, cacheRead: row.cache_read, cacheWrite: row.cache_write, cost: row.cost }; }
/** @param {ReturnType<typeof readModelUsage>[]} rows */
function sumModels(rows) {
  const totals = new Map();
  for (const row of rows) {
    const total = totals.get(row.model) ?? { model: row.model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'cost']) total[key] += row[key];
    totals.set(row.model, total);
  }
  return [...totals.values()];
}
function createStageModelRow(stage, models, totals, stageModels) {
  const row = createNode('tr');
  row.append(createNode('td', readStageModelLabel(stage)));
  for (const model of models) {
    const usage = stage === null ? totals.find((item) => item.model === model) : stageModels.find((item) => item.stage === stage && item.model === model);
    row.append(createStageModelCell(stage, model, usage, 'input'), createStageModelCell(stage, model, usage, 'output'));
  }
  return row;
}
function readStageModelNames(rows) {
  const totals = new Map();
  for (const row of rows) totals.set(row.stage, (totals.get(row.stage) ?? 0) + countTokens(row));
  return [...totals.keys()].sort((a, b) => totals.get(b) - totals.get(a));
}
function renderStageModels() {
  const { rows, problem } = readSelected('stage_models');
  const stageModels = (rows ?? []).map(readModelUsage);
  const totals = sumModels(stageModels);
  const models = [...totals].sort((a, b) => countTokens(b) - countTokens(a)).map((item) => item.model);
  const visible = selectPage('model-column', models, 2);
  const stageHeader = createNode('th', 'Stage');
  stageHeader.rowSpan = 2;
  stageHeader.scope = 'col';
  const modelHeaders = visible.map((model) => { const header = createNode('th', model); header.colSpan = 2; header.scope = 'colgroup'; return header; });
  replaceContents('stage-model-header', [stageHeader, ...modelHeaders]);
  const measureHeaders = visible.flatMap(() => ['Input + cache', 'Output'].map((name) => { const header = createNode('th', name); header.scope = 'col'; return header; }));
  replaceContents('stage-model-measures', measureHeaders);
  const stageRows = models.length ? [null, ...readStageModelNames(stageModels)] : [];
  renderTable('stage-model', stageRows, (stage) => createStageModelRow(stage, visible, totals, stageModels), rows ? 'No measured model tokens' : problem, visible.length * 2 + 1);
}
function renderAnalytics() {
  renderCounters();
  renderUsageChart();
  renderStageChart();
  const retries = readSelected('retries');
  renderTable('retry', retries.rows ?? [], createRetryRow, retries.rows ? 'No linked repeat attempts' : retries.problem, 4);
  renderStageModels();
}
function formatRate(part, whole) { return whole ? `${Math.round(100 * part / whole)}%` : '—'; }
/** @param {PanelRows['dwell']} row @param {number} maximum */
function createDwellRow(row, maximum) {
  const node = createNode('tr');
  const bar = createNode('td', '', 'dwell-bar');
  const fill = createNode('span');
  fill.style.width = `${row.mean_ms === null ? 0 : 100 * row.mean_ms / maximum}%`;
  bar.append(fill);
  bar.setAttribute('aria-hidden', 'true');
  const open = row.open ? `${row.open}, ${formatDuration(row.open_mean_ms)}` : '0';
  node.append(createNode('td', dwellNames[row.stage]), bar, createNode('td', formatDuration(row.mean_ms), 'numeric'), createNode('td', formatDuration(row.median_ms), 'numeric'), createNode('td', String(row.count), 'numeric'), createNode('td', open, 'numeric'));
  node.lastChild.dataset.exact = `${dwellNames[row.stage]}: ${row.open} open, mean age ${formatDuration(row.open_mean_ms)}. Open stages are not in the means.`;
  return node;
}
function createLoopRow(row) { const node = createNode('tr'); node.append(createNode('td', loopNames[row.step]), createNode('td', String(row.events), 'numeric'), createNode('td', String(row.issues), 'numeric')); return node; }
function createStageRetryRow(row) { const node = createNode('tr'); node.append(createNode('td', stages[row.stage]), createNode('td', String(row.runs), 'numeric'), createNode('td', String(row.issues), 'numeric')); return node; }
/** @param {{ row: PanelRows['delivery_coverage'] | null, problem: string }} coverage */
function readDeliveryCoverage(coverage) {
  if (snapshot.analytics.status === 'unavailable') return 'Card records unavailable';
  if (!coverage.row) return coverage.problem;
  if (coverage.row.since === null) return 'No card moves recorded yet';
  const prefix = snapshot.analytics.status === 'ok' ? '' : 'Last known: ';
  return `${prefix}${coverage.row.issues} cards, records since ${coverage.row.since.slice(0, 10)} UTC`;
}
/** @param {PanelRows['delivery_coverage'] | null} coverage @param {{ row: PanelRows['lead'] | null, problem: string }} lead */
function readDeliveryNotes(coverage, lead) {
  if (!coverage || coverage.since === null) return '';
  const starts = lead.row ? `${lead.row.missing_start} merges lack a start.` : lead.problem;
  return `${coverage.legacy} cards joined before records. ${coverage.excluded} hotfix, release or private cards left out. ${starts}`;
}
function renderIssueToDev() {
  const merges = snapshot.github.value?.merges;
  const end = Date.parse(snapshot.generatedAt);
  const ages = (merges ?? []).filter((merge) => Date.parse(merge.mergedAt) > end - selectedDays * 86400000 && Date.parse(merge.mergedAt) <= end).map((merge) => Date.parse(merge.mergedAt) - Date.parse(merge.createdAt)).sort((a, b) => a - b);
  if (!ages.length) {
    const reason = merges ? 'No issue merged into dev in the period' : null;
    setCounter('issue-mean', '—', reason);
    return setCounter('issue-median', '—', reason);
  }
  const mean = ages.reduce((sum, age) => sum + age, 0) / ages.length;
  const middle = Math.floor(ages.length / 2);
  const median = ages.length % 2 ? ages[middle] : (ages[middle - 1] + ages[middle]) / 2;
  setCounter('issue-mean', formatDuration(mean), `${mean} ms mean of ${ages.length} issues`);
  setCounter('issue-median', formatDuration(median), `${median} ms median of ${ages.length} issues`);
}
function renderLeadCounter() {
  const lead = readRow('lead').row;
  if (lead) setCounter('lead-open', String(lead.open), lead.open ? `${lead.open} cards, mean age ${formatDuration(lead.open_mean_ms)}` : 0);
}
function renderRejectionCounters() {
  for (const row of readSelected('rejections').rows ?? []) {
    setCounter(`${row.gate}-rate`, formatRate(row.rejected, row.decided), `${gateNames[row.gate]}: ${row.rejected} of ${row.decided} decided cards`);
  }
}
/** @param {PanelRows['delivery_coverage'] | null} coverage */
function renderDeliveryCounters(coverage) {
  for (const id of ['lead-open', 'loop-rate', 'triage-rate', 'design-rate', 'committee-rate']) setCounter(id, '—', null);
  if (coverage?.since === null) return;
  renderLeadCounter();
  if (coverage) setCounter('loop-rate', formatRate(coverage.looped, coverage.issues), `${coverage.looped} of ${coverage.issues} cards`);
  renderRejectionCounters();
}
/** @param {boolean} noCards @param {{ rows: unknown[] | null, problem: string }} panel @param {string} empty */
function readDeliveryEmpty(noCards, panel, empty) { return noCards ? 'No card moves recorded yet' : panel.rows ? empty : panel.problem; }
/** @template T @param {boolean} noCards @param {{ rows: T[] | null }} panel @returns {T[]} */
function readDeliveryRows(noCards, panel) { return noCards ? [] : panel.rows ?? []; }
/** @param {boolean} noCards */
function renderDeliveryTables(noCards) {
  const dwell = readSelected('dwell');
  const stages = readDeliveryRows(noCards, dwell);
  const maximum = Math.max(1, ...stages.map((row) => row.mean_ms ?? 0));
  renderTable('dwell', stages, (row) => createDwellRow(row, maximum), readDeliveryEmpty(noCards, dwell, ''), 6);
  const loops = readSelected('loops');
  renderTable('loop', readDeliveryRows(noCards, loops).filter((row) => row.events > 0), createLoopRow, readDeliveryEmpty(noCards, loops, 'No card sent back in the period'), 3);
  const retries = readSelected('delivery_retries');
  renderTable('stage-retry', readDeliveryRows(noCards, retries).filter((row) => row.runs > 0), createStageRetryRow, readDeliveryEmpty(noCards, retries, 'No failed card job in the period'), 3);
}
function renderDelivery() {
  const coverage = readRow('delivery_coverage');
  setText('delivery-coverage', readDeliveryCoverage(coverage));
  getElement('delivery-coverage').dataset.exact = readDeliveryNotes(coverage.row, readRow('lead'));
  renderIssueToDev();
  renderDeliveryCounters(coverage.row);
  renderDeliveryTables(coverage.row?.since === null);
}
function readPauseNotice() {
  const operations = readOperations();
  if (operations?.status !== 'paused') return '';
  const prefix = snapshot.operations.status === 'ok' ? 'Paused' : 'Last known state: paused';
  const reason = operations.pauseReason === 'agent-usage-limit' ? 'Claude weekly usage limit reported. Awaiting quota reset or committee decision.' : 'Operator pause. No public reason recorded.';
  return `${prefix}: ${reason}`;
}
function renderFreshness() {
  if (!snapshot) return;
  if (renderFailed) return setText('connection', 'Invalid data');
  setText('connection', connected ? 'Live' : 'Reconnecting');
  /** @type {[string, import('../src/dashboard/snapshot').Source<unknown>][]} */
  const sources = [['State', snapshot.operations], ['GitHub', snapshot.github], ['Usage', snapshot.analytics], ['Host', snapshot.host], ['Activity', snapshot.live]];
  const failures = sources.filter(([, source]) => source?.status !== 'ok').map(([name, source]) => `${name} ${source?.status ?? 'unavailable'}`);
  const pause = readPauseNotice();
  setText('source-status', [pause, ...failures].filter(Boolean).join(' / '));
  getElement('source-status').classList.toggle('paused', Boolean(pause));
  getElement('connection').classList.toggle('bad', !connected);
}
function renderOverview() { renderWorkers(); renderFunnel(); renderRelease(); renderManager(); renderServer(); renderEvents(); }
function renderSnapshot() {
  getElement('github-link').href = snapshot.repoUrl;
  getElement('play-link').href = snapshot.playUrl;
  renderFreshness();
  if (!getElement('overview').hidden) renderOverview();
  if (!getElement('analytics').hidden) renderAnalytics();
  if (!getElement('delivery').hidden) renderDelivery();
  updateOverflow();
}
function updateOverflow() {
  for (const node of queryAll('td,th,.event,.capacity-row span,.clamp,.clipped,.counter strong,.funnel strong,.server-totals strong,.source-status,.release-items li')) {
    if (!node.getClientRects().length) continue;
    if (node.dataset.exact) { node.dataset.detail = node.dataset.exact; node.tabIndex = 0; continue; }
    const truncated = node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight;
    node.classList.toggle('inspect', truncated);
    if (truncated) { node.dataset.detail = node.textContent.trim(); node.tabIndex = 0; }
    else { delete node.dataset.detail; node.removeAttribute('tabindex'); }
  }
}
function showDetail(node) {
  if (!node?.dataset.detail) return;
  const tooltip = getElement('full-text');
  tooltip.textContent = node.dataset.detail;
  detailOwner = node;
  tooltip.tabIndex = 0;
  tooltip.hidden = false;
  const bounds = node.getBoundingClientRect();
  tooltip.style.left = `${Math.max(8, Math.min(bounds.left, innerWidth - tooltip.offsetWidth - 8))}px`;
  tooltip.style.top = `${Math.max(8, Math.min(bounds.bottom + 6, innerHeight - tooltip.offsetHeight - 8))}px`;
  node.setAttribute('aria-describedby', tooltip.id);
}
function hideDetail() { getElement('full-text').hidden = true; }
const tabs = [...queryAll('[role="tab"]')];
function selectTab(tab) {
  for (const choice of tabs) { const selected = choice === tab; choice.setAttribute('aria-selected', String(selected)); choice.tabIndex = selected ? 0 : -1; getElement(String(choice.getAttribute('aria-controls'))).hidden = !selected; }
  hideDetail();
  requestRender();
}
function navigateTabs(event, tab) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  let index = tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : -1);
  if (event.key === 'Home') index = 0;
  if (event.key === 'End') index = tabs.length - 1;
  const next = tabs[(index + tabs.length) % tabs.length];
  selectTab(next);
  next.focus();
}
for (const tab of tabs) { tab.addEventListener('click', () => selectTab(tab)); tab.addEventListener('keydown', (event) => navigateTabs(event, tab)); }
for (const button of queryAll('[data-dialog]')) button.addEventListener('click', () => {
  const dialog = getElement(String(button.dataset.dialog));
  dialog.showModal();
  if (dialog.id === 'release-dialog') renderReleaseDialog(getRelease());
  else renderEventDialog(readEvents());
});
for (const button of queryAll('[data-close]')) button.addEventListener('click', () => /** @type {HTMLDialogElement} */ (button.closest('dialog')).close());
function selectButtons(selector, chosen, attribute) { for (const button of queryAll(selector)) button.setAttribute('aria-pressed', String(button.dataset[attribute] === chosen)); }
for (const button of queryAll('[data-days]')) button.addEventListener('click', () => { selectedDays = Number(button.dataset.days); selectButtons('[data-days]', String(button.dataset.days), 'days'); pages.clear(); requestRender(); });
for (const button of queryAll('[data-metric]')) button.addEventListener('click', () => { metric = String(button.dataset.metric); selectButtons('[data-metric]', metric, 'metric'); requestRender(); });
for (const button of queryAll('[data-grouping]')) button.addEventListener('click', () => { grouping = String(button.dataset.grouping); selectButtons('[data-grouping]', grouping, 'grouping'); requestRender(); });
document.addEventListener('mouseover', (event) => showDetail(/** @type {HTMLElement} */ (event.target).closest('[data-detail]')));
document.addEventListener('focusin', (event) => showDetail(event.target));
document.addEventListener('mouseout', (event) => { if (event.relatedTarget !== getElement('full-text')) hideDetail(); });
document.addEventListener('focusout', (event) => { if (event.relatedTarget !== getElement('full-text')) hideDetail(); });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (document.querySelector('dialog[open]')) { hideDetail(); return; }
    detailOwner?.focus({ preventScroll: true }); hideDetail();
  }
  const target = /** @type {HTMLElement} */ (event.target);
  if (event.key === 'Enter' && target.dataset.detail) { event.preventDefault(); showDetail(target); getElement('full-text').focus(); }
});
window.addEventListener('resize', () => { hideDetail(); requestRender(); });
document.fonts.ready.then(requestRender);
const stream = new EventSource('/factory/api/events');
stream.addEventListener('snapshot', (event) => {
  try { snapshot = JSON.parse(event.data); readLabels(snapshot.labels); connected = true; requestRender(); }
  catch (error) { renderFailed = true; console.error('Invalid dashboard snapshot', error); setText('connection', 'Invalid data'); }
});
stream.addEventListener('error', () => { connected = false; setText('connection', 'Reconnecting'); });
setInterval(renderFreshness, 1000);
window.addEventListener('pagehide', () => stream.close());
