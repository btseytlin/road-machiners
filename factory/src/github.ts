import { must } from './exec';
import { FACTORY_MARK } from './types';
import type { Card, Column, FactoryConfig, GitHub, Issue, IssueComment, Run } from './types';

const COLUMNS: Column[] = ['Triage', 'Design', 'Implementation', 'Testing', 'Approval', 'Done'];
const ISSUE_FIELDS = 'number,title,body,labels,createdAt,state,author';

type Board = { projectId: string; fieldId: string; options: Record<string, string> };
type RawIssue = Omit<Issue, 'labels' | 'thumbsUp' | 'author'> & { labels: { name: string }[]; author: { login: string } };
type Vars = Record<string, string | number>;

type BoardData = {
  id: string;
  field: { id: string; options: { id: string; name: string }[] } | null;
};

const PROJECT_FIELDS = 'id field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } }';

const ITEMS_QUERY = `query($project: ID!, $cursor: String) { node(id: $project) { ... on ProjectV2 {
  items(first: 100, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { id
    fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
    content { ... on Issue { number repository { nameWithOwner } labels(first: 50) { nodes { name } } } } } } } } }`;

const ADD_ITEM = `mutation($project: ID!, $content: ID!) { addProjectV2ItemById(input: {projectId: $project, contentId: $content}) { item { id } } }`;

const SET_STATUS = `mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
  updateProjectV2ItemFieldValue(input: {projectId: $project, itemId: $item, fieldId: $field, value: {singleSelectOptionId: $option}}) { projectV2Item { id } } }`;

type ItemNode = {
  id: string;
  fieldValueByName: { name?: string } | null;
  content: { number?: number; repository?: { nameWithOwner: string }; labels?: { nodes: { name: string }[] } } | null;
};

type ItemsPage = {
  data: { node: { items: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: ItemNode[] } } };
};

const NOT_THIS_KIND = /Could not resolve to an? (User|Organization)/;

