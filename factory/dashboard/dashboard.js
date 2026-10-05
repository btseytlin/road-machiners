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
  return seconds < 60 ? `${seconds}s` : formatDuration(seconds * 1000);
}
function countInputTokens(tokens) { return tokens == null ? null : tokens.input + tokens.cacheRead + tokens.cacheWrite; }
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
function formatActivity(activity) { return (activity.source === 'agent' ? 'Reported: ' : '') + actions[activity.activity]; }
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
function readQueueReason(queue) {
  if (readOperations()?.status === 'paused') return 'Starts paused';
  return readScheduledQueueReason(queue);
}
function readScheduledQueueReason(queue) {
  const scheduler = readLive()?.scheduler;
  if (!scheduler || scheduler.freshness !== 'ok') return 'Reason unavailable';
  if (scheduler.status !== 'ready') return readSchedulerStatus(scheduler.status);
  const waiting = readQueueWaits(queue);
  if (!waiting.length) return 'No eligible work';
  return waiting.map((item) => `${item.issue === null ? stages[item.stage] : `#${item.issue}`} ${item.reasons.map((reason) => reasons[reason]).join(', ') || 'Selected at last check'}`).join(', ');
}
function readQueueWaits(queue) {
  const decisions = readLive()?.scheduler?.decisions ?? [];
  return decisions.filter((item) => item.queue === queue && item.reasons.length > 0 && !item.reasons.includes('issue-running'));
}
function renderCapacity(operations) {
  const rows = operations ? Object.entries(operations.queues).filter(([name, queue]) => queue.total > queue.busy || readQueueWaits(name).length > 0) : [];
  const capacity = Math.max(1, Math.floor(getElement('capacity-rows').clientHeight / 24));
  const visible = selectPage('capacity', rows, capacity);
  replaceContents('capacity-rows', visible.map(([name, queue]) => {
    const row = createNode('div', '', 'capacity-row');
    row.append(createNode('span', `${queueNames[name]}: ${Math.max(0, queue.total - queue.busy)} free`), createNode('span', readQueueReason(name)));
    return row;
  }));
  if (!rows.length) replaceContents('capacity-rows', [createNode('p', operations ? 'All slots occupied' : 'State unavailable', 'empty')]);
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
  return manager.intent ? `${actions[manager.intent]}: ${actions[manager.activity].toLowerCase()}` : actions[manager.activity];
}
function renderManager() {
  const live = readLive();
  const manager = live?.manager;
  setText('manager-action', readManagerAction(manager));
  setText('manager-age', manager ? `Reported ${formatAge(manager.at)} ago` : '');
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
  setText('server-age', `Sampled ${formatAge(snapshot.host.at)} ago`);
  replaceContents('server-totals', createServerTotals(host));
  renderTable('server', host?.containers?.value ?? [], createResourceRow, 'Container readings unavailable', 3);
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
function renderEvents() {
  const events = snapshot.analytics.value?.ranges.find((range) => range.days === 30)?.activity ?? [];
  const width = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--event-width'));
  const capacity = Math.max(1, Math.floor(getElement('event-log').clientWidth / width));
  const visible = selectPage('event', events, capacity);
  replaceContents('event-log', visible.length ? visible.map(createEvent) : [createNode('span', 'No recorded events', 'muted')]);
}
function renderCounters(summary) {
  if (!summary) return clearCounters();
  renderTokenCounters(summary.tokens);
  setCounter('usage-time', summary.since ? formatDuration(summary.workerMs) : '—', summary.since ? `${summary.workerMs} ms` : null);
  setCounter('usage-cost', formatCost(summary.cost), summary.cost);
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
  for (const id of ['usage-tokens', 'usage-input', 'usage-output', 'usage-time', 'usage-cost', 'usage-wait']) setCounter(id, '—', null);
  setText('coverage', 'Measurements unavailable');
}
function readDailyValue(day) { return metric === 'tokens' ? countTokens(day.tokens) : day.cost; }
function formatDailyValue(value) { return metric === 'tokens' ? formatNumber(value) : formatCost(value); }
function createDailyBar(day, maximum) {
  const value = readDailyValue(day);
  const column = createNode('div', '', 'chart-column');
  const space = createNode('div', '', 'bar-space');
  const bar = createNode('div', '', value === null ? 'no-value' : 'bar');
  if (value !== null) bar.style.height = `${100 * value / maximum}%`;
  space.append(bar);
  column.append(createNode('span', formatDailyValue(value), 'chart-value'), space, createNode('span', day.day.slice(5), 'chart-label'));
  column.tabIndex = 0;
  column.dataset.detail = `${day.day}: ${formatDailyValue(value)}`;
  return column;
}
function readDailyBuckets(summary) {
  if (!summary) return [];
  const end = new Date(snapshot.generatedAt);
  end.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: summary.days + 1 }, (_, index) => {
    const day = new Date(end.getTime() - (summary.days - index) * 86400000).toISOString().slice(0, 10);
    return summary.daily.find((row) => row.day === day) ?? { day, cost: null, tokens: null };
  });
}
function renderDailyChart(summary) {
  setText('daily-title', metric === 'cost' ? 'Daily spend' : 'Daily tokens');
  const days = readDailyBuckets(summary);
  const capacity = Math.max(1, Math.floor(getElement('daily-chart').clientWidth / 48));
  const visible = selectPage('daily', days, capacity);
  const maximum = Math.max(1, ...days.map((day) => readDailyValue(day) ?? 0));
  replaceContents('daily-chart', visible.length ? visible.map((day) => createDailyBar(day, maximum)) : [createNode('p', 'No recorded usage', 'empty')]);
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
  renderDailyChart(summary);
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
  setText('connection', connected ? `Updated ${formatAge(snapshot.generatedAt)} ago` : 'Reconnecting');
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
function selectButtons(selector, chosen, attribute) { for (const button of document.querySelectorAll(selector)) button.setAttribute('aria-pressed', String(button.dataset[attribute] === chosen)); }
for (const button of document.querySelectorAll('[data-days]')) button.addEventListener('click', () => { selectedDays = Number(button.dataset.days); selectButtons('[data-days]', button.dataset.days, 'days'); pages.clear(); requestRender(); });
for (const button of document.querySelectorAll('[data-metric]')) button.addEventListener('click', () => { metric = button.dataset.metric; selectButtons('[data-metric]', metric, 'metric'); requestRender(); });
document.addEventListener('mouseover', (event) => showDetail(event.target.closest('[data-detail]')));
document.addEventListener('focusin', (event) => showDetail(event.target));
document.addEventListener('mouseout', (event) => { if (event.relatedTarget !== getElement('full-text')) hideDetail(); });
document.addEventListener('focusout', (event) => { if (event.relatedTarget !== getElement('full-text')) hideDetail(); });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { detailOwner?.focus({ preventScroll: true }); hideDetail(); }
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
