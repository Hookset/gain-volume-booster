# Security Best Practices Report

## Executive Summary

The third-party handoff identified two real issues and one invalid manifest key. The original all-sites injection concern has since been resolved: Gain now uses `activeTab` for click-to-use activation and requests persistent Firefox host access only for explicitly whitelisted sites.

## Critical

No critical findings.

## High

No high-severity findings.

## Medium

No medium-severity findings.

## Low

### AUDIT-001
- Severity: Low
- Location: `CODEX_HANDOFF_v1.1.md:68-122`
- Evidence: The handoff recommends pairing `WeakMap` with a strong `Set` of elements for rebuild iteration.
- Impact: That proposed `Set` would still retain detached media elements and undercut the stated garbage-collection benefit.
- Fix: Use a `WeakMap` for membership/source lookup and rescan current DOM media elements during rebuild, which is what was implemented in `content.js`.
- Mitigation: Keep rebuild logic tied to live DOM state instead of maintaining another strong-reference registry.
- False positive notes: The underlying leak in the original `sourceNodes` array was real. The issue is with the handoff's replacement design, not the diagnosis.

### AUDIT-002
- Severity: Low
- Location: `CODEX_HANDOFF_v1.1.md:127-160`, `background.js:21`, `content.js:172`
- Evidence: The handoff claims any extension or content script can reach these `runtime.onMessage` listeners.
- Impact: That overstates the exposure. In Firefox WebExtensions, external extension traffic is handled by `runtime.onMessageExternal`, not `runtime.onMessage`.
- Fix: Do not add redundant sender-ID checks as a primary security control here. If message hardening is needed later, validate payload shape instead.
- Mitigation: Keep message handling narrow by accepted message type and avoid adding sensitive operations to these listeners without a fresh review.
- False positive notes: This does not mean all message listeners are inherently safe. It means this specific recommendation is based on the wrong API boundary.

### AUDIT-003
- Severity: Low
- Location: `CODEX_HANDOFF_v1.1.md:164-170`, `background.js:4-19`
- Evidence: The handoff correctly notes unhandled badge errors, but prescribes `runtime.lastError` callback wrapping for `browser.browserAction.*` calls.
- Impact: The issue is real, but the prescribed fix is not the best fit for a `browser.*` codebase that otherwise uses promise-style APIs.
- Fix: A promise-safe wrapper was implemented around badge updates to suppress benign closed-tab failures without changing behavior.
- Mitigation: Reuse the helper for any future badge mutations.
- False positive notes: This is a disagreement with the implementation strategy, not with the need to handle badge failures.

## Implemented Changes

- `content.js`
  - Replaced the strong-reference `sourceNodes` array with a `WeakMap`.
  - Reconnects sources by scanning live `audio` and `video` elements during rebuild, avoiding the `Set`-based leak in the handoff proposal.
  - Extracted audio tuning values into an `AUDIO` constants object.
- `background.js`
  - Added a small wrapper to suppress benign badge update failures when tabs disappear mid-update.
  - Added auto-injection only for whitelisted sites that also have explicit host permission.
- `manifest.json`
  - Removed `strict_min_version_android`.
  - Bumped the extension version to `1.0.1`.
  - Restored `activeTab` and moved blanket host access out of install-time permissions into `optional_permissions`.
  - Removed the manifest-wide content script registration.
- `popup.js` / `popup.html`
  - Added click-to-use injection on the active tab via `activeTab`.
  - Added an "Always allow on this site" action that requests per-site permission and adds the site to the whitelist.
- `options.html`
  - Updated the visible version string to `1.0.1` so the UI matches the manifest.
  - Updated permission and whitelist copy to match the new per-site access model.
- `options.js`
  - Whitelist additions now request site permission.
  - Whitelist removals revoke the associated site permission.

## Validation Notes

- `manifest.json` was parsed successfully with PowerShell's `ConvertFrom-Json`.
- JavaScript syntax validation could not be completed in this environment because both `node.exe` and the Node MCP runtime failed with `Access is denied`.
