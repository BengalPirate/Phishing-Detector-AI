# Testing

This document is the source of truth for automated test coverage, manual browser verification, and current test gaps.

## Automated Tests And Coverage

The current automated baseline is focused on the checked environment: **Chrome on macOS**, plus deterministic source-level checks that do not require live model downloads or cross-browser automation.

Run from `extension/`:

```bash
npm run test:all      # build + automated tests
npm run test:coverage # Node test runner coverage report
npm run audit:deps    # dependency vulnerability audit
```

Coverage areas:

| Area | Covered by |
|---|---|
| Unit tests | Prompt building/parsing, verdict-band reconciliation, provenance hashing |
| Contract/API tests | Ollama `/api/tags` and `/api/chat` adapter shape, streaming chunks, CORS failure messaging |
| Static integration tests | Chrome MV3 manifest, CSP, side-panel DOM wiring, package targets, README matrix consistency |
| Security tests | Host permission allowlist, no broad `<all_urls>`, no `eval`/`new Function`, generated output rendered with `textContent` |
| Dependency vulnerability tests | `npm audit --audit-level=high` |
| Performance tests | Built side-panel bundle size budget |
| Regression tests | Removed backend/popup references, prompt/schema stability, canonical phishing prompt examples |
| Model accuracy tests | Prompt-level regression baselines only; live WebLLM/Ollama inference is still manual |

Current automated tests do **not** replace the browser matrix below. They do not yet launch Chrome with the unpacked extension, download WebLLM models, exercise microphone/audio playback, or validate Safari/Edge/Firefox/Windows/Linux behavior.

## Browser And OS Matrix

Target coverage: **4 browsers x 3 OSes = 12 environments**. Safari is macOS-only, so its Windows/Linux cells are **N/A** (10 real environments).

### How To Load Per Browser

- **Chrome / Edge:** `chrome://extensions` (or `edge://extensions`) -> Developer mode -> **Load unpacked** -> `extension/build/chrome`.
- **Firefox:** `about:debugging` -> This Firefox -> **Load Temporary Add-on** -> `extension/build/firefox/manifest.json` (WebGPU needs **Firefox 141+**).
- **Safari (macOS):** open the generated Xcode project (`extension/build/safari-xcode/...`), set your signing Team, Run, then enable it in Safari > Settings > Extensions.

### Per-Environment Checklist

What a pass means:

1. **Loads**: extension installs with no manifest/CSP errors; side panel, sidebar, or popup opens; Terms/Privacy gate appears and accepts.
2. **In-browser model**: load **Recommended (Qwen2.5-3B)**; it downloads/caches; **Analyze** a known phishing sample returns a sensible verdict; **Chat** replies.
3. **Voice**: enable **Speak replies**; voice downloads once and speaks; panel stays scrollable while speaking.
4. **Ollama**: if installed, **Advanced -> Refresh models -> Connect** succeeds; analysis and chat work; assistant messages show the **External model** badge.
5. **Polish**: dark mode toggles; selected-text/right-click analysis works; provenance **Export** downloads a record.

### Status

Legend: pass = checked, untested = not checked yet, fail = checked and failing, N/A = not applicable.

| Environment | Loads | In-browser | Voice | Ollama |
|---|---|---|---|---|
| **Chrome - macOS** | pass | pass | pass | pass |
| **Chrome - Windows** | untested | untested | untested | untested |
| **Chrome - Linux** | untested | untested | untested | untested |
| **Edge - macOS** | untested | untested | untested | untested |
| **Edge - Windows** | untested | untested | untested | untested |
| **Edge - Linux** | untested | untested | untested | untested |
| **Firefox - macOS** | untested | untested | untested | untested |
| **Firefox - Windows** | untested | untested | untested | untested |
| **Firefox - Linux** | untested | untested | untested | untested |
| **Safari - macOS** | untested | untested | untested | untested |
| **Safari - Windows** | N/A | N/A | N/A | N/A |
| **Safari - Linux** | N/A | N/A | N/A | N/A |

## Known Per-Environment Caveats

- **WebGPU** is needed only for the in-browser model, not Ollama. Chrome/Edge support is broad; Firefox needs **141+**; Safari needs **26+ / recent macOS**. Where WebGPU is unavailable, the **Ollama** path can still work.
- **Firefox** uses a sidebar (`sidebar_action`) instead of the Chrome side panel. Voice/ONNX under MV3 is the most likely failure point; note console errors.
- **Safari** must be built via Xcode and uses a popup because there is no side-panel API. It requires an Apple Developer signing identity.
- **Ollama** needs the one-time `OLLAMA_ORIGINS` setup. The in-app **Advanced** card shows OS-specific steps.

## Linux Notes

The extension itself is distro-agnostic because it runs in the browser. A single mainstream distro, such as Ubuntu, can verify the in-browser path. Whether the in-browser model works depends on the machine's **GPU driver / WebGPU support** (Mesa version), not the distro family. If WebGPU is unavailable, use Ollama.

The Linux-variable part is the **Ollama `OLLAMA_ORIGINS` setup**, which depends on the **init system**, not the distro itself. Verify once per init family:

| Linux family | Setup method | Verified |
|---|---|---|
| **systemd** - Debian/Ubuntu, Fedora/RHEL, Arch, openSUSE | systemd drop-in override, as shown by the in-app command | untested |
| **NixOS** | `services.ollama.environmentVariables.OLLAMA_ORIGINS = "chrome-extension://<your-id>";` in `configuration.nix`, then `nixos-rebuild switch` | untested |
| **Gentoo / non-systemd (OpenRC), or manual** | stop Ollama, then `OLLAMA_ORIGINS="chrome-extension://<your-id>" ollama serve` | untested |

The in-app **Advanced** card lists all three for Linux, since the extension cannot reliably detect the distro.

## Current Coverage Snapshot

Last verified locally:

- `npm run test:all`: 26/26 passing.
- `npm run test:coverage`: 97.80% line coverage across modules included in Node's coverage report.
- `npm run audit:deps`: 0 high-severity vulnerabilities reported.

Coverage currently includes `src/prompts.js`, `src/provenance.js`, and `src/ollamaEngine.js`. Browser-bound modules such as `sidepanel.js`, `chatPanel.js`, `settings.js`, `ttsService.js`, and `ragStore.js` are covered indirectly by static integration/security checks, not by runtime unit coverage.

## Release Gate Recommendation

For Chrome/macOS releases, require:

- `npm run test:all` passes.
- `npm run audit:deps` passes.
- Chrome/macOS manual checklist remains pass.
- Any prompt/schema changes update prompt regression tests.
- Any manifest/CSP/permission changes update static security tests.

For broader releases, add real browser verification for each target browser/OS row before marking it pass.
