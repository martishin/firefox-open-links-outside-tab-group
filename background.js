/**
 * Open Links Outside Tab Group
 * When a link is opened from a grouped tab, the new tab is placed directly after that group.
 */

/** MDN: ungrouped tabs have groupId === tabGroups.TAB_GROUP_ID_NONE (-1). */
const TAB_GROUP_ID_NONE =
  (browser.tabGroups && typeof browser.tabGroups.TAB_GROUP_ID_NONE === "number")
    ? browser.tabGroups.TAB_GROUP_ID_NONE
    : -1;

/** True if the tab currently belongs to a tab group. */
const isGrouped = (tab) =>
  !!tab && typeof tab.groupId === "number" && tab.groupId !== TAB_GROUP_ID_NONE;

/** Track {current, previous} active tab per window (helps when the new tab steals focus). */
const lastTwoActiveByWindow = new Map();
browser.tabs.onActivated.addListener(({ tabId, windowId }) => {
  const rec = lastTwoActiveByWindow.get(windowId) || {};
  if (rec.current !== tabId) {
    rec.previous = rec.current;
    rec.current = tabId;
    lastTwoActiveByWindow.set(windowId, rec);
  }
});

/** Prefer the real opener; fall back to the previously active tab in the window. */
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

/** Return the highest tab index within the given group in a window, or -1 if none. */
async function lastIndexOfGroup(groupId, windowId) {
  const groupTabs = await browser.tabs.query({ windowId, groupId });
  let end = -1;
  for (const t of groupTabs) if (t.index > end) end = t.index;
  return end;
}

/** Ensure the tab is not in any group, prefer native tabs.ungroup. */
async function ensureUngrouped(tabId, windowId) {
  if (browser.tabs.ungroup) {
    try { await browser.tabs.ungroup([tabId]); return; } catch {}
  }
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
  // Fetch opener to get current groupId.
  let fetchedOpener;
  try { fetchedOpener = await browser.tabs.get(opener.id); } catch { return; }
  if (!isGrouped(fetchedOpener)) return;

  const winId = fetchedOpener.windowId;
  const groupId = fetchedOpener.groupId;

  // Ensure the tab is in the right window.
  if (newTab.windowId !== winId) {
    try { await browser.tabs.move(newTab.id, { windowId: winId, index: -1 }); } catch { return; }
  }

  // 1) Ungroup first so it won’t be counted inside the group.
  await ensureUngrouped(newTab.id, winId);

  // 2) Compute boundary and move to end + 1.
  const end = await lastIndexOfGroup(groupId, winId);
  if (end < 0) return; // group disappeared

  const allTabs = await browser.tabs.query({ windowId: winId });
  const target = Math.min(allTabs.length, end + 1);

  try {
    await browser.tabs.move(newTab.id, { windowId: winId, index: target });
  } catch {}
}

/** Act only when the opener is grouped; otherwise no-op. */
browser.tabs.onCreated.addListener(async (tab) => {
  if (!tab) return;

  const opener = await getOpenerForNewTab(tab);
  if (!opener || !isGrouped(opener)) return;

  await moveDirectlyAfterGroup(tab, opener);
});
