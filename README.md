# Open Links Outside Group (Firefox)

Open links outside the current tab group in Firefox (works nicely with vertical tabs + native groups).

- **Context menu**: right-click any link → **Open Link Outside Group**.
- **Auto mode** (toggle via toolbar button): any tab opened from another tab is automatically placed **outside** the group (no drag needed).

### Why?
Firefox doesn't expose a built-in preference to force links from grouped tabs to open outside the group. This extension automates it.

### Permissions
- `tabs`: moving/ungrouping tabs
- `contextMenus`: the right-click item
- `storage`: save the Auto mode toggle
No data collection or remote requests.

### Local dev
```bash
# Install web-ext: https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/
npm i -g web-ext

# Lint & run temporarily
web-ext lint
web-ext run
```

### Package & sign
- Manual: upload the ZIP to AMO Developer Hub.
- CI: see `.github/workflows/ci.yml` for building, linting, and optional signing with `web-ext sign`.

### License
MIT