export function ghClient(run: Run, cfg: Pick<FactoryConfig, 'repo' | 'projectOwner' | 'projectNumber'>): GitHub {
  const repo = cfg.repo;
  let board: Board | null = null;

  async function gh(args: string[]): Promise<string> {
    return must(await run('gh', args), `gh ${args.slice(0, 3).join(' ')}`);
  }

  async function graphql(query: string, vars: Vars): Promise<string> {
    return gh(graphqlArgs(query, vars));
  }

  async function lines(args: string[]): Promise<string[]> {
    return (await gh(args)).split('\n').filter((line) => line.trim() !== '');
  }

  async function thumbsUp(number: number): Promise<string[]> {
    return lines(['api', `repos/${repo}/issues/${number}/reactions`, '--paginate',
      '--jq', '.[] | select(.content == "+1") | .user.login']);
  }

  async function fill(raw: RawIssue): Promise<Issue> {
    return { ...raw, author: raw.author.login, labels: raw.labels.map((label) => label.name), thumbsUp: await thumbsUp(raw.number) };
  }

  async function list(label: string): Promise<RawIssue[]> {
    const out = await gh(['issue', 'list', '-R', repo, '--state', 'open', '--label', label,
      '--json', ISSUE_FIELDS, '--limit', '500']);
    return JSON.parse(out) as RawIssue[];
  }

  async function findProject(): Promise<BoardData> {
    for (const kind of ['user', 'organization']) {
      const query = `query($owner: String!, $number: Int!) { ${kind}(login: $owner) { projectV2(number: $number) { ${PROJECT_FIELDS} } } }`;
      const result = await run('gh', graphqlArgs(query, { owner: cfg.projectOwner, number: cfg.projectNumber }));
      // Only a wrong owner kind moves on to the next kind. Any other error is real and stops here.
      if (result.code !== 0 && NOT_THIS_KIND.test(result.stderr)) continue;
      must(result, `gh api graphql ${kind} project`);
      const data = JSON.parse(result.stdout) as { data: Record<string, { projectV2: BoardData | null } | null> };
      const project = data.data[kind]?.projectV2;
      if (project) return project;
    }
    throw new Error(`Project ${cfg.projectNumber} not found for ${cfg.projectOwner}`);
  }

  async function loadBoard(): Promise<Board> {
    if (board) return board;
    const project = await findProject();
    if (!project.field) throw new Error('Project has no single-select field named "Status"');
    const options: Record<string, string> = {};
    for (const option of project.field.options) options[option.name] = option.id;
    for (const column of COLUMNS) {
      if (!options[column]) throw new Error(`Project Status field has no option named "${column}"`);
    }
    board = { projectId: project.id, fieldId: project.field.id, options };
    return board;
  }

  async function setStatus(itemId: string, column: Column): Promise<void> {
    const b = await loadBoard();
    await graphql(SET_STATUS, { project: b.projectId, item: itemId, field: b.fieldId, option: b.options[column] });
  }

  async function cards(): Promise<Card[]> {
    const b = await loadBoard();
    const found: Card[] = [];
    let cursor = '';
    for (;;) {
      const vars: Vars = cursor ? { project: b.projectId, cursor } : { project: b.projectId };
      const page = JSON.parse(await graphql(ITEMS_QUERY, vars)) as ItemsPage;
      const items = page.data.node.items;
      for (const node of items.nodes) {
        const card = toCard(node, repo);
        if (card) found.push(card);
      }
      if (!items.pageInfo.hasNextPage) return found;
      cursor = items.pageInfo.endCursor;
    }
  }

  async function issue(number: number): Promise<Issue> {
    const out = await gh(['issue', 'view', String(number), '-R', repo, '--json', ISSUE_FIELDS]);
    return fill(JSON.parse(out) as RawIssue);
  }

  return {
    async candidates(labels) {
      const byNumber = new Map<number, RawIssue>();
      for (const label of labels) {
        for (const raw of await list(label)) byNumber.set(raw.number, raw);
      }
      return Promise.all([...byNumber.values()].map(fill));
    },
    issue,
    async comments(number): Promise<IssueComment[]> {
      const rows = await lines(['api', `repos/${repo}/issues/${number}/comments`, '--paginate',
        '--jq', '.[] | {login: .user.login, body: .body}']);
      return rows.map((row) => JSON.parse(row) as IssueComment);
    },
    async comment(number, body) {
      await gh(['issue', 'comment', String(number), '-R', repo, '--body', `${body}\n\n${FACTORY_MARK}`]);
    },
    async addLabel(number, label) {
      await gh(['label', 'create', label, '-R', repo, '--force']);
      await gh(['issue', 'edit', String(number), '-R', repo, '--add-label', label]);
    },
    async removeLabel(number, label) {
      await gh(['issue', 'edit', String(number), '-R', repo, '--remove-label', label]);
    },
    async close(number, reason) {
      await gh(['issue', 'close', String(number), '-R', repo, '--reason', reason]);
    },
    async createIssue(title, body, labels) {
      // `gh issue create --label` fails on a label the repo lacks, so the labels exist first.
      for (const label of labels) await gh(['label', 'create', label, '-R', repo, '--force']);
      const args = ['issue', 'create', '-R', repo, '--title', title, '--body', body];
      for (const label of labels) args.push('--label', label);
      const url = (await gh(args)).trim();
      const match = /\/issues\/(\d+)\s*$/.exec(url);
      if (!match) throw new Error(`Cannot read the issue number from: ${url}`);
      return Number(match[1]);
    },
    async editIssue(number, title, body) {
      await gh(['issue', 'edit', String(number), '-R', repo, '--title', title, '--body', body]);
    },
    cards,
    async addCard(number, column) {
      const b = await loadBoard();
      const view = JSON.parse(await gh(['issue', 'view', String(number), '-R', repo, '--json', 'id'])) as { id: string };
      const added = JSON.parse(await graphql(ADD_ITEM, { project: b.projectId, content: view.id })) as {
        data: { addProjectV2ItemById: { item: { id: string } } };
      };
      await setStatus(added.data.addProjectV2ItemById.item.id, column);
    },
    async move(number, column) {
      const card = (await cards()).find((c) => c.issue === number);
      if (!card) throw new Error(`Issue ${number} is not on the board`);
      await setStatus(card.itemId, column);
    },
    async createRelease(tag, target, title, notes) {
      await gh(['release', 'create', tag, '-R', repo, '--target', target, '--title', title, '--notes', notes]);
    },
    async openPullRequest(branch, base, title, body) {
      const out = await gh(['pr', 'create', '-R', repo, '--head', branch, '--base', base, '--title', title, '--body', body]);
      return out.trim();
    },
    async pullRequestFor(branch) {
      const out = await gh(['pr', 'list', '-R', repo, '--head', branch, '--state', 'open', '--json', 'url']);
      const found = JSON.parse(out) as { url: string }[];
      return found[0]?.url ?? null;
    },
    async closePullRequest(branch, comment) {
      await gh(['pr', 'close', branch, '-R', repo, '--comment', comment]);
    },
    async reopen(number) {
      await gh(['issue', 'reopen', String(number), '-R', repo]);
    },
  };
}

// Strings go as -f fields and numbers as -F fields, so gh types them right.
function graphqlArgs(query: string, vars: Vars): string[] {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [name, value] of Object.entries(vars)) {
    args.push(typeof value === 'number' ? '-F' : '-f', `${name}=${value}`);
  }
  return args;
}

// Skips items that are not issues of this repo or have no Status.
function toCard(node: ItemNode, repo: string): Card | null {
  const content = node.content;
  const column = node.fieldValueByName?.name;
  if (!content || !column || !content.number || !inRepo(content, repo)) return null;
  return { itemId: node.id, issue: content.number, column: column as Column, labels: labelsOf(content) };
}

function inRepo(content: NonNullable<ItemNode['content']>, repo: string): boolean {
  return content.repository?.nameWithOwner === repo;
}

function labelsOf(content: NonNullable<ItemNode['content']>): string[] {
  return (content.labels?.nodes ?? []).map((label) => label.name);
}
