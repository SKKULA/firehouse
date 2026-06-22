// Firehouse launcher — clicking the pinned toolbar icon opens the app
// in a focused popup window (reused if already open).

const APP_URL = "https://skkula.github.io/firehouse/";
const WIN_W = 440;
const WIN_H = 720;

let firehouseWindowId = null;

chrome.action.onClicked.addListener(async () => {
  // If our window is still open, just focus it.
  if (firehouseWindowId !== null) {
    try {
      const win = await chrome.windows.get(firehouseWindowId);
      if (win) {
        await chrome.windows.update(firehouseWindowId, { focused: true });
        return;
      }
    } catch (e) {
      firehouseWindowId = null; // window was closed
    }
  }

  // Otherwise open a new compact popup window.
  const win = await chrome.windows.create({
    url: APP_URL,
    type: "popup",
    width: WIN_W,
    height: WIN_H
  });
  firehouseWindowId = win.id;
});

// Forget the window once it's closed so the next click opens a fresh one.
chrome.windows.onRemoved.addListener((closedId) => {
  if (closedId === firehouseWindowId) firehouseWindowId = null;
});
