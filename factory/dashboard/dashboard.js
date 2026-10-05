const stages = { triage: 'Triage', design: 'Design', implement: 'Implement', patch: 'Patch', verify: 'Verify', checks: 'Test', approve: 'Approval', adhoc: 'Private task', change: 'Factory change', candidate: 'Candidate', release: 'Release', ship: 'Ship', remove: 'Removal', incident: 'Incident', dev: 'Dev build', waste: 'Review' };
const actions = { starting: 'Starting', model: 'Waiting for model', reading: 'Reading code', editing: 'Editing code', command: 'Running command', tests: 'Running tests', typecheck: 'Typechecking', playtest: 'Running playtest', build: 'Building', publish: 'Publishing', install: 'Installing dependencies', git: 'Git operation', lock: 'Waiting for repository lock', review: 'Reviewing', design: 'Designing', investigate: 'Investigating', waiting: 'Waiting', finished: 'Finished' };
const reasons = { 'queue-full': 'Queue occupied', 'issue-running': 'Already running', 'daily-cap': 'Daily job limit', 'needs-info': 'Needs author reply', failed: 'Failed job needs attention', approval: 'Needs committee approval' };
const columns = ['Triage', 'Design', 'Implementation', 'Testing', 'Approval', 'Done'];
const queueNames = { branch: 'Branch', triage: 'Triage', design: 'Design', implement: 'Implement', verify: 'Verify', test: 'Test' };
const pages = new Map();
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });
let snapshot = null;
let selectedDays = 7;
let metric = 'cost';
let grouping = 'stage';
let connected = false;
let renderPending = false;
let renderFailed = false;
let detailOwner = null;
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
  const key = target.contains(document.activeElement) ? document.activeElement.dataset.key : null;
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
  replaceContents('funnel', columns.map((column) => {
    const item = createNode('div');
    const value = cards ? cards.filter((card) => card.column === column).length : null;
    item.append(createNode('span', column.replace('Implementation', 'Implement').replace('Testing', 'Test')), createNode('strong', formatNumber(value)));
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
  const labels = { uncut: 'Release not cut', 'tracking-missing': 'Tracking issue unavailable', failed: 'Release job failed', candidate: 'Candidate build pending', 'ship-approval': 'Needs committee ship approval' };
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
  return `${phase} · ${formatAge(manager.since)} in phase`;
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
function readSummary() { return snapshot.analytics.value?.ranges.find((range) => range.days === selectedDays) ?? null; }
function createEvent(event) {
  const node = createNode('div', '', 'event');
  node.append(createNode('time', event.at.slice(11, 16)), createNode('span', `${stages[event.stage]} ${event.outcome}`));
  if (event.issue !== null) node.append(' ', createLink(`#${event.issue}`, getIssueUrl(event.issue)));
  node.title = event.at;
  return node;
}
function readEvents() { return snapshot.analytics.value?.ranges.find((range) => range.days === 30)?.activity ?? null; }
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
  setText('event-dialog-count', events ? `${events.length} events` : '');
  const visible = selectPage('event-dialog', events ?? [], readDialogCapacity('event-dialog-rows'));
  replaceContents('event-dialog-rows', visible.length ? visible.map(createDialogEvent) : [createNode('p', events ? 'No recorded events' : 'Events unavailable', 'empty')]);
}
function renderEvents() {
  const events = readEvents();
  const width = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--event-width'));
  const capacity = Math.max(1, Math.floor(getElement('event-log').clientWidth / width));
  const visible = selectPage('event', events ?? [], capacity);
  replaceContents('event-log', visible.length ? visible.map(createEvent) : [createNode('span', events ? 'No recorded events' : 'Events unavailable', 'muted')]);
  if (getElement('event-dialog').open) renderEventDialog(events);
}
function renderCounters(summary) {
  if (!summary) return clearCounters();
  renderTokenCounters(summary.tokens);
  setCounter('usage-time', summary.since ? formatDuration(summary.workerMs) : '—', summary.since ? `${summary.workerMs} ms` : null);
  setCounter('usage-cost', formatCost(summary.cost), summary.cost);
  setCounter('usage-wasted-cost', formatCost(summary.wasted.cost), summary.wasted.cost);
  setCounter('usage-wasted-tokens', formatTokenCount(countTokens(summary.wasted.tokens)), countTokens(summary.wasted.tokens));
  setCounter('usage-wait', formatDuration(summary.waitingMs), summary.waitingMs === null ? null : `${summary.waitingMs} ms`);
  setText('coverage', summary.since ? `History from ${summary.since.slice(0, 10)} UTC · ${summary.missingUsage} runs lack token counts · ${summary.waitingGaps} wait gaps` : 'No recorded history');
}
function renderTokenCounters(tokens) {
  setCounter('usage-tokens', formatNumber(countTokens(tokens)), countTokens(tokens));
  setCounter('usage-input', formatNumber(countInputTokens(tokens)), countInputTokens(tokens));
  setCounter('usage-output', formatNumber(tokens?.output), tokens?.output);
}
function setCounter(id, display, exact) { setText(id, display); getElement(id).dataset.exact = exact == null ? 'Unavailable' : String(exact); }
function clearCounters() {
  for (const id of ['usage-tokens', 'usage-input', 'usage-output', 'usage-time', 'usage-cost', 'usage-wasted-cost', 'usage-wasted-tokens', 'usage-wait']) setCounter(id, '—', null);
  setText('coverage', 'Measurements unavailable');
}
// The 24-hour range draws one bar per UTC hour, longer ranges one bar per UTC day. A slot with no runs has no bar rather than a zero.
function readUsageSlots(summary) {
  const hourly = summary.days === 1;
  const end = new Date(snapshot.generatedAt);
  if (hourly) end.setUTCMinutes(0, 0, 0); else end.setUTCHours(0, 0, 0, 0);
  // The range starts inside the first slot, so it spans one slot more than its length.
  const count = hourly ? 25 : summary.days + 1;
  return Array.from({ length: count }, (_, index) => {
    const start = new Date(end.getTime() - (count - 1 - index) * (hourly ? 3600000 : 86400000)).toISOString().slice(0, hourly ? 13 : 10);
    return { label: hourly ? `${start.slice(11)}:00` : start.slice(5), bucket: summary.buckets.find((row) => row.start === start) ?? null };
  });
}
function readSegments(bucket) { return bucket === null ? {} : bucket[grouping === 'stage' ? 'stages' : 'models']; }
function readSegmentValue(bucket, key) {
  if (bucket === null || (metric === 'tokens' && bucket.tokens === null)) return null;
  return readSegments(bucket)[key]?.[metric] ?? 0;
}
function readSegmentKeys(slots) {
  const totals = new Map();
  for (const slot of slots) for (const [key, segment] of Object.entries(readSegments(slot.bucket))) totals.set(key, (totals.get(key) ?? 0) + segment[metric]);
  return [...totals.keys()].filter((key) => totals.get(key) > 0).sort((a, b) => totals.get(b) - totals.get(a));
}
function readSegmentLabel(key) {
  if (grouping === 'stage') return stages[key] ?? key;
  return key === 'unattributed' ? 'No model data' : key.replace(/^claude-/, '');
}
function formatUsageValue(value) { return metric === 'tokens' ? formatNumber(value) : formatCost(value); }
const segmentColors = ['#dac7a2', '#9db482', '#edbf78', '#e99a85', '#8fb3c4', '#b49ac4', '#c4b06a', '#7d9164', '#a5aaa7', '#c48f6a'];
// Matches the #full-text detail popup: dark panel, gold border, readable body text. Lists every segment of the hovered bar, largest first, then the total.
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
function renderUsageChart(summary) {
  setText('usage-title', metric === 'cost' ? 'Spend' : 'Tokens');
  usageChart ??= createUsageChart();
  const hidden = new Set(usageChart.data.datasets.filter((_, index) => !usageChart.isDatasetVisible(index)).map((dataset) => dataset.label));
  const slots = summary ? readUsageSlots(summary) : [];
  const keys = readSegmentKeys(slots);
  usageChart.data.labels = slots.map((slot) => slot.label);
  usageChart.data.datasets = keys.map((key, index) => {
    const label = readSegmentLabel(key);
    return { label, hidden: hidden.has(label), data: slots.map((slot) => readSegmentValue(slot.bucket, key)), backgroundColor: segmentColors[index % segmentColors.length] };
  });
  usageChart.update();
  getElement('usage-empty').hidden = keys.length > 0;
}
function readStageRows(summary) {
  if (!summary) return [];
  const names = new Set([...summary.stages.map((row) => row.stage), ...summary.waitingStages.map((row) => row.stage)]);
  return [...names].map((stage) => ({ stage, run: summary.stages.find((row) => row.stage === stage)?.workerMs ?? 0, wait: summary.waitingStages.find((row) => row.stage === stage)?.workerMs ?? 0 }));
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
function renderStageChart(summary) {
  const rows = readStageRows(summary);
  const maximum = Math.max(1, ...rows.map((row) => row.run + row.wait));
  const capacity = Math.max(1, Math.floor(getElement('stage-chart').clientHeight / 34));
  const visible = selectPage('stage', rows, capacity);
  replaceContents('stage-chart', visible.length ? visible.map((row) => createStageBar(row, maximum, summary.waitingMs !== null)) : [createNode('p', 'No measured time', 'empty')]);
}
function createRetryRow(item) { const row = createNode('tr'); row.append(createNode('td', item.outcome), createNode('td', String(item.runs), 'numeric'), createNode('td', formatDuration(item.workerMs), 'numeric'), createNode('td', formatCost(item.cost), 'numeric')); return row; }
function readStageModelLabel(stage) { return stage === null ? 'Total' : stage === 'verify' ? 'Verify + review' : stages[stage]; }
function createStageModelCell(stage, model, usage, measure) {
  const value = usage ? measure === 'input' ? countInputTokens(usage) : usage.output : null;
  const cell = createNode('td', formatNumber(value), 'numeric');
  if (usage) cell.dataset.exact = measure === 'input'
    ? `${readStageModelLabel(stage)} · ${model}: ${value} input including ${usage.cacheRead} cache read and ${usage.cacheWrite} cache write, ${formatCost(usage.cost)} estimated cost`
    : `${readStageModelLabel(stage)} · ${model}: ${value} output`;
  return cell;
}
function createStageModelRow(stage, models, summary) {
  const row = createNode('tr');
  row.append(createNode('td', readStageModelLabel(stage)));
  for (const model of models) {
    const usage = stage === null ? summary.models.find((item) => item.model === model) : summary.stageModels.find((item) => item.stage === stage && item.model === model);
    row.append(createStageModelCell(stage, model, usage, 'input'), createStageModelCell(stage, model, usage, 'output'));
  }
  return row;
}
function readStageModelNames(rows) {
  const totals = new Map();
  for (const row of rows) totals.set(row.stage, (totals.get(row.stage) ?? 0) + countTokens(row));
  return [...totals.keys()].sort((a, b) => totals.get(b) - totals.get(a));
}
function renderStageModels(summary) {
  // Two model columns fit beside stage names at the narrowest desktop width.
  const models = summary ? [...summary.models].sort((a, b) => countTokens(b) - countTokens(a)).map((item) => item.model) : [];
  const visible = selectPage('model-column', models, 2);
  const stageHeader = createNode('th', 'Stage');
  stageHeader.rowSpan = 2;
  stageHeader.scope = 'col';
  const modelHeaders = visible.map((model) => { const header = createNode('th', model); header.colSpan = 2; header.scope = 'colgroup'; return header; });
  replaceContents('stage-model-header', [stageHeader, ...modelHeaders]);
  const measureHeaders = visible.flatMap(() => ['Input + cache', 'Output'].map((name) => { const header = createNode('th', name); header.scope = 'col'; return header; }));
  replaceContents('stage-model-measures', measureHeaders);
  const rows = models.length ? [null, ...readStageModelNames(summary.stageModels)] : [];
  renderTable('stage-model', rows, (stage) => createStageModelRow(stage, visible, summary), summary ? 'No measured model tokens' : 'Unavailable', visible.length * 2 + 1);
}
function renderAnalytics() {
  const summary = readSummary();
  renderCounters(summary);
  renderUsageChart(summary);
  renderStageChart(summary);
  renderTable('retry', summary?.retries ?? [], createRetryRow, summary ? 'No linked repeat attempts' : 'Unavailable', 4);
  renderStageModels(summary);
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
  // Stale sources are listed in source-status, so a healthy connection needs no ticking age.
  setText('connection', connected ? 'Live' : 'Reconnecting');
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
  updateOverflow();
}
function updateOverflow() {
  for (const node of document.querySelectorAll('td,th,.event,.capacity-row span,.clamp,.clipped,.counter strong,.funnel strong,.server-totals strong,.source-status,.release-items li')) {
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
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab) {
  for (const choice of tabs) { const selected = choice === tab; choice.setAttribute('aria-selected', String(selected)); choice.tabIndex = selected ? 0 : -1; getElement(choice.getAttribute('aria-controls')).hidden = !selected; }
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
for (const button of document.querySelectorAll('[data-dialog]')) button.addEventListener('click', () => {
  const dialog = getElement(button.dataset.dialog);
  dialog.showModal();
  if (dialog.id === 'release-dialog') renderReleaseDialog(getRelease());
  else renderEventDialog(readEvents());
});
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close());
function selectButtons(selector, chosen, attribute) { for (const button of document.querySelectorAll(selector)) button.setAttribute('aria-pressed', String(button.dataset[attribute] === chosen)); }
for (const button of document.querySelectorAll('[data-days]')) button.addEventListener('click', () => { selectedDays = Number(button.dataset.days); selectButtons('[data-days]', button.dataset.days, 'days'); pages.clear(); requestRender(); });
for (const button of document.querySelectorAll('[data-metric]')) button.addEventListener('click', () => { metric = button.dataset.metric; selectButtons('[data-metric]', metric, 'metric'); requestRender(); });
for (const button of document.querySelectorAll('[data-grouping]')) button.addEventListener('click', () => { grouping = button.dataset.grouping; selectButtons('[data-grouping]', grouping, 'grouping'); requestRender(); });
document.addEventListener('mouseover', (event) => showDetail(event.target.closest('[data-detail]')));
document.addEventListener('focusin', (event) => showDetail(event.target));
document.addEventListener('mouseout', (event) => { if (event.relatedTarget !== getElement('full-text')) hideDetail(); });
document.addEventListener('focusout', (event) => { if (event.relatedTarget !== getElement('full-text')) hideDetail(); });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (document.querySelector('dialog[open]')) { hideDetail(); return; }
    detailOwner?.focus({ preventScroll: true }); hideDetail();
  }
  if (event.key === 'Enter' && event.target.dataset.detail) { event.preventDefault(); showDetail(event.target); getElement('full-text').focus(); }
});
window.addEventListener('resize', () => { hideDetail(); requestRender(); });
document.fonts.ready.then(requestRender);
const stream = new EventSource('/factory/api/events');
stream.addEventListener('snapshot', (event) => {
  try { snapshot = JSON.parse(event.data); connected = true; requestRender(); }
  catch (error) { renderFailed = true; console.error('Invalid dashboard snapshot', error); setText('connection', 'Invalid data'); }
});
stream.addEventListener('error', () => { connected = false; setText('connection', 'Reconnecting'); });
setInterval(renderFreshness, 1000);
window.addEventListener('pagehide', () => stream.close());
