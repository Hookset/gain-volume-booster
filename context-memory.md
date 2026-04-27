# Context Memory

## What is currently being worked on
- Documenting the shipped permission and whitelist behavior in a README variant for manual comparison.

## Recent changes
- Created this `context-memory.md` to establish required session tracking for the project.
- Fixed the `content.js` media-source retention issue with a `WeakMap` plus live DOM rescan during rebuild, instead of the audit's leaking `Set` design.
- Extracted audio tuning numbers into a named `AUDIO` constants block for maintainability.
- Added promise-safe badge update wrappers in `background.js` to suppress benign closed-tab badge errors.
- Removed the invalid `strict_min_version_android` key from `manifest.json`.
- Bumped the extension version to `1.0.1` in both `manifest.json` and the About screen.
- Wrote `security_best_practices_report.md` with audit disagreements and remaining concerns.
- Reworked the extension permission model to use `activeTab` for click-to-use activation and `optional_permissions` for per-site persistent access.
- Removed manifest-wide `content_scripts` injection and replaced it with popup-driven injection plus background auto-injection only for explicitly whitelisted sites.
- Updated whitelist add/remove flows so they grant and revoke Firefox site access, not just local list entries.
- Updated the popup and settings copy to match the new permission model.
- Fixed the clunky whitelist UX by adding a `Not now` dismissal path for the popup permission card.
- Moved popup-triggered whitelist persistence into the background so the site is recorded even when Firefox closes the popup for the permission prompt.
- Added a background `permissions.onAdded` hook so newly granted site permissions can auto-inject into matching open tabs without requiring the user to reopen the popup.
- Added background resets for open tabs when filter mode changes or when affected domains are added/removed from blacklist or whitelist.
- Changed blocked/unsupported popup state to render a cleared 100% / no-boost view instead of stale remembered gain values.
- Made whitelist mode strict even when the whitelist is empty, so switching to whitelist immediately blocks non-whitelisted sites.
- Changed the neutral audio state in `content.js` to reconnect media directly to `audioCtx.destination` instead of always leaving it routed through the processing chain.
- Added `README2.md` as a minimally updated alternative to `README.md`, covering the click-to-use permission model, per-site persistent access, and strict whitelist behavior.
- Replaced the popup blocked-banner `innerHTML` assignment with `textContent` to satisfy AMO's unsafe DOM assignment warning.
- Raised `browser_specific_settings.gecko.strict_min_version` to `142.0` so it matches the minimum Firefox version required by `data_collection_permissions` and clears the AMO manifest warning.
- Fixed the popup blocked-banner text on restricted Firefox pages by replacing leftover HTML-escaped apostrophes with plain text after the `textContent` switch.

## Current known issues or blockers
- JavaScript syntax validation could not be completed because both shell `node.exe` execution and the Node MCP fallback failed with access-denied errors.
- Extension removal may still leave the current page's audio graph alive until the page is refreshed. This appears tied to Web Audio media-element rerouting rather than the popup/filter logic.

## Next steps
- Re-run JS syntax checks in an environment where Node execution is allowed.
- Compare `README2.md` against the current `README.md` and merge any preferred wording manually.
- If extension-removal teardown needs to be improved, investigate a low-risk unload/disconnect cleanup path separately.

## Long-term scope and progress toward it
- Keep the extension stable, minimal, and compliant with Chrome extension security and permission expectations.
- Progress: audit review is complete, agreed fixes are implemented, the previous all-sites injection concern has been replaced with a per-site permission model, and whitelist behavior is now strict and immediate.
