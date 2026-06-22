// Firehouse launcher — clicking the pinned toolbar icon opens the app
// in a focused popup window (reused if already open).

const APP_URL = "https://skkula.github.io/firehouse/";
const WIN_W = 400;
const WIN_H = 660;
const MARGIN = 16;

let firehouseWindowId = null;

// Figure out the top-right corner of the active display.
async function topRightPosition() {
  let screenW = 1440, screenLeft = 0, screenTop = 0; // sensible fallback
  try {
    const displays = await chrome.system.display.getInfo();
    const primary = displays.find(d => d.isPrimary) || displays[0];
    if (primary) {
      screenW = primary.workArea.width;
      screenLeft = primary.workArea.left;
      screenTop = primary.workArea.top;
    }
  } catch (e) { /* permission missing or unavailable — use fallback */ }
  return {
    left: Math.max(0, screenLeft + screenW - WIN_W - MARGIN),
    top: screenTop + MARGIN
  };
}

chrome.action.onClicked.addListener(async () => {
  // If our window is still open, just focus it.
  if (firehouseWindowId !== null) {
    try {
      await chrome.windows.get(firehouseWindowId);
      await chrome.windows.update(firehouseWindowId, { focused: true });
      return;
    } catch (e) {
      firehouseWindowId = null; // window was closed
    }
  }

  const { left, top } = await topRightPosition();
  const win = await chrome.windows.create({
    url: APP_URL,
    type: "popup",
    width: WIN_W,
    height: WIN_H,
    left,
    top,
    focused: true
  });
  firehouseWindowId = win.id;
});

// Forget the window once it's closed so the next click opens a fresh one.
chrome.windows.onRemoved.addListener((closedId) => {
  if (closedId === firehouseWindowId) firehouseWindowId = null;
});
