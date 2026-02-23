# PAIS GitHub Extension

**Proactive AI Safety (PAIS) friction for GitHub PR merges**

A Chrome extension that adds deliberation checkpoints to GitHub pull request merges, helping prevent hasty or accidental merges through tiered friction based on review readiness.

## Features

### 🛡️ Tier-3 Checkpoint Gate (Non-overridable)
Intercepts and requires explicit confirmation for:
- **Confirm merge** / **Confirm squash and merge** / **Confirm rebase and merge**
- **Enable auto-merge** (all variants)
- **Add to merge queue** / **Merge when ready**

Each checkpoint kind has method-specific modal copy and requires:
- Checking all acknowledgment boxes
- Typing "MERGE" to confirm

### 📊 Readiness Scoring (Mode 3)
Tracks review behavior signals:
- Tab visits (Conversation, Files changed, Checks)
- Time spent in diff view
- Scroll depth in diff
- Time from page load

Calculates a readiness score (0-1) and maps to:
- **Tier 0** (score ≥ 0.70): No nudge
- **Tier 1** (0.45-0.70): Non-blocking banner
- **Tier 2** (< 0.45): Blocking modal (overridable)

### 🔄 Safe Replay
Prevents double-submits by:
- One-shot allow tokens after checkpoint completion
- Event replay with original target preservation

### 🧭 Turbo Navigation Support
Works with GitHub's SPA navigation:
- URL polling for Turbo/PJAX changes
- MutationObserver for DOM updates
- History API interception

## Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `github-pais-guard` folder

### Configure

1. Click the extension icon in Chrome toolbar
2. Select "Options" to open settings
3. Review and customize policy if needed

## Development

### Project Structure

```
github-pais-guard/
├── manifest.json          # Extension manifest (MV3)
├── policy.json            # Default policy configuration
├── content.js             # Main content script
├── styles.css             # UI styles
├── options.html           # Settings page
├── options.js             # Settings logic
├── src/                   # Modular source (for reference)
│   ├── core/              # Navigation, state, interception
│   ├── policy/            # Policy, scoring, cooldowns
│   ├── ui/                # Modal and banner components
│   ├── metrics/           # Behavior tracking
│   └── utils/             # Storage, logger
└── tests/
    └── playwright/        # E2E tests
```

### Testing

```bash
# Install dependencies
npm install -D @playwright/test

# Install browsers
npx playwright install

# Run tests
npx playwright test --config tests/playwright/playwright.config.js
```

### Policy Configuration

The extension uses a JSON policy file for configuration:

```json
{
  "checkpoint_matchers": {
    "scope_selector": ".merge-box, [data-testid='mergebox']",
    "kinds": {
      "MERGE_NOW": {
        "patterns": ["^\\s*Confirm merge\\s*$", ...],
        "description": "Immediate merge confirmation"
      },
      ...
    }
  },
  "nudge_thresholds": {
    "signals": {
      "files_changed": 0.35,
      "checks_viewed": 0.25,
      "diff_time_target_ms": 60000,
      ...
    },
    "tier1_min": 0.70,
    "tier2_min": 0.45
  },
  "cooldowns": {
    "proactive_nudge_ms": 600000,
    "token_ttl_ms": 5000
  }
}
```

Edit via the Options page or directly modify `policy.json`.

## Privacy

- **Local-only logging**: All data stays in browser storage
- **No telemetry**: No data sent to external servers
- **Privacy-minimized**: No diff text, comments, or code captured
- **Ring buffer**: Old events automatically purged (default 1000 events)

## Architecture

### Event Flow

```
User clicks merge button
        ↓
Event Interceptor (capture phase)
        ↓
Classify action → Checkpoint kind?
        ↓
Log interception
        ↓
Show Tier-3 Modal
        ↓
User completes modal
        ↓
Create allow token
        ↓
Replay original event
        ↓
GitHub processes merge
```

### Readiness Scoring

```
Files viewed:          +0.35
Checks viewed:         +0.25
Diff time (scaled):    +0.00 to +0.20
Scroll depth ≥50%:     +0.10
Conversation viewed:   +0.10
Merge <30s:            -0.25
─────────────────────────────
Score range: 0 to 1

Tier mapping:
  ≥0.70 → Tier 0 (no nudge)
  0.45-0.70 → Tier 1 (banner)
  <0.45 → Tier 2 (blocking modal)
```

## Browser Support

- Chrome 88+ (Manifest V3)
- Edge 88+ (Chromium-based)
- Other Chromium browsers with MV3 support

## Roadmap

### Weekend MVP (Complete)
- ✅ Tier-3 gate for all merge methods
- ✅ Method-specific modals
- ✅ Safe replay (no double-submits)
- ✅ Local logging

### Week 1
- Shadow-mode readiness scoring
- All metrics tracked

### Week 2
- Tier-1 proactive banner
- Deep-links to tabs

### Week 3
- Tier-2 pre-merge nudges
- Override logging

### Week 4+
- Options/config UI polish
- Per-repo rules
- CI Playwright suite

## License

MIT License - See LICENSE file

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Submit a pull request

## Acknowledgments

- PAIS (Proactive AI Safety) methodology
- GitHub's Primer design system (UI inspiration)
- Chrome Extensions Manifest V3
