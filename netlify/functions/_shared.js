// Shared helpers for /g/<code> share-preview functions.
// - Supabase client (anon key, RPC-only access)
// - Cached font loader (cold-start once per container)
// - Code validator
//
// The RPC `get_group_preview(p_code)` is callable from anon and projects
// only the safe-to-leak fields (name, emoji, member count, 3 active-bet
// questions). Anything else stays behind RLS.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

let _supabase = null;
function supabase() {
  if (!_supabase) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY env vars not set');
    }
    _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
  }
  return _supabase;
}

// 4-16 alphanumerics. Accept both cases — the RPC lower()s before lookup.
function isValidCode(code) {
  return typeof code === 'string' && /^[a-zA-Z0-9]{4,16}$/.test(code);
}

// Pulls the invite code out of the request. Netlify rewrites land here
// with the ORIGINAL path on `event.path` (e.g. "/g/bb6d6aa2/og.png")
// and an empty queryStringParameters — destination-side `?code=:code`
// substitution in netlify.toml doesn't propagate through to function
// invocations as we'd hope. So we parse the path directly. Falls back
// to the qs in case Netlify behavior changes or the function is hit
// via /.netlify/functions/<name>?code=… directly.
function extractCode(event) {
  const fromQs = event?.queryStringParameters?.code;
  if (typeof fromQs === 'string' && fromQs.length > 0) return fromQs;
  const path = (event?.path || '').replace(/\/+$/, '');
  const m = path.match(/^\/g\/([a-zA-Z0-9]{4,16})(?:\/og\.png)?$/);
  return m ? m[1] : null;
}

async function getGroupPreview(code) {
  const res = await supabase().rpc('get_group_preview', { p_code: code });
  if (res.error) {
    console.error('get_group_preview RPC error:', res.error.message);
    return null;
  }
  return res.data; // null when code unknown
}

// Debug helper — surfaces the full {data, error, status, statusText}
// shape so we can see what supabase-js returned without console-only logs.
async function getGroupPreviewRaw(code) {
  try {
    const res = await supabase().rpc('get_group_preview', { p_code: code });
    return {
      data: res.data,
      error: res.error ? { message: res.error.message, code: res.error.code, hint: res.error.hint } : null,
      status: res.status,
      statusText: res.statusText,
    };
  } catch (e) {
    return { thrown: String(e?.message || e) };
  }
}

// Truncate to ~50 chars for the OG layout. We word-break on the last
// space so we don't slice mid-word; falls back to hard-cut if there's
// no good break.
function truncate(s, max = 50) {
  if (!s) return '';
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const lastSpace = head.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? head.slice(0, lastSpace) : head).trimEnd() + '…';
}

// Font loader, module-cached so cold-start pays once per container.
// We fetch from jsdelivr's npm proxy (immutable + CDN-cached, 31536000s
// max-age) so the call is fast and won't go down without warning.
let _fonts = null;
async function loadFonts() {
  if (_fonts) return _fonts;
  const urls = {
    outfitBold:    'https://cdn.jsdelivr.net/npm/@fontsource/outfit@5.0.0/files/outfit-latin-700-normal.woff',
    interRegular:  'https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.0/files/inter-latin-400-normal.woff',
    interMedium:   'https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.0/files/inter-latin-500-normal.woff',
  };
  const [outfitBold, interRegular, interMedium] = await Promise.all([
    fetch(urls.outfitBold).then((r) => r.arrayBuffer()),
    fetch(urls.interRegular).then((r) => r.arrayBuffer()),
    fetch(urls.interMedium).then((r) => r.arrayBuffer()),
  ]);
  _fonts = [
    { name: 'Outfit', data: outfitBold,   weight: 700, style: 'normal' },
    { name: 'Inter',  data: interRegular, weight: 400, style: 'normal' },
    { name: 'Inter',  data: interMedium,  weight: 500, style: 'normal' },
  ];
  return _fonts;
}

// ─── Emoji loader (Twemoji SVG → data URI) ──────────────────────────────────
//
// Satori only renders glyphs present in the supplied fonts. Inter / Outfit
// don't ship emoji, so unsupplied graphemes render as tofu boxes. We hand
// satori an asynchronous lookup that fetches the Twemoji SVG for each
// emoji segment and returns it as a data URI. Module-cached so repeat
// emojis (the group emoji + any heart/fire/etc. inside the layout) don't
// re-fetch per request.
const _emojiCache = new Map();

function emojiToHex(segment) {
  const codePoints = [...segment]
    .map((c) => c.codePointAt(0))
    // Strip variation selector-16 (U+FE0F) — Twemoji filenames omit it.
    .filter((cp) => cp !== 0xfe0f);
  return codePoints.map((cp) => cp.toString(16)).join('-');
}

async function loadAdditionalAsset(code, segment) {
  if (code !== 'emoji') return undefined;
  if (_emojiCache.has(segment)) return _emojiCache.get(segment);
  const hex = emojiToHex(segment);
  const url = `https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/svg/${hex}.svg`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      _emojiCache.set(segment, undefined);
      return undefined;
    }
    const svg = await res.text();
    const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    _emojiCache.set(segment, dataUri);
    return dataUri;
  } catch {
    return undefined;
  }
}

module.exports = { supabase, isValidCode, extractCode, getGroupPreview, getGroupPreviewRaw, truncate, loadFonts, loadAdditionalAsset };
