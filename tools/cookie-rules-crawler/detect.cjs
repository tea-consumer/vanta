// Runs inside a page (or frame) via Playwright's evaluate(). Finds a visible
// cookie banner that has a reject button and returns CSS selectors for both,
// in the same shape as Firefox's click rules: { presence, optOut }.
// Self-contained on purpose: Playwright serializes this function by source.
//
// Returns one of:
//   { kind: "rule", presence, optOut, rejectText }
//   { kind: "no-reject", presence }   banner found, but only accept/settings
//   { kind: "shadow" }                banner lives in a shadow root (not ruleable)
//   null                              no banner
function vantaDetectBanner() {
  const COOKIE_WORDS =
    /cookie|consent|gdpr|rgpd|dsgvo|informasjonskapsl|samtykke|personvern|kakor|samtycke|datenschutz|einwilligung|consentement|consentimiento|consenso|toestemming|zgod|privacidad|privacy|tracking|evästee|sušenk|süti/i;

  // Whole-label matches only, after normalize(). A label that merely contains
  // one of these words ("Reject cookies? Learn more") is not a button label.
  const REJECT_EXACT = new Set([
    // English
    "reject", "reject all", "reject all cookies", "reject cookies",
    "reject optional cookies", "reject non-essential cookies",
    "reject non-essential", "reject additional cookies", "decline",
    "decline all", "decline cookies", "decline all cookies",
    "decline optional cookies", "deny", "deny all", "deny cookies",
    "refuse", "refuse all", "refuse cookies", "disagree", "i disagree",
    "i do not agree", "do not accept", "i decline", "no thanks",
    "only necessary", "necessary only", "only essential", "essential only",
    "only necessary cookies", "necessary cookies only",
    "essential cookies only", "only essential cookies",
    "use necessary cookies only", "use essential cookies only",
    "allow necessary only", "allow essential only",
    "allow only necessary cookies", "allow only essential cookies",
    "accept necessary", "accept only necessary", "accept necessary only",
    "accept necessary cookies", "accept only necessary cookies",
    "accept essential", "accept only essential", "accept essential cookies",
    "accept only essential cookies", "accept required cookies",
    "accept only required cookies", "required only", "only required",
    "continue without accepting", "continue without agreeing",
    "strictly necessary only", "refuse non-essential cookies",
    // Norwegian
    "avvis", "avvis alle", "avvis alt", "avvis cookies",
    "avvis informasjonskapsler", "avslå", "avslå alle", "avslå alt",
    "nekt", "nekt alle", "kun nødvendige", "bare nødvendige",
    "kun nødvendige informasjonskapsler", "godta kun nødvendige",
    "tillat kun nødvendige", "godta nødvendige", "kun nødvendige cookies",
    "bare nødvendige informasjonskapsler", "jeg avslår",
    // Swedish
    "avvisa", "avvisa alla", "neka", "neka alla", "endast nödvändiga",
    "bara nödvändiga", "acceptera endast nödvändiga",
    "tillåt endast nödvändiga", "endast nödvändiga cookies",
    "godkänn endast nödvändiga",
    // Danish
    "afvis", "afvis alle", "afslå", "afslå alle",
    "kun nødvendige cookies", "tillad kun nødvendige",
    "accepter kun nødvendige", "kun nødvendige", "afvis cookies",
    // German
    "ablehnen", "alle ablehnen", "alles ablehnen", "cookies ablehnen",
    "verweigern", "alle verweigern", "nur notwendige",
    "nur notwendige cookies", "nur essenzielle", "nur essenzielle cookies",
    "nur erforderliche", "nur erforderliche cookies",
    "nur notwendige cookies akzeptieren", "nur notwendige akzeptieren",
    "nur essenzielle cookies akzeptieren", "nicht akzeptieren",
    "nicht einverstanden", "optionale ablehnen", "ablehnen und schließen",
    // French
    "refuser", "tout refuser", "refuser tout", "je refuse",
    "refuser les cookies", "refuser tous les cookies",
    "continuer sans accepter", "refuser et fermer",
    "uniquement les cookies nécessaires", "cookies nécessaires uniquement",
    "accepter uniquement les cookies nécessaires",
    // Spanish / Portuguese / Italian
    "rechazar", "rechazar todo", "rechazar todas", "rechazar cookies",
    "rechazar todas las cookies", "denegar", "no acepto",
    "solo necesarias", "solo cookies necesarias", "rejeitar",
    "rejeitar tudo", "rejeitar todos", "recusar", "recusar tudo",
    "apenas necessários", "rifiuta", "rifiuta tutto", "rifiuta tutti",
    "solo necessari", "continua senza accettare", "nega",
    // Dutch
    "weigeren", "alles weigeren", "weiger", "weiger alles",
    "weiger alle", "afwijzen", "alles afwijzen", "alleen noodzakelijke",
    "alleen noodzakelijk", "alleen noodzakelijke cookies",
    "alleen functionele cookies", "niet akkoord",
    // Polish / Finnish / Czech
    "odrzuć", "odrzuć wszystkie", "odrzucam", "tylko niezbędne",
    "hylkää", "hylkää kaikki", "vain välttämättömät", "odmítnout",
    "odmítnout vše",
  ]);

  const normalize = s =>
    (s || "")
      .replace(/\s+/g, " ")
      .replace(/[.!×✕✖]+$/u, "")
      .trim()
      .toLowerCase();

  const isVisible = el =>
    el.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) &&
    el.getClientRects().length > 0;

  const labelOf = el =>
    normalize(
      el.innerText || el.value || el.getAttribute("aria-label") || el.title
    );

  // Class names that look generated by a bundler or CSS-in-JS change on every
  // deploy, so a rule built on them would break silently.
  const looksGenerated = s =>
    /\d{3,}|^(css|sc|jsx|emotion|styled|svelte|tw)-|^_|[a-z][0-9][a-z][0-9]|__[a-zA-Z0-9]{5,}$|^[a-f0-9]{6,}$/.test(
      s
    ) && !/cookie|consent|cmp|gdpr|banner/i.test(s);

  const esc = s => CSS.escape(s);

  function uniqueIn(root, sel, el) {
    try {
      const all = root.querySelectorAll(sel);
      return all.length === 1 && all[0] === el;
    } catch {
      return false;
    }
  }

  // A stable selector for el, unique within root.
  function selectorFor(el, root) {
    const tag = el.localName;
    if (el.id && !looksGenerated(el.id)) {
      const s = "#" + esc(el.id);
      if (uniqueIn(root, s, el)) return s;
    }
    for (const a of ["data-testid", "data-test", "data-cy", "data-action",
      "data-role", "data-cookie-action", "data-cookiefirst-action",
      "data-tracking", "name"]) {
      const v = el.getAttribute(a);
      if (v && !looksGenerated(v) && v.length < 60) {
        const s = `${tag}[${a}="${v.replace(/"/g, '\\"')}"]`;
        if (uniqueIn(root, s, el)) return s;
      }
    }
    const classes = [...el.classList].filter(c => !looksGenerated(c));
    if (classes.length) {
      // Fewest classes that still make it unique.
      for (let n = 1; n <= Math.min(classes.length, 3); n++) {
        const s = tag + classes.slice(0, n).map(c => "." + esc(c)).join("");
        if (uniqueIn(root, s, el)) return s;
      }
    }
    return null;
  }

  // Walk up from the button to the banner: the outermost ancestor that is
  // still "the banner" (fixed/sticky/dialog, or mentions cookies) without
  // being the whole page.
  function bannerFor(btn) {
    let best = null;
    const vw = innerWidth, vh = innerHeight;
    for (let el = btn.parentElement; el && el !== document.body &&
      el !== document.documentElement; el = el.parentElement) {
      const r = el.getBoundingClientRect();
      if (r.width * r.height > vw * vh * 0.98 && best) break;
      const cs = getComputedStyle(el);
      const floating = cs.position === "fixed" || cs.position === "sticky" ||
        el.localName === "dialog" || el.getAttribute("role") === "dialog" ||
        el.getAttribute("aria-modal") === "true";
      const text = el.innerText || "";
      if (text.length > 6000) break;
      if (COOKIE_WORDS.test(text) && (floating || !best)) best = el;
      if (floating && best) {
        // Prefer the floating element itself when it still mentions cookies.
        if (COOKIE_WORDS.test(text)) best = el;
        break;
      }
    }
    return best;
  }

  const buttons = document.querySelectorAll(
    'button, a, [role="button"], input[type="button"], input[type="submit"]'
  );
  let noReject = null;
  for (const btn of buttons) {
    const label = labelOf(btn);
    if (!label || label.length > 60 || !REJECT_EXACT.has(label)) continue;
    if (!isVisible(btn)) continue;
    const banner = bannerFor(btn);
    if (!banner || !isVisible(banner)) continue;

    // Prefer a stable banner selector; climb a little if the nearest one
    // has nothing stable to select by.
    let container = banner, presence = null;
    for (let i = 0; i < 4 && container && container !== document.body; i++) {
      presence = selectorFor(container, document);
      if (presence) break;
      container = container.parentElement;
    }
    if (!presence) continue;

    const inner = selectorFor(btn, container);
    if (!inner) continue;
    const optOut = `${presence} ${inner}`;
    if (!uniqueIn(document, optOut, btn)) continue;
    return { kind: "rule", presence, optOut, rejectText: label };
  }

  // Stats only: is there a cookie banner here we can't reject?
  for (const el of document.querySelectorAll(
    '[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i]'
  )) {
    if (isVisible(el) && (el.innerText || "").length > 40) {
      noReject = { kind: "no-reject", presence: selectorFor(el, document) };
      break;
    }
  }
  if (!noReject) {
    for (const el of document.querySelectorAll("*")) {
      if (el.shadowRoot && COOKIE_WORDS.test(el.shadowRoot.textContent || "") &&
        isVisible(el)) {
        return { kind: "shadow", host: el.localName + (el.id ? "#" + el.id : "") };
      }
    }
  }
  return noReject;
}

// Clicks a rule's reject button the way Firefox's CookieBannerChild does and
// reports whether the banner went away.
function vantaApplyRule({ presence, optOut }) {
  const visible = el =>
    el && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const banner = document.querySelector(presence);
  if (!visible(banner)) return "no-banner";
  const btn = document.querySelector(optOut);
  if (!btn) return "no-button";
  btn.click();
  return "clicked";
}

function vantaBannerGone({ presence }) {
  const el = document.querySelector(presence);
  return !el || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
}

if (typeof module !== "undefined") {
  module.exports = { vantaDetectBanner, vantaApplyRule, vantaBannerGone };
}
