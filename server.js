const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const identity = {
  user_id: process.env.USER_ID || 'johndoe_17091999',
  email_id: process.env.EMAIL_ID || 'john.doe@college.edu',
  college_roll_number: process.env.COLLEGE_ROLL_NUMBER || '21CS1001'
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function normalizeEntry(entry) {
  if (typeof entry === 'string') {
    return entry.trim();
  }
  return String(entry).trim();
}

function buildResponse(data) {
  const invalid_entries = [];
  const duplicate_edges = [];
  const duplicateSeen = new Set();
  const pairSeen = new Set();
  const parentOf = new Map();
  const childrenOf = new Map();
  const nodes = new Set();
  const firstSeenIndex = new Map();

  for (let index = 0; index < data.length; index += 1) {
    const rawEntry = normalizeEntry(data[index]);
    if (!rawEntry) {
      invalid_entries.push(rawEntry);
      continue;
    }

    const match = rawEntry.match(/^([A-Z])->([A-Z])$/);
    if (!match) {
      invalid_entries.push(rawEntry);
      continue;
    }

    const parent = match[1];
    const child = match[2];

    if (parent === child) {
      invalid_entries.push(rawEntry);
      continue;
    }

    if (pairSeen.has(rawEntry)) {
      if (!duplicateSeen.has(rawEntry)) {
        duplicateSeen.add(rawEntry);
        duplicate_edges.push(rawEntry);
      }
      continue;
    }

    pairSeen.add(rawEntry);
    if (!firstSeenIndex.has(parent)) {
      firstSeenIndex.set(parent, index);
    }
    if (!firstSeenIndex.has(child)) {
      firstSeenIndex.set(child, index);
    }

    if (parentOf.has(child)) {
      continue;
    }

    parentOf.set(child, parent);
    if (!childrenOf.has(parent)) {
      childrenOf.set(parent, []);
    }
    childrenOf.get(parent).push(child);
    nodes.add(parent);
    nodes.add(child);
  }

  const adjacency = new Map();
  for (const node of nodes) {
    adjacency.set(node, new Set());
  }
  for (const [child, parent] of parentOf.entries()) {
    adjacency.get(child).add(parent);
    adjacency.get(parent).add(child);
  }

  const visited = new Set();
  const components = [];

  for (const node of nodes) {
    if (visited.has(node)) {
      continue;
    }
    const stack = [node];
    const component = [];
    visited.add(node);
    while (stack.length) {
      const current = stack.pop();
      component.push(current);
      for (const next of adjacency.get(current) || []) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }
    component.sort();
    components.push(component);
  }

  components.sort((a, b) => {
    const aIndex = Math.min(...a.map(node => firstSeenIndex.get(node) ?? Number.MAX_SAFE_INTEGER));
    const bIndex = Math.min(...b.map(node => firstSeenIndex.get(node) ?? Number.MAX_SAFE_INTEGER));
    if (aIndex !== bIndex) {
      return aIndex - bIndex;
    }
    return a[0].localeCompare(b[0]);
  });

  function buildTree(node, pathSet) {
    if (pathSet.has(node)) {
      return null;
    }
    const nextPath = new Set(pathSet);
    nextPath.add(node);
    const children = (childrenOf.get(node) || []).slice().sort();
    const childObject = {};
    for (const child of children) {
      const built = buildTree(child, nextPath);
      if (built) {
        childObject[child] = built;
      }
    }
    return childObject;
  }

  function computeDepth(node) {
    const children = childrenOf.get(node) || [];
    if (!children.length) {
      return 1;
    }
    let maxDepth = 0;
    for (const child of children) {
      const depth = computeDepth(child);
      if (depth > maxDepth) {
        maxDepth = depth;
      }
    }
    return maxDepth + 1;
  }

  const hierarchies = [];
  let total_trees = 0;
  let total_cycles = 0;
  let largestTreeRoot = '';
  let largestDepth = 0;

  for (const component of components) {
    const rootCandidates = component.filter(node => !parentOf.has(node));
    if (rootCandidates.length === 0) {
      const root = component[0];
      hierarchies.push({
        root,
        tree: {},
        has_cycle: true
      });
      total_cycles += 1;
      continue;
    }

    const root = rootCandidates.sort()[0];
    const tree = {};
    tree[root] = buildTree(root, new Set()) || {};
    const depth = computeDepth(root);

    hierarchies.push({
      root,
      tree,
      depth
    });

    total_trees += 1;
    if (depth > largestDepth || (depth === largestDepth && root.localeCompare(largestTreeRoot) < 0)) {
      largestDepth = depth;
      largestTreeRoot = root;
    }
  }

  return {
    ...identity,
    hierarchies,
    invalid_entries,
    duplicate_edges,
    summary: {
      total_trees,
      total_cycles,
      largest_tree_root: largestTreeRoot
    }
  };
}

function serveStatic(req, res, pathname) {
  const filePath = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, pathname.slice(1));
  const normalizedPath = path.normalize(filePath);
  if (!normalizedPath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  fs.readFile(normalizedPath, (err, data) => {
    if (err) {
      sendText(res, 404, 'Not found');
      return;
    }

    const ext = path.extname(normalizedPath).toLowerCase();
    const contentType = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8'
    }[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length,
      'Access-Control-Allow-Origin': '*'
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname || '/';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  if (pathname === '/bfhl' && req.method === 'POST') {
    try {
      const rawBody = await readBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      if (!payload || !Array.isArray(payload.data)) {
        sendJson(res, 400, { error: 'Request body must include a data array' });
        return;
      }
      const response = buildResponse(payload.data);
      sendJson(res, 200, response);
    } catch (error) {
      sendJson(res, 400, { error: error.message || 'Invalid request' });
    }
    return;
  }

  if (req.method === 'GET') {
    serveStatic(req, res, pathname);
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
  });
}

module.exports = {
  buildResponse,
  identity,
  server
};
