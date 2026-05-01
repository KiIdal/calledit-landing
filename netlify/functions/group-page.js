// /g/<code> — HTML landing page for share-link previews.
//
// Job:
//   1. Serve OG meta tags pointing at /g/<code>/og.png so iMessage,
//      WhatsApp, Slack, Twitter, etc. render the rich preview card.
//   2. Auto-redirect human visitors:
//      - iOS → app deep link (called-it://join/<code>) with App Store
//        fallback after 1.5 s if the app isn't installed.
//      - Everyone else → App Store listing.
//   3. Surface `apple-itunes-app` so Safari shows the smart banner
//      (and, once the App Clip target ships, the Clip card).

const { isValidCode, getGroupPreview, truncate } = require('./_shared');

const APP_STORE_URL = 'https://apps.apple.com/us/app/called-it-predict-friends/id6762042980';
const ASC_APP_ID = '6762042980';
const ORIGIN = 'https://calledit.one';

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function buildHtml(code, preview) {
  const title = preview
    ? `${preview.name} · ${preview.member_count} predicting on Called It`
    : 'Join this group on Called It';
  const desc = preview
    ? (preview.has_active_bets
        ? `${preview.active_count} active bet${preview.active_count === 1 ? '' : 's'}. Tap to join the prediction group.`
        : 'A new prediction group is forming. Tap to join.')
    : 'The social prediction game. Vote on real-world events, predict your friends.';
  const url = `${ORIGIN}/g/${code}`;
  const ogImage = `${ORIGIN}/g/${code}/og.png`;
  const safeTitle = escapeHtml(truncate(title, 96));
  const safeDesc = escapeHtml(truncate(desc, 200));

  return `<!DOCTYPE html>
<html lang="en" style="color-scheme: dark;">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#0A0A0F" />

  <title>${safeTitle}</title>
  <meta name="description" content="${safeDesc}" />
  <link rel="canonical" href="${url}" />

  <!-- Open Graph -->
  <meta property="og:site_name" content="Called It" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDesc}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${ogImage}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${safeTitle}" />

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDesc}" />
  <meta name="twitter:image" content="${ogImage}" />

  <!-- iOS Smart Banner / App Clip stub. Add app-clip-bundle-id once
       the Clip target ships in a separate sprint. -->
  <meta name="apple-itunes-app" content="app-id=${ASC_APP_ID}" />

  <link rel="icon" type="image/x-icon" href="/assets/favicon.ico" />
  <link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png" />

  <style>
    html, body { margin: 0; padding: 0; background: #0A0A0F; color: #fff; font-family: -apple-system, system-ui, sans-serif; }
    .wrap { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 24px; text-align: center; }
    h1 { font-size: 28px; margin: 0; }
    p { opacity: 0.7; margin: 0; }
    .cta { display: inline-block; padding: 12px 20px; border-radius: 12px; background: #00FF87; color: #0A0A0F; text-decoration: none; font-weight: 700; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${escapeHtml(preview?.name || 'Called It')}</h1>
    <p>${preview?.has_active_bets ? `${preview.active_count} active bet${preview.active_count === 1 ? '' : 's'} · ${preview.member_count} member${preview.member_count === 1 ? '' : 's'}` : 'Open this in the app to join.'}</p>
    <a class="cta" href="${APP_STORE_URL}">Get Called It</a>
  </div>

  <script>
    (function () {
      var code = ${JSON.stringify(code)};
      var deepLink = 'called-it://join/' + code;
      var appStore = ${JSON.stringify(APP_STORE_URL)};
      var ua = navigator.userAgent || '';
      var isIOS = /iPhone|iPad|iPod/.test(ua) && !window.MSStream;
      var isAndroid = /Android/.test(ua);
      // Don't bounce bots/crawlers — let them read the meta tags and render the OG card.
      var isBot = /bot|crawl|spider|slurp|facebookexternalhit|twitterbot|whatsapp|telegram|slack|discord|preview|imessage|applebot/i.test(ua);
      if (isBot) return;

      if (isIOS) {
        // Try the app first. If nothing intercepts in 1500 ms the
        // page is still here, so push the user to the App Store.
        var t = setTimeout(function () { window.location = appStore; }, 1500);
        // Cancel the fallback if the app actually grabbed the URL
        // (page becomes hidden / pagehide / freeze).
        function cancel() { clearTimeout(t); }
        document.addEventListener('visibilitychange', cancel, { once: true });
        window.addEventListener('pagehide', cancel, { once: true });
        window.location = deepLink;
      } else if (isAndroid) {
        // No Play Store presence yet — keep the user on the page
        // with the waitlist CTA on the main landing site.
        window.location = ${JSON.stringify(`${ORIGIN}/?code=${code}`)};
      } else {
        // Desktop or other — App Store page is the friendliest fallback.
        window.location = appStore;
      }
    })();
  </script>
</body>
</html>`;
}

exports.handler = async (event) => {
  const code = event.queryStringParameters?.code;
  if (!isValidCode(code)) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: '<!DOCTYPE html><html><body><h1>Invalid invite code</h1></body></html>',
    };
  }

  const preview = await getGroupPreview(code).catch((err) => {
    console.error('group-page preview fetch error:', err);
    return null;
  });

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Short CDN cache so group changes propagate quickly. Scrapers
      // (iMessage et al) re-fetch periodically so a 5-min window is
      // a fine balance between freshness and load.
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
    body: buildHtml(code, preview),
  };
};
