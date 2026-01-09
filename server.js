/**
 * OpenProject Standalone Frontend Server
 *
 * This server replaces the Rails backend entirely.
 * It serves the Angular frontend and proxies API calls to the cloud API.
 *
 * No Rails, No PostgreSQL - just Node.js + Angular + Cloud API
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  PORT: process.env.PORT || 4200,
  CLOUD_API_URL: process.env.CLOUD_API_URL || 'http://13.201.75.232:8000',
  WORKFLOW_API_URL: process.env.WORKFLOW_API_URL || 'http://13.201.75.232:8086',
  CLOUD_USERNAME: process.env.CLOUD_API_USERNAME || 'admin',
  CLOUD_PASSWORD: process.env.CLOUD_API_PASSWORD || 'admin123',
  STATIC_DIR: path.join(__dirname, 'dist'),
};

// ============================================================================
// JWT TOKEN MANAGEMENT
// ============================================================================

let jwtToken = null;
let tokenExpiresAt = null;
let currentUser = null;

async function ensureAuthenticated() {
  // Check if we have a valid token
  if (jwtToken && tokenExpiresAt && Date.now() < tokenExpiresAt) {
    return true;
  }

  console.log(`[AUTH] Authenticating with cloud API as ${CONFIG.CLOUD_USERNAME}...`);

  try {
    const response = await httpRequest({
      method: 'POST',
      hostname: new URL(CONFIG.CLOUD_API_URL).hostname,
      port: new URL(CONFIG.CLOUD_API_URL).port || 80,
      path: '/api/v3/users/login',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ login: CONFIG.CLOUD_USERNAME, password: CONFIG.CLOUD_PASSWORD }));

    const data = JSON.parse(response.body);

    if (data.data && data.data.access_token) {
      jwtToken = data.data.access_token;
      currentUser = data.data.user || null;
      tokenExpiresAt = Date.now() + (23 * 60 * 60 * 1000); // 23 hours
      console.log(`[AUTH] Authentication successful!`);
      return true;
    } else {
      console.error(`[AUTH] No token in response`);
      return false;
    }
  } catch (err) {
    console.error(`[AUTH] Authentication failed:`, err.message);
    return false;
  }
}

// ============================================================================
// HTTP REQUEST HELPER
// ============================================================================

function httpRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: responseBody });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ============================================================================
// MOCK DATA FOR MISSING ENDPOINTS
// ============================================================================

const MOCK_DATA = {
  '/api/v3': {
    _type: 'Root',
    instanceName: 'OpenProject (Cloud API)',
    coreVersion: '14.0.0',
    _links: {
      self: { href: '/api/v3' },
      configuration: { href: '/api/v3/configuration' },
      user: { href: '/api/v3/users/me' },
      priorities: { href: '/api/v3/priorities' },
      statuses: { href: '/api/v3/statuses' },
      types: { href: '/api/v3/types' },
      workPackages: { href: '/api/v3/work_packages' },
      projects: { href: '/api/v3/projects' },
    }
  },
  '/api/v3/configuration': {
    _type: 'Configuration',
    maximumAttachmentFileSize: 5242880,
    perPageOptions: [20, 50, 100],
    dateFormat: 'YYYY-MM-DD',
    timeFormat: 'HH:mm',
    startOfWeek: 1,
    activeFeatureFlags: [],
    _links: { self: { href: '/api/v3/configuration' } }
  },
  '/api/v3/statuses': {
    _type: 'Collection',
    total: 5,
    count: 5,
    _embedded: {
      elements: [
        { _type: 'Status', id: 1, name: 'new', displayName: 'New', color: '#1A67A3', isDefault: true, isClosed: false, position: 1, _links: { self: { href: '/api/v3/statuses/1' } } },
        { _type: 'Status', id: 2, name: 'in_progress', displayName: 'In Progress', color: '#CC5DE8', isDefault: false, isClosed: false, position: 2, _links: { self: { href: '/api/v3/statuses/2' } } },
        { _type: 'Status', id: 3, name: 'resolved', displayName: 'Resolved', color: '#40C057', isDefault: false, isClosed: false, position: 3, _links: { self: { href: '/api/v3/statuses/3' } } },
        { _type: 'Status', id: 4, name: 'closed', displayName: 'Closed', color: '#82C91E', isDefault: false, isClosed: true, position: 4, _links: { self: { href: '/api/v3/statuses/4' } } },
        { _type: 'Status', id: 5, name: 'on_hold', displayName: 'On Hold', color: '#FAB005', isDefault: false, isClosed: false, position: 5, _links: { self: { href: '/api/v3/statuses/5' } } }
      ]
    },
    _links: { self: { href: '/api/v3/statuses' } }
  },
  '/api/v3/priorities': {
    _type: 'Collection',
    total: 4,
    count: 4,
    _embedded: {
      elements: [
        { _type: 'Priority', id: 1, name: 'Low', color: '#82C91E', position: 1, isDefault: false, isActive: true, _links: { self: { href: '/api/v3/priorities/1' } } },
        { _type: 'Priority', id: 2, name: 'Normal', color: '#1A67A3', position: 2, isDefault: true, isActive: true, _links: { self: { href: '/api/v3/priorities/2' } } },
        { _type: 'Priority', id: 3, name: 'High', color: '#FAB005', position: 3, isDefault: false, isActive: true, _links: { self: { href: '/api/v3/priorities/3' } } },
        { _type: 'Priority', id: 4, name: 'Urgent', color: '#E03131', position: 4, isDefault: false, isActive: true, _links: { self: { href: '/api/v3/priorities/4' } } }
      ]
    },
    _links: { self: { href: '/api/v3/priorities' } }
  },
  '/api/v3/types': {
    _type: 'Collection',
    total: 4,
    count: 4,
    _embedded: {
      elements: [
        { _type: 'Type', id: 1, name: 'Task', color: '#1A67A3', position: 1, isDefault: true, isMilestone: false, _links: { self: { href: '/api/v3/types/1' } } },
        { _type: 'Type', id: 2, name: 'Bug', color: '#E03131', position: 2, isDefault: false, isMilestone: false, _links: { self: { href: '/api/v3/types/2' } } },
        { _type: 'Type', id: 3, name: 'Feature', color: '#82C91E', position: 3, isDefault: false, isMilestone: false, _links: { self: { href: '/api/v3/types/3' } } },
        { _type: 'Type', id: 4, name: 'Milestone', color: '#CC5DE8', position: 4, isDefault: false, isMilestone: true, _links: { self: { href: '/api/v3/types/4' } } }
      ]
    },
    _links: { self: { href: '/api/v3/types' } }
  },
  '/api/v3/queries': { _type: 'Collection', total: 0, count: 0, _embedded: { elements: [] }, _links: { self: { href: '/api/v3/queries' } } },
  '/api/v3/versions': { _type: 'Collection', total: 0, count: 0, _embedded: { elements: [] }, _links: { self: { href: '/api/v3/versions' } } },
  '/api/v3/time_entries': { _type: 'Collection', total: 0, count: 0, _embedded: { elements: [] }, _links: { self: { href: '/api/v3/time_entries' } } },
  '/api/v3/activities': { _type: 'Collection', total: 0, count: 0, _embedded: { elements: [] }, _links: { self: { href: '/api/v3/activities' } } },
  '/api/v3/notifications': { _type: 'Collection', total: 0, count: 0, _embedded: { elements: [] }, _links: { self: { href: '/api/v3/notifications' } } },
  '/api/v3/grids': { _type: 'Collection', total: 0, count: 0, _embedded: { elements: [] }, _links: { self: { href: '/api/v3/grids' } } },
  '/api/v3/relations': { _type: 'Collection', total: 0, count: 0, _embedded: { elements: [] }, _links: { self: { href: '/api/v3/relations' } } },
  '/api/v3/news': { _type: 'Collection', total: 0, count: 0, _embedded: { elements: [] }, _links: { self: { href: '/api/v3/news' } } },
};

function getMockResponse(pathname) {
  const basePath = pathname.split('?')[0];

  // Direct match
  if (MOCK_DATA[basePath]) {
    return MOCK_DATA[basePath];
  }

  // Users/me endpoint
  if (basePath === '/api/v3/users/me') {
    return currentUser || {
      _type: 'User',
      id: 1,
      login: CONFIG.CLOUD_USERNAME,
      firstName: 'Cloud',
      lastName: 'Admin',
      name: 'Cloud Admin',
      email: 'admin@cloud.local',
      admin: true,
      status: 'active',
      language: 'en',
      _links: { self: { href: '/api/v3/users/1' } }
    };
  }

  // Pattern matching for collections
  const patterns = [
    { pattern: /^\/api\/v3\/statuses/, mock: MOCK_DATA['/api/v3/statuses'] },
    { pattern: /^\/api\/v3\/priorities/, mock: MOCK_DATA['/api/v3/priorities'] },
    { pattern: /^\/api\/v3\/types/, mock: MOCK_DATA['/api/v3/types'] },
    { pattern: /^\/api\/v3\/queries/, mock: MOCK_DATA['/api/v3/queries'] },
    { pattern: /^\/api\/v3\/versions/, mock: MOCK_DATA['/api/v3/versions'] },
    { pattern: /^\/api\/v3\/time_entries/, mock: MOCK_DATA['/api/v3/time_entries'] },
    { pattern: /^\/api\/v3\/activities/, mock: MOCK_DATA['/api/v3/activities'] },
    { pattern: /^\/api\/v3\/notifications/, mock: MOCK_DATA['/api/v3/notifications'] },
    { pattern: /^\/api\/v3\/grids/, mock: MOCK_DATA['/api/v3/grids'] },
    { pattern: /^\/api\/v3\/relations/, mock: MOCK_DATA['/api/v3/relations'] },
    { pattern: /^\/api\/v3\/news/, mock: MOCK_DATA['/api/v3/news'] },
  ];

  for (const { pattern, mock } of patterns) {
    if (pattern.test(basePath)) {
      return mock;
    }
  }

  return null;
}

// ============================================================================
// API PROXY
// ============================================================================

async function proxyToCloudApi(req, res, pathname) {
  await ensureAuthenticated();

  const cloudUrl = new URL(pathname, CONFIG.CLOUD_API_URL);
  if (req.url.includes('?')) {
    cloudUrl.search = req.url.split('?')[1];
  }

  const options = {
    method: req.method,
    hostname: cloudUrl.hostname,
    port: cloudUrl.port || 80,
    path: cloudUrl.pathname + cloudUrl.search,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }
  };

  if (jwtToken) {
    options.headers['Authorization'] = `Bearer ${jwtToken}`;
  }

  console.log(`[PROXY] ${req.method} ${pathname} -> ${cloudUrl.href}`);

  try {
    let body = null;
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      body = await new Promise((resolve) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(data));
      });
    }

    const response = await httpRequest(options, body);

    console.log(`[PROXY] Response: ${response.statusCode}`);

    res.writeHead(response.statusCode, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(response.body);
  } catch (err) {
    console.error(`[PROXY ERROR] ${err.message}`);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ _type: 'Error', message: err.message }));
  }
}

// ============================================================================
// WORKFLOW API (Port 8086)
// ============================================================================

async function callWorkflowApi(action, payload) {
  await ensureAuthenticated();

  const workflowUrl = new URL('/workflow/secure-call', CONFIG.WORKFLOW_API_URL);

  const options = {
    method: 'POST',
    hostname: workflowUrl.hostname,
    port: workflowUrl.port || 80,
    path: workflowUrl.pathname,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }
  };

  if (jwtToken) {
    options.headers['Authorization'] = `Bearer ${jwtToken}`;
  }

  const requestBody = JSON.stringify([{ action, payload }]);

  console.log(`[WORKFLOW] ${action} -> ${workflowUrl.href}`);

  const response = await httpRequest(options, requestBody);
  const results = JSON.parse(response.body);

  // Workflow API returns array of results
  if (Array.isArray(results) && results.length > 0) {
    const result = results[0];
    if (result.error) {
      throw new Error(result.error.message || JSON.stringify(result.error));
    }
    return result;
  }

  throw new Error('Invalid workflow API response');
}

async function handleCreateProject(req, res) {
  try {
    const body = await new Promise((resolve) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => resolve(data));
    });

    const projectData = JSON.parse(body);

    // Map to workflow API payload format
    const payload = {
      identifier: projectData.identifier,
      name: projectData.name,
      description: projectData.description || '',
      active: projectData.active !== false,
      public: projectData.public || false,
      status_explanation: projectData.status_explanation || projectData.statusExplanation || ''
    };

    // Only add parent_id if it's a valid non-zero value
    if (projectData.parent_id && projectData.parent_id > 0) {
      payload.parent_id = projectData.parent_id;
    }

    const result = await callWorkflowApi('createProject', payload);

    console.log(`[WORKFLOW] Project created: ${result.data?.id}`);

    res.writeHead(result.status || 201, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(result.data));
  } catch (err) {
    console.error(`[WORKFLOW ERROR] ${err.message}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ _type: 'Error', message: err.message }));
  }
}

// ============================================================================
// STATIC FILE SERVER
// ============================================================================

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

function serveStaticFile(res, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      // Serve index.html for SPA routing
      const indexPath = path.join(CONFIG.STATIC_DIR, 'index.html');
      fs.readFile(indexPath, (err2, indexContent) => {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(indexContent);
        }
      });
    } else {
      const ext = path.extname(filePath).toLowerCase();
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mimeType });
      res.end(content);
    }
  });
}

// ============================================================================
// MAIN REQUEST HANDLER
// ============================================================================

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  console.log(`[${new Date().toISOString()}] ${req.method} ${pathname}`);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  // API routes
  if (pathname.startsWith('/api/v3')) {
    // Check for mock data first
    const mockResponse = getMockResponse(pathname);
    if (mockResponse && req.method === 'GET') {
      console.log(`[MOCK] ${pathname}`);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify(mockResponse));
      return;
    }

    // Use Workflow API for creating projects (POST /api/v3/projects)
    if (pathname === '/api/v3/projects' && req.method === 'POST') {
      console.log(`[WORKFLOW] Intercepting createProject request`);
      await handleCreateProject(req, res);
      return;
    }

    // Proxy to cloud API
    await proxyToCloudApi(req, res, pathname);
    return;
  }

  // Static files
  let filePath = path.join(CONFIG.STATIC_DIR, pathname);
  if (pathname === '/' || !path.extname(pathname)) {
    filePath = path.join(CONFIG.STATIC_DIR, 'index.html');
  }

  serveStaticFile(res, filePath);
});

// ============================================================================
// START SERVER
// ============================================================================

server.listen(CONFIG.PORT, async () => {
  // Pre-authenticate
  await ensureAuthenticated();

  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║          OpenProject Standalone Frontend Server                       ║
║                                                                       ║
║    NO RAILS - NO POSTGRESQL - PURE FRONTEND + CLOUD API               ║
╠══════════════════════════════════════════════════════════════════════╣
║  Local Server:    http://localhost:${CONFIG.PORT}                              ║
║  Cloud API:       ${CONFIG.CLOUD_API_URL.padEnd(47)} ║
║  Static Files:    ${CONFIG.STATIC_DIR.slice(-47).padEnd(47)} ║
║  Auth User:       ${CONFIG.CLOUD_USERNAME.padEnd(47)} ║
╠══════════════════════════════════════════════════════════════════════╣
║  API calls proxied to Cloud API with JWT authentication               ║
║  Missing endpoints (statuses, priorities, etc.) return mock data      ║
╚══════════════════════════════════════════════════════════════════════╝
`);
});
