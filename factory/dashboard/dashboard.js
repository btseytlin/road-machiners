const stageNames = { triage: 'Triage', design: 'Design', implement: 'Implementation', testing: 'Testing', approve: 'Approval', adhoc: 'Ad hoc task', change: 'Factory change', candidate: 'Candidate', release: 'Release cut', ship: 'Ship', remove: 'Removal', dev: 'Dev build' };
const columns = ['Triage', 'Design', 'Implementation', 'Testing', 'Approval'];
const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, notation: 'compact' });
const moneyFormat = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });
let snapshot = null;
let selectedDays = 7;
let connected = false;

function getElement(id) { return document.getElementById(id); }
function createNode(tag, text = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}
function setText(id, text) { getElement(id).textContent = text; }
function createLink(text, href, className = 'link') {
  const node = createNode('a', text, className);
  const url = new URL(href);
  if (url.protocol !== 'https:') throw new Error('Invalid public link');
  node.href = url.href;
  node.rel = 'noopener noreferrer';
  node.dataset.key = url.href;
  return node;
}
function replaceContents(id, nodes) {
  const target = getElement(id);
  const focused = target.contains(document.activeElement) ? document.activeElement.dataset.key : null;
  const scrollTop = target.scrollTop;
  target.replaceChildren(...nodes);
  target.scrollTop = scrollTop;
  if (focused) target.querySelector(`[data-key="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
}
function formatNumber(value) { return value === null ? '—' : numberFormat.format(value); }
function formatCost(value) { return value === null ? '—' : moneyFormat.format(value); }
function countTokens(tokens) { return tokens === null ? null : tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite; }
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'Unavailable';
  const minutes = Math.floor(ms / 60000);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
function formatBytes(bytes) { return `${(bytes / 1073741824).toFixed(1)} GiB`; }
function formatAge(source) {
  if (source.at === null) return 'unavailable';
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(source.at)) / 1000));
  return `${source.status} · ${seconds}s ago`;
}
function getIssueLink(issue) { return `${snapshot.repoUrl}/issues/${issue}`; }
function getReleaseData() {
  const github = snapshot.github.value;
  if (github === null || snapshot.operations.value === null) return null;
  return github.releaseKey === snapshot.operations.value.releaseKey ? github : null;
}
function renderHeader() {
  getElement('github-link').href = snapshot.repoUrl;
  getElement('play-link').href = snapshot.playUrl;
  getElement('channel-link').href = snapshot.channelUrl;
  const operations = snapshot.operations.value;
  if (operations === null) {
    setText('factory-status', 'Factory state unavailable');
    setText('worker-count', '—');
    return;
  }
  const jobs = operations.jobs;
  setText('factory-status', `${operations.status} · ${jobs.length} running`);
  const capacity = Object.values(operations.queues).reduce((total, queue) => total + queue.total, 0);
  setText('worker-count', `${jobs.length} / ${capacity}`);
  setText('job-count', `${jobs.length} running`);
}
function createJobRow(job, card) {
  const row = createNode('tr');
  const title = createNode('td', '', 'job-title');
  if (job.issue !== null) title.append(createLink(`#${job.issue} ${card?.title ?? ''}`, getIssueLink(job.issue), ''));
  else title.textContent = stageNames[job.stage];
  title.append(createNode('span', `${job.queue} queue`, 'dim'));
  row.append(title, createNode('td', stageNames[job.stage], 'stage gold'), createNode('td', formatDuration(Date.now() - Date.parse(job.startedAt)), 'elapsed'));
  return row;
}
function createWaitingRow(card) {
  const row = createNode('tr');
  const title = createNode('td', '', 'job-title');
  title.append(createLink(`#${card.issue} ${card.title}`, getIssueLink(card.issue), ''));
  const status = card.blocked ? 'Blocked' : card.column;
  row.append(title, createNode('td', status, card.blocked ? 'stage bad' : 'stage'), createNode('td', 'Waiting', 'elapsed dim'));
  return row;
}
function renderJobs() {
  const operations = snapshot.operations.value;
  if (operations === null) {
    replaceContents('job-rows', []);
    setText('pipeline', 'Factory state unavailable');
    setText('job-count', 'Unavailable');
    return;
  }
  const cards = snapshot.github.value?.cards ?? [];
  const running = new Set(operations.jobs.map((job) => job.issue));
  const rows = operations.jobs.map((job) => createJobRow(job, cards.find((card) => card.issue === job.issue)));
  rows.push(...cards.filter((card) => !running.has(card.issue)).map(createWaitingRow));
  replaceContents('job-rows', rows);
  const pipeline = columns.map((column) => createNode('span', `${column} ${cards.filter((card) => card.column === column).length}`));
  replaceContents('pipeline', snapshot.github.value === null ? [createNode('span', 'GitHub queue unavailable')] : pipeline);
  renderJobNote(rows.length);
}
function renderJobNote(count) {
  setText('job-note', snapshot.github.status === 'ok' ? 'Running jobs and queued public issues. Private request text is hidden.' : 'GitHub is unavailable or stale. Queue details may be incomplete.');
  if (count === 0 && snapshot.github.status === 'ok') setText('job-note', 'No running jobs or queued public issues.');
}
function renderRelease() {
  const release = getReleaseData();
  if (release === null) {
    setText('release-status', 'Awaiting GitHub');
    setText('release-name', '—');
    setText('release-phase', 'Awaiting GitHub');
    setText('change-count', '—');
    replaceContents('release-changes', []);
    replaceContents('release-actions', []);
    setText('release-count', 'Unavailable');
    setText('release-blockers', 'Release contents have not been confirmed.');
    return;
  }
  const operations = snapshot.operations.value;
  setText('release-name', release.provisional ? 'dev / provisional' : `Release ${operations.release.day}`);
  setText('release-count', `${release.features.length} merged changes`);
  setText('change-count', String(release.features.length));
  const phase = release.provisional ? 'Before release cut' : 'In preparation';
  setText('release-phase', phase);
  setText('release-status', operations.candidateUrl ? 'Candidate ready' : phase);
  replaceContents('release-changes', release.features.map((feature) => {
    const li = createNode('li');
    li.append(createNode('span', `#${feature.issue}`, 'issue'), createLink(feature.title, getIssueLink(feature.issue), ''));
    return li;
  }));
  const blockers = release.cards.filter((card) => card.releaseTask).length;
  setText('release-blockers', `${blockers} open release tasks. ${release.provisional ? 'Contents can change before the cut.' : 'Committee approval is required to ship.'}`);
  renderReleaseActions(operations);
}
function renderReleaseActions(operations) {
  const actions = [];
  if (operations.release) actions.push(createLink('Tracking issue ↗', getIssueLink(operations.release.issue), 'button'));
  if (operations.candidateUrl) actions.push(createLink('Play candidate ↗', operations.candidateUrl, 'button on'));
  replaceContents('release-actions', actions);
}
function createHostReading(name, value, detail, percentage) {
  const node = createNode('div', '', 'host-reading');
  node.append(createNode('h4', name), createNode('strong', value), createNode('p', detail, 'small dim'));
  if (percentage !== null) {
    const meter = document.createElement('meter');
    meter.min = 0;
    meter.max = 100;
    meter.value = percentage;
    meter.setAttribute('aria-label', `${name} utilization`);
    node.append(meter);
  }
  return node;
}
function createCapacityReading(name, source) {
  if (source.value === null) return createHostReading(name, 'Unavailable', source.error, null);
  const data = source.value;
  return createHostReading(name, `${formatBytes(data.used)} / ${formatBytes(data.total)}`, `${formatBytes(data.free)} available`, 100 * data.used / data.total);
}
function renderHost() {
  const host = snapshot.host.value;
  if (host === null) return replaceContents('host-readings', [createNode('p', 'Host readings unavailable', 'empty')]);
  const cpu = host.cpu.value;
  const nodes = [createHostReading('CPU', cpu === null ? 'Unavailable' : `${cpu.toFixed(1)}%`, formatAge(host.cpu), cpu), createCapacityReading('RAM', host.ram), createCapacityReading('SSD', host.ssd)];
  if (host.gpu.value === null) nodes.push(createHostReading('GPU', 'Unavailable', 'NVIDIA readings unavailable', null));
  else for (const gpu of host.gpu.value) nodes.push(createHostReading(`GPU ${gpu.index} · ${gpu.name}`, `${gpu.utilization}%`, `${formatBytes(gpu.memory.used)} / ${formatBytes(gpu.memory.total)} video memory`, gpu.utilization));
  replaceContents('host-readings', nodes);
  setText('host-age', formatAge(snapshot.host));
}
function renderDailyChart(summary) {
  const max = Math.max(1, ...summary.daily.map((day) => countTokens(day.tokens)));
  const bars = [];
  const labels = [];
  for (const day of summary.daily) {
    const col = createNode('div', '', 'chart-col');
    const fresh = createNode('div', '', 'fresh');
    const cached = createNode('div', '', 'cached');
    fresh.style.height = `${100 * (day.tokens.input + day.tokens.output) / max}%`;
    cached.style.height = `${100 * (day.tokens.cacheRead + day.tokens.cacheWrite) / max}%`;
    col.title = `${day.day}: ${day.tokens.input} input, ${day.tokens.output} output, ${day.tokens.cacheRead} cache read, ${day.tokens.cacheWrite} cache write. ${formatCost(day.cost)}`;
    col.append(fresh, cached);
    bars.push(col);
    labels.push(createNode('span', day.day.slice(5)));
  }
  replaceContents('usage-chart', bars.length ? bars : [createNode('p', 'No measured agent usage in this range', 'empty')]);
  replaceContents('chart-days', labels);
}
function createStatRow(label, amount, fraction) {
  const row = createNode('div', '', 'stat-row');
  const bar = createNode('span', '', 'bar');
  const fill = createNode('i');
  fill.style.width = `${fraction * 100}%`;
  bar.append(fill);
  row.append(createNode('span', label), bar, createNode('span', amount, 'mono'));
  return row;
}
function renderUsageBreakdown(summary) {
  const maxTime = Math.max(1, ...summary.stages.map((stage) => stage.workerMs));
  const maxTokens = Math.max(1, ...summary.models.map(countTokens));
  replaceContents('stage-usage', summary.stages.map((stage) => createStatRow(stageNames[stage.stage] ?? stage.stage, formatDuration(stage.workerMs), stage.workerMs / maxTime)));
  replaceContents('model-usage', summary.models.map((model) => {
    const group = createNode('div');
    group.append(createStatRow(model.model, formatNumber(countTokens(model)), countTokens(model) / maxTokens), createNode('p', `${formatCost(model.cost)} estimated cost`, 'small dim'));
    return group;
  }));
  replaceContents('issue-usage', summary.issues.map((issue) => {
    const row = createNode('tr');
    const link = createNode('td');
    link.append(createLink(`#${issue.issue}`, getIssueLink(issue.issue)));
    row.append(link, createNode('td', formatDuration(issue.workerMs)), createNode('td', formatCost(issue.cost)));
    return row;
  }));
}
function renderAnalytics() {
  const analytics = snapshot.analytics.value;
  if (analytics === null) return renderUnavailableAnalytics();
  const summary = analytics.ranges.find((range) => range.days === selectedDays);
  const today = analytics.ranges.find((range) => range.days === 1);
  setText('tokens-today', formatNumber(countTokens(today.tokens)));
  setText('cost-today', formatCost(today.cost));
  setText('time-today', today.since === null ? '—' : formatDuration(today.workerMs));
  setText('usage-coverage', `${today.missingUsage} runs without final usage`);
  setText('usage-tokens', formatNumber(countTokens(summary.tokens)));
  setText('usage-cost', formatCost(summary.cost));
  setText('usage-time', summary.since === null ? '—' : formatDuration(summary.workerMs));
  setText('usage-outcomes', `${summary.completed} completed · ${summary.failed} failed · ${summary.timeouts} timed out`);
  setText('measurement-note', `Collection since ${summary.since ?? 'not started'}. ${summary.missingUsage} runs without final usage. ${summary.collectionFaults} collection faults. Unmeasured usage is excluded.`);
  setText('token-split', formatTokenSplit(summary.tokens));
  renderDailyChart(summary);
  renderUsageBreakdown(summary);
  renderEvents(analytics.ranges.find((range) => range.days === 30));
  renderPosts(analytics.posts);
}
function formatTokenSplit(tokens) {
  if (tokens === null) return 'Token breakdown unavailable.';
  return `Input ${tokens.input.toLocaleString()} · Output ${tokens.output.toLocaleString()} · Cache read ${tokens.cacheRead.toLocaleString()} · Cache write ${tokens.cacheWrite.toLocaleString()}`;
}
function renderUnavailableAnalytics() {
  for (const id of ['tokens-today', 'cost-today', 'time-today', 'usage-tokens', 'usage-cost', 'usage-time']) setText(id, '—');
  for (const id of ['stage-usage', 'model-usage', 'issue-usage', 'usage-chart', 'chart-days', 'event-log', 'posts']) replaceContents(id, []);
  setText('measurement-note', 'Usage collection is unavailable.');
  setText('usage-coverage', 'Unavailable');
  setText('usage-outcomes', 'Unavailable');
  setText('token-split', 'Token breakdown unavailable.');
}
function renderEvents(summary) {
  replaceContents('event-log', summary.activity.map((event) => {
    const row = createNode('div', '', 'log-line');
    const text = `${stageNames[event.stage]} ${event.outcome}`;
    const message = createNode('span', text, event.outcome === 'finished' ? 'good' : 'bad');
    if (event.issue !== null) message.append(' ', createLink(`#${event.issue}`, getIssueLink(event.issue)));
    row.append(createNode('time', event.at.slice(11, 16)), message);
    row.title = event.at;
    return row;
  }));
  if (!summary.activity.length) replaceContents('event-log', [createNode('p', 'No recorded job outcomes yet.', 'empty')]);
}
function renderPosts(posts) {
  replaceContents('posts', posts.map((post) => {
    const article = createNode('article', '', 'post');
    article.append(createNode('time', post.at.slice(0, 16).replace('T', ' '), 'mono'), createNode('p', post.text), createLink('View public post ↗', `${snapshot.channelUrl}/${post.id}`));
    return article;
  }));
  if (!posts.length) replaceContents('posts', [createNode('p', 'No recorded announcements yet. Open the channel for earlier posts.', 'empty')]);
}
function renderFreshness() {
  if (snapshot === null) return;
  setText('state-age', `Local state: ${formatAge(snapshot.operations)}`);
  setText('source-age', `State: ${formatAge(snapshot.operations)} / GitHub: ${formatAge(snapshot.github)} / Usage: ${formatAge(snapshot.analytics)}`);
  const sourceProblem = [snapshot.operations, snapshot.github, snapshot.analytics].some((source) => source.status !== 'ok');
  const message = connected ? 'Connected' : 'Disconnected · Reconnecting automatically';
  setText('connection', `${message}${sourceProblem ? ' · Some sources are unavailable or stale' : ''}`);
  getElement('connection').classList.toggle('bad', !connected || sourceProblem);
  setText('footer-status', `Latest server snapshot: ${snapshot.generatedAt}`);
}
function renderSnapshot() {
  renderHeader();
  renderJobs();
  renderRelease();
  renderHost();
  renderAnalytics();
  renderFreshness();
}
for (const button of document.querySelectorAll('[data-days]')) {
  button.addEventListener('click', () => {
    selectedDays = Number(button.dataset.days);
    for (const choice of document.querySelectorAll('[data-days]')) {
      const on = Number(choice.dataset.days) === selectedDays;
      choice.classList.toggle('on', on);
      choice.setAttribute('aria-pressed', String(on));
    }
    if (snapshot !== null) renderAnalytics();
  });
}
for (const tab of document.querySelectorAll('nav a')) {
  tab.addEventListener('click', () => {
    for (const choice of document.querySelectorAll('nav a')) choice.classList.toggle('on', choice === tab);
  });
}
const stream = new EventSource('/factory/api/events');
stream.addEventListener('snapshot', (event) => {
  try {
    snapshot = JSON.parse(event.data);
    connected = true;
    renderSnapshot();
  } catch (error) {
    console.error('Invalid dashboard snapshot', error);
    setText('connection', 'Dashboard data could not be displayed. Reload to retry.');
    getElement('connection').classList.add('bad');
  }
});
stream.addEventListener('error', () => {
  connected = false;
  setText('connection', 'Disconnected · Reconnecting automatically');
  getElement('connection').classList.add('bad');
});
setInterval(renderFreshness, 1000);
window.addEventListener('pagehide', () => stream.close());
