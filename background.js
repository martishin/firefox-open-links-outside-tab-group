/**
 * Open Outside Group (Grouped Tabs Only)
 * ------------------------------------------------------------
 * Behavior
 *  • If a new tab is opened from a grouped tab: explicitly ungroup it, then
 *    move it to the slot immediately AFTER the opener’s group.
 *  • If the opener is not grouped: do nothing (let Firefox handle placement).
 *
 * Rationale
 *  • Ungrouping first removes the new tab from the group before we compute the
 *    group boundary, eliminating the “one slot too far” off-by-one.
 *
 * Requirements
 *  • Firefox 138+ (WebExtensions tab groups).
 *
 * References
 *  • tabGroups.TAB_GROUP_ID_NONE (ungrouped == -1). :contentReference[oaicite:1]{index=1}
 *  • tabs.ungroup(): moving a tab outside a group also ungroups; we still ungroup
 *    first to make the boundary stable. :contentReference[oaicite:2]{index=2}
 *  • tabs.move(), tabs.query({ groupId }): placement & group filtering. :contentReference[oaicite:3]{index=3}
 */

const STABILIZE_MS = 25;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** MDN: ungrouped tabs have groupId === TAB_GROUP_ID_NONE (-1). */
const TAB_GROUP_ID_NONE =
  (browser.tabGroups && typeof browser.tabGroups.TAB_GROUP_ID_NONE === "number")
    ? browser.tabGroups.TAB_GROUP_ID_NONE
    : -1;

const isGrouped = (tab) =>
  tab && typeof tab.groupId === "number" && tab.groupId !== TAB_GROUP_ID_NONE;

/** Track {current, previous} active tab per window (covers ⌘+click). */
const lastTwoActiveByWindow = new Map();
browser.tabs.onActivated.addListener(({ tabId, windowId }) => {
  const rec = lastTwoActiveByWindow.get(windowId) || {};
  if (rec.current !== tabId) {
    rec.previous = rec.current;
    rec.current = tabId;
    lastTwoActiveByWindow.set(windowId, rec);
  }
});

/** Resolve the opener for a newly created tab. */
async function getOpenerForNewTab(newTab) {
  if (typeof newTab.openerTabId === "number") {
    try { return await browser.tabs.get(newTab.openerTabId); } catch {}
  }
  const rec = lastTwoActiveByWindow.get(newTab.windowId);
  const candidateId =
    rec && typeof rec.current === "number"
      ? (rec.current === newTab.id ? rec.previous : rec.current)
      : undefined;
  if (typeof candidateId === "number") {
    try { return await browser.tabs.get(candidateId); } catch {}
  }
  return null;
}

/** Return the last (max) index among all tabs in the given group within a window. */
async function lastIndexOfGroup(groupId, windowId) {
  const groupTabs = await browser.tabs.query({ windowId, groupId });
  let end = -1;
  for (const t of groupTabs) if (t.index > end) end = t.index;
  return end; // -1 if group not found
}

/** Ungroup the tab (prefer native API; fallback to a minimized hop if unavailable). */
async function ensureUngrouped(tabId, windowId) {
  if (browser.tabs.ungroup) {
    try { await browser.tabs.ungroup([tabId]); return; } catch {}
  }
  // Fallback: hop via minimized popup to break membership with minimal flicker.
  try {
    const tmp = await browser.windows.create({
      focused: false, state: "minimized", type: "popup", width: 50, height: 50, top: 0, left: 0
    });
    const tmpId = tmp.id;
    await browser.tabs.move(tabId, { windowId: tmpId, index: -1 });
    await browser.tabs.move(tabId, { windowId, index: -1 });
    try { await browser.windows.remove(tmpId); } catch {}
  } catch {}
}

/** Move the new tab to the slot immediately after the opener’s group. */
async function moveDirectlyAfterGroup(newTab, opener) {
  const winId = opener.windowId;

  // Let indices/group metadata settle; refresh opener for a stable groupId.
  await wait(STABILIZE_MS);
  let freshOpener = opener;
  try { freshOpener = await browser.tabs.get(opener.id); } catch { return; }
  if (!isGrouped(freshOpener)) return;
  const groupId = freshOpener.groupId;

  // Ensure the tab is in the right window.
  if (newTab.windowId !== winId) {
    try { await browser.tabs.move(newTab.id, { windowId: winId, index: -1 }); } catch { return; }
  }

  // 1) Explicitly ungroup the new tab first (so it won't be counted in the group).
  await ensureUngrouped(newTab.id, winId);

  // 2) Compute the boundary AFTER ungrouping, then drop at end + 1.
  const end = await lastIndexOfGroup(groupId, winId);
  if (end < 0) return; // group disappeared
  const allTabs = await browser.tabs.query({ windowId: winId });
  const target = Math.min(allTabs.length, end + 1);

  // 3) Single precise move to the target index.
  try { await browser.tabs.move(newTab.id, { windowId: winId, index: target }); } catch {
    // Rare timing race: brief retry.
    await wait(STABILIZE_MS);
    try {
      const end2 = await lastIndexOfGroup(groupId, winId);
      const all2 = await browser.tabs.query({ windowId: winId });
      const target2 = Math.min(all2.length, end2 + 1);
      await browser.tabs.move(newTab.id, { windowId: winId, index: target2 });
    } catch {}
  }
}

/** Auto: act ONLY when the opener is grouped; otherwise no-op. */
browser.tabs.onCreated.addListener(async (tab) => {
  if (!tab) return;

  const opener = await getOpenerForNewTab(tab);
  if (!opener || !isGrouped(opener)) return;

  await moveDirectlyAfterGroup(tab, opener);
});
