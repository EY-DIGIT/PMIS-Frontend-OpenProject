# OpenProject Standalone Frontend

This is a standalone version of the OpenProject frontend that works **without Rails and PostgreSQL**. It connects directly to your Cloud API.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser                                  │
│                  http://localhost:4200                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Node.js Server (server.js)                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  • Serves Angular built files (dist/)                     │  │
│  │  • Serves index.html with configuration                   │  │
│  │  • Proxies /api/v3/* to Cloud API                        │  │
│  │  • Handles JWT authentication automatically               │  │
│  │  • Mocks missing endpoints (statuses, priorities, etc.)   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Cloud API (13.201.75.232:8000)                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Available Endpoints:                                      │  │
│  │  • /api/v3/users - User management                        │  │
│  │  • /api/v3/projects - Project management                  │  │
│  │  • /api/v3/work_packages - Work package management        │  │
│  │  • /api/v3/roles - Role management                        │  │
│  │  • /api/v3/meetings - Meeting management                  │  │
│  │  • /api/v3/work_package_types - Work package types        │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## What's Removed

| Component | Status |
|-----------|--------|
| Ruby on Rails | Removed |
| PostgreSQL Database | Removed |
| Redis Cache | Removed |
| Docker Containers | Not required |
| Server-side Rendering | Replaced with static HTML |

## What's Kept

| Component | Description |
|-----------|-------------|
| Angular Frontend | Full OpenProject Angular application |
| Node.js Server | Lightweight server for static files + API proxy |
| Cloud API | Your API at http://13.201.75.232:8000 |

## Quick Start

```bash
# 1. Navigate to frontend directory
cd frontend

# 2. Build the standalone version
npm run build:standalone

# 3. Start the server
npm run start:standalone

# 4. Open browser
open http://localhost:4200
```

## Configuration

Environment variables (optional):

```bash
# Server port (default: 4200)
PORT=4200

# Cloud API URL (default: http://13.201.75.232:8000)
CLOUD_API_URL=http://13.201.75.232:8000

# Cloud API credentials (default: admin/admin123)
CLOUD_API_USERNAME=admin
CLOUD_API_PASSWORD=admin123
```

## File Structure

```
frontend/
├── standalone/
│   ├── server.js      # Node.js server (API proxy + static files)
│   ├── index.html     # HTML template with configuration
│   ├── dist/          # Built Angular files (generated)
│   └── README.md      # This file
├── src/               # Angular source code
├── angular.json       # Angular configuration (has "standalone" config)
└── package.json       # npm scripts (build:standalone, start:standalone)
```

## How It Works

### 1. HTML Shell (index.html)

The `index.html` provides:
- Meta tags for OpenProject configuration
- `window.OpenProject` global object
- `window.gon` configuration (replaces Rails gon gem)
- `<openproject-base>` element for Angular to bootstrap

### 2. Node.js Server (server.js)

The server handles:
- **Static file serving**: Serves Angular built files
- **SPA routing**: Returns index.html for all non-file routes
- **API proxy**: Forwards `/api/v3/*` requests to Cloud API
- **JWT authentication**: Automatically authenticates with Cloud API
- **Mock endpoints**: Provides mock data for endpoints not in Cloud API

### 3. API Endpoint Mapping

| Request Path | Handler |
|--------------|---------|
| `/api/v3/projects` | Proxied to Cloud API |
| `/api/v3/users` | Proxied to Cloud API |
| `/api/v3/work_packages` | Proxied to Cloud API |
| `/api/v3/roles` | Proxied to Cloud API |
| `/api/v3/meetings` | Proxied to Cloud API |
| `/api/v3/statuses` | Mock data (not in Cloud API) |
| `/api/v3/priorities` | Mock data (not in Cloud API) |
| `/api/v3/types` | Mock data (not in Cloud API) |
| `/api/v3/configuration` | Mock data |
| `/*` | Static files / index.html |

## Mock Data

The following endpoints return mock data because they don't exist in your Cloud API:

- `/api/v3/statuses` - Work package statuses (New, In Progress, Closed, etc.)
- `/api/v3/priorities` - Priority levels (Low, Normal, High, Urgent)
- `/api/v3/types` - Work package types (Task, Bug, Feature, Milestone)
- `/api/v3/configuration` - System configuration
- `/api/v3/queries` - Saved queries (empty)
- `/api/v3/versions` - Project versions (empty)
- `/api/v3/time_entries` - Time tracking entries (empty)
- `/api/v3/activities` - Activity log (empty)
- `/api/v3/notifications` - User notifications (empty)

To add these endpoints to your Cloud API, implement them following the OpenProject API v3 specification.

## Limitations

1. **No real-time updates**: WebSocket connections are not implemented
2. **Limited features**: Some features that require Rails (e.g., file uploads, email) won't work
3. **Mock data**: Some endpoints return static mock data
4. **Single user mode**: Currently authenticates as a single cloud user

## Troubleshooting

### Blank page
- Check browser console for JavaScript errors
- Ensure the build completed successfully
- Verify the server is running

### API errors
- Check that Cloud API is accessible
- Verify credentials in server.js
- Check server logs for authentication errors

### Missing features
- Check if the required API endpoint exists in Cloud API
- Add mock data in server.js if needed

## Extending

### Adding new mock endpoints

Edit `server.js` and add to `MOCK_DATA`:

```javascript
MOCK_DATA['/api/v3/your_endpoint'] = {
  _type: 'Collection',
  total: 0,
  count: 0,
  _embedded: { elements: [] },
  _links: { self: { href: '/api/v3/your_endpoint' } }
};
```

### Adding new API proxy routes

The server automatically proxies all `/api/v3/*` routes that don't match mock data.

## License

Same as OpenProject - GNU GPL v3
