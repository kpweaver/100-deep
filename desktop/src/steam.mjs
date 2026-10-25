/**
 * Steamworks integration point (groundwork).
 *
 * When the game ships on Steam, install steamworks.js (npm i steamworks.js)
 * and put the App ID in steam_appid.txt next to the executable (or set
 * STEAM_APP_ID).  Until then this is a no-op so the desktop build runs
 * without Steam.  Achievements, rich presence and cloud saves hook in here.
 */
export async function initSteam() {
  const appId = Number(process.env.STEAM_APP_ID || 0);
  if (!appId) return null;
  try {
    const steamworks = await import('steamworks.js');
    const client = steamworks.init(appId);
    steamworks.electronEnableSteamOverlay?.();
    console.log(`[steam] initialised for app ${appId} as ${client.localplayer.getName()}`);
    return client;
  } catch (e) {
    console.warn('[steam] not available:', e?.message ?? e);
    return null;
  }
}
