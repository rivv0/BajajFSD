const input = document.getElementById('input');
const submit = document.getElementById('submit');
const loadExample = document.getElementById('load-example');
const error = document.getElementById('error');
const summary = document.getElementById('summary');
const hierarchies = document.getElementById('hierarchies');
const invalidEntries = document.getElementById('invalid-entries');
const duplicateEdges = document.getElementById('duplicate-edges');

const example = `A->B
A->C
B->D
C->E
E->F
X->Y
Y->Z
Z->X
P->Q
Q->R
G->H
G->H
G->I
hello
1->2
A->`;

function setError(message) {
  if (!message) {
    error.hidden = true;
    error.textContent = '';
    return;
  }
  error.hidden = false;
  error.textContent = message;
}

function renderSummary(data) {
  summary.innerHTML = '';
  const items = [
    ['Trees', data.summary?.total_trees ?? 0],
    ['Cycles', data.summary?.total_cycles ?? 0],
    ['Largest Root', data.summary?.largest_tree_root || '-']
  ];
  for (const [label, value] of items) {
    const card = document.createElement('div');
    card.className = 'summary-card';
    card.innerHTML = `<strong>${label}</strong><span>${value}</span>`;
    summary.appendChild(card);
  }
}

function renderGraph(nodeObject) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'graph');
  svg.setAttribute('viewBox', '0 0 360 220');
  svg.setAttribute('role', 'img');

  const nodes = [];
  const edges = [];
  const levels = new Map();
  const seen = new Set();

  const walk = (label, children, depth, parent = null) => {
    if (!levels.has(depth)) {
      levels.set(depth, []);
    }
    if (!seen.has(label)) {
      seen.add(label);
      levels.get(depth).push(label);
      nodes.push({ label, depth });
    }
    if (parent) {
      edges.push({ from: parent, to: label });
    }
    for (const [childLabel, grandChildren] of Object.entries(children || {})) {
      walk(childLabel, grandChildren, depth + 1, label);
    }
  };

  for (const [label, children] of Object.entries(nodeObject || {})) {
    walk(label, children, 0, null);
  }

  const positions = new Map();
  const levelEntries = Array.from(levels.entries()).sort((a, b) => a[0] - b[0]);
  const width = 360;
  const height = 220;
  const levelGap = levelEntries.length > 1 ? (height - 60) / (levelEntries.length - 1) : 0;

  for (const [depth, labels] of levelEntries) {
    const y = 30 + depth * levelGap;
    const count = labels.length;
    for (let i = 0; i < count; i += 1) {
      const label = labels[i];
      let x;
      if (depth === 0) {
        x = width / 2;
      } else if (count === 1) {
        x = width / 2;
      } else {
        x = 30 + (i * (width - 60)) / (count - 1);
      }
      positions.set(label, { x, y });
    }
  }

  for (const edge of edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) {
      continue;
    }
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', from.x);
    line.setAttribute('y1', from.y + 16);
    line.setAttribute('x2', to.x);
    line.setAttribute('y2', to.y - 16);
    line.setAttribute('class', 'graph-edge');
    svg.appendChild(line);
  }

  for (const node of nodes) {
    const pos = positions.get(node.label);
    if (!pos) {
      continue;
    }
    const group = document.createElementNS(svgNS, 'g');

    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', pos.x);
    circle.setAttribute('cy', pos.y);
    circle.setAttribute('r', 16);
    circle.setAttribute('class', 'graph-node');

    const text = document.createElementNS(svgNS, 'text');
    text.setAttribute('x', pos.x);
    text.setAttribute('y', pos.y + 4);
    text.setAttribute('class', 'graph-label');
    text.textContent = node.label;

    group.appendChild(circle);
    group.appendChild(text);
    svg.appendChild(group);
  }

  return svg;
}

function renderHierarchies(data) {
  hierarchies.innerHTML = '';
  const list = data.hierarchies || [];
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'hierarchy-card';
    empty.textContent = 'No valid hierarchies were found.';
    hierarchies.appendChild(empty);
    return;
  }

  for (const item of list) {
    const card = document.createElement('article');
    card.className = 'hierarchy-card';

    const header = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = 'Root';
    const name = document.createElement('span');
    name.className = 'pill';
    name.textContent = item.root;
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent = item.has_cycle ? 'Cycle' : `Depth ${item.depth}`;
    header.append(title, name, pill);

    card.appendChild(header);

    if (item.has_cycle) {
      const cycle = document.createElement('div');
      cycle.textContent = 'Cycle detected, tree omitted.';
      card.appendChild(cycle);
    } else {
      card.appendChild(renderGraph(item.tree));
    }

    hierarchies.appendChild(card);
  }
}

function renderList(target, items) {
  target.innerHTML = '';
  if (!items || !items.length) {
    const li = document.createElement('li');
    li.textContent = 'None';
    target.appendChild(li);
    return;
  }
  for (const value of items) {
    const li = document.createElement('li');
    li.textContent = value;
    target.appendChild(li);
  }
}

function parseInput(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error('Input JSON must be an array');
    }
    return parsed;
  }

  return trimmed
    .split(/\r?\n|,/)
    .map(value => value.trim())
    .filter(Boolean);
}

async function submitData() {
  setError('');
  submit.disabled = true;
  submit.textContent = 'Working...';

  try {
    const data = parseInput(input.value);
    const response = await fetch('/bfhl', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ data })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Request failed');
    }

    renderSummary(payload);
    renderHierarchies(payload);
    renderList(invalidEntries, payload.invalid_entries);
    renderList(duplicateEdges, payload.duplicate_edges);
  } catch (err) {
    setError(err.message || 'Something went wrong');
  } finally {
    submit.disabled = false;
    submit.textContent = 'Submit';
  }
}

submit.addEventListener('click', submitData);
loadExample.addEventListener('click', () => {
  input.value = example;
  setError('');
});

renderSummary({ summary: { total_trees: 0, total_cycles: 0, largest_tree_root: '-' } });
renderHierarchies({ hierarchies: [] });
renderList(invalidEntries, []);
renderList(duplicateEdges, []);
