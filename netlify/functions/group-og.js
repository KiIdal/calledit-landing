// /g/<code>/og.png — 1200x630 Apple-Sports-styled share preview.
// Renders via satori (JSX › SVG) + resvg (SVG › PNG). Cached on the
// CDN for 5 minutes per code so iMessage/WhatsApp scrapes are cheap.

const satori = require('satori').default || require('satori');
const { Resvg } = require('@resvg/resvg-js');
const { isValidCode, extractCode, getGroupPreview, truncate, loadFonts, loadAdditionalAsset } = require('./_shared');

const NEON = '#00FF87';
const BG_TOP = '#0A0A0F';
const BG_BOT = '#1A1A2F';
const RED = '#FF3B30';

// Satori takes plain object trees with `type` + `props`. JSX would
// require a Babel/JSX runtime — overkill for a single image template.
// `el(tag, style, ...children)` keeps the layout readable.
//
// Satori is strict: every <div> with more than one child must declare
// `display: flex` (or none). We default it on every element so the
// render tree stays simple and we never trip the "expected display"
// error. Override with `display: 'block'`-equivalents only when needed.
function el(type, style, ...children) {
  const flat = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
  const finalStyle = { display: 'flex', ...style };
  return { type, props: { style: finalStyle, children: flat.length === 1 ? flat[0] : flat } };
}

function renderTree(preview) {
  // Fallback layout when the code didn't resolve — still ships a
  // branded image so dead-link previews don't look broken.
  if (!preview) {
    return el('div', {
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      backgroundImage: `linear-gradient(180deg, ${BG_TOP} 0%, ${BG_BOT} 100%)`,
      padding: 80, color: 'white',
    },
      el('div', { fontFamily: 'Outfit', fontWeight: 700, fontSize: 96, color: NEON }, 'Called It'),
      el('div', { fontFamily: 'Inter', fontWeight: 400, fontSize: 32, marginTop: 24, opacity: 0.7 },
        'The social prediction game'),
    );
  }

  const memberWord = preview.member_count === 1 ? 'MEMBER' : 'MEMBERS';
  const recent = (preview.recent_bets || []).slice(0, 3);

  return el('div', {
    width: '100%', height: '100%', flexDirection: 'column',
    backgroundImage: `linear-gradient(180deg, ${BG_TOP} 0%, ${BG_BOT} 100%)`,
    padding: '44px 64px', color: 'white',
  },
    // Top row: LIVE indicator
    preview.has_active_bets
      ? el('div', { alignItems: 'center', gap: 12, marginBottom: 16 },
          el('div', { width: 12, height: 12, borderRadius: 6, backgroundColor: RED }),
          el('div', { fontFamily: 'Inter', fontWeight: 500, fontSize: 18, letterSpacing: 2, color: 'white' },
            `LIVE  ·  ${preview.active_count} ACTIVE BET${preview.active_count === 1 ? '' : 'S'}`),
        )
      : el('div', { height: 12, marginBottom: 16 }),

    // Group identity block
    el('div', { flexDirection: 'column', alignItems: 'center', gap: 6 },
      el('div', {
        fontFamily: 'Outfit', fontWeight: 700, fontSize: 56, lineHeight: 1.05,
        letterSpacing: -1.0, color: 'white', textAlign: 'center', maxWidth: 980,
      }, truncate(preview.name, 60)),
      el('div', { fontSize: 40 }, preview.emoji || '🎯'),
    ),

    // Big member count
    el('div', { flexDirection: 'column', alignItems: 'center', marginTop: 14 },
      el('div', {
        fontFamily: 'Outfit', fontWeight: 700, fontSize: 96, lineHeight: 1,
        color: NEON, letterSpacing: -2,
      }, String(preview.member_count)),
      el('div', {
        fontFamily: 'Inter', fontWeight: 500, fontSize: 18, letterSpacing: 4,
        color: 'rgba(255,255,255,0.7)',
      }, memberWord),
    ),

    // Divider
    el('div', {
      width: '100%', height: 1, backgroundColor: 'rgba(255,255,255,0.18)',
      marginTop: 22, marginBottom: 18,
    }),

    // Recent activity
    recent.length > 0
      ? el('div', { flexDirection: 'column', gap: 4 },
          el('div', {
            fontFamily: 'Inter', fontWeight: 500, fontSize: 16,
            letterSpacing: 2, color: 'rgba(255,255,255,0.55)', marginBottom: 4,
          }, 'RECENT ACTIVITY'),
          ...recent.map((b) =>
            el('div', {
              fontFamily: 'Inter', fontWeight: 400, fontSize: 22,
              color: 'rgba(255,255,255,0.92)', lineHeight: 1.3,
            }, `›  ${truncate(b.question, 56)}`),
          ),
        )
      : el('div', {
          fontFamily: 'Inter', fontWeight: 400, fontSize: 22,
          color: 'rgba(255,255,255,0.7)', fontStyle: 'italic',
        }, 'Bets land here once friends are in.'),

    // Spacer pushes the CTA to the bottom
    el('div', { flex: 1 }),

    // CTA pill
    el('div', { justifyContent: 'center' },
      el('div', {
        fontFamily: 'Outfit', fontWeight: 700, fontSize: 28,
        color: NEON, letterSpacing: -0.5,
      }, 'Open in Called It ›'),
    ),
  );
}

exports.handler = async (event) => {
  const code = extractCode(event);
  if (!isValidCode(code)) {
    return { statusCode: 400, body: 'Invalid code' };
  }

  try {
    const [preview, fonts] = await Promise.all([
      getGroupPreview(code),
      loadFonts(),
    ]);

    const svg = await satori(renderTree(preview), {
      width: 1200,
      height: 630,
      fonts,
      loadAdditionalAsset,
    });

    const png = new Resvg(svg, {
      fitTo: { mode: 'width', value: 1200 },
    }).render().asPng();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'image/png',
        // 5 min CDN cache, immutable enough for share previews. Group
        // changes propagate to new scrapes within 5 min.
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
      body: png.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error('group-og render error:', err);
    return { statusCode: 500, body: 'Render failed' };
  }
};
