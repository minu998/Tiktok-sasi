/* RTXFury — site config.
   Patching is 100% server-side: the browser uploads the video DIRECTLY to
   the Railway patch service (Vercel's 4.5 MB function body limit makes
   routing the video through /api/patch-void impossible — it 413s). The
   patch token is still minted by Vercel /api/authorize (tiny JSON), and the
   Void key stays on Railway. No client-side engine or API key ships to the
   browser. */
window.RTX = window.RTX || {};
// Railway patch service base URL — /api/patch-void is appended by the patcher.
window.RTX.PATCH_API_URL = "https://tiktok-sasi.vercel.app";
// Discord OAuth — Client ID from the Discord Developer Portal
// (Applications -> OAuth2 -> General). login.html uses this to build the
// authorize URL; the callback runs at DISCORD_REDIRECT_URI.
window.RTX.DISCORD_CLIENT_ID = "1534947287602827344";
window.RTX.DISCORD_REDIRECT_URI = "https://www.rtxfury.xyz/api/callback";
// Compare slider videos — same clip, two qualities:
window.RTX.VIDEO_HQ = "https://files.catbox.moe/c0bkgb.mp4"; // RIGHT side — After clip, compressed (2160x1216 @ 60fps, 23MB)
window.RTX.VIDEO_LQ = "https://files.catbox.moe/5s1mq1.mp4"; // LEFT side — Before clip, compressed (720x406 @ 15fps, 3MB)

// Discord invite shown in the footer / FAQ support note.
window.RTX.DISCORD_INVITE = "https://discord.gg/ApzyyrNupd";
window.RTX.DISCORD_PREMIUM_CHANNEL = "https://discord.com/channels/1396835411510300780/1538322900560511066";
