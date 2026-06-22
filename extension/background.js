// Firehouse extension — handles Google sign-in via chrome.identity so it works
// from the toolbar popup (which would otherwise close mid-OAuth). The resulting
// session is written to chrome.storage and read back by the popup.

importScripts("lib/supabase.js");

const SUPABASE_URL = "https://vicfnkbsrcmemhffuqyq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable__ouGswb_yT67VCufAJY-Zg_KVw5b_tv";

// chrome.storage-backed storage so the popup and worker share one session.
const chromeStorageAdapter = {
  getItem: (key) => chrome.storage.local.get(key).then((r) => r[key] ?? null),
  setItem: (key, value) => chrome.storage.local.set({ [key]: value }),
  removeItem: (key) => chrome.storage.local.remove(key),
};

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: chromeStorageAdapter,
    persistSession: true,
    // The service worker sleeps when idle, so a recurring refresh timer just
    // throws "No SW". The popup (a normal page) refreshes the session instead.
    autoRefreshToken: false,
    detectSessionInUrl: false,
    flowType: "pkce",
  },
  // Realtime isn't used and its Worker/WebSocket setup isn't available in a
  // service worker — keep it from initializing.
  realtime: { params: {} },
});

async function doSignIn() {
  const redirectTo = chrome.identity.getRedirectURL(); // https://<id>.chromiumapp.org/
  const { data, error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: {
      skipBrowserRedirect: true,
      redirectTo,
      queryParams: { hd: "kula.ai", prompt: "select_account" },
    },
  });
  if (error) throw error;

  const redirectUrl = await chrome.identity.launchWebAuthFlow({
    url: data.url,
    interactive: true,
  });
  const u = new URL(redirectUrl);
  const code = u.searchParams.get("code");
  if (!code) {
    throw new Error(u.searchParams.get("error_description") || "Sign-in was cancelled.");
  }
  const { error: exErr } = await sb.auth.exchangeCodeForSession(code);
  if (exErr) throw exErr;
  return true;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "signin") {
    doSignIn()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true; // async response
  }
  if (msg && msg.type === "signout") {
    sb.auth.signOut()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg && msg.type === "redirectUrl") {
    sendResponse({ url: chrome.identity.getRedirectURL() });
    return false;
  }
});
