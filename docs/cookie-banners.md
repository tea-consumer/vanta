# Cookie banners: reject automatically

Vanta says no to cookie consent prompts on its own, in normal and private
windows. It never clicks "accept".

## Where it comes from

Firefox had this built in (`toolkit/components/cookiebanners`), but Mozilla
deleted it in Firefox 155 (bug 2058143) and froze its rule list in September
2024. Vanta puts Mozilla's code back as a patch and keeps it working:

| File | What it is |
| --- | --- |
| `patches/cookiebanners-1-restore-mozilla.patch` | Mozilla's removal, reversed. Mozilla code only. |
| `patches/cookiebanners-2-speed-and-vanta-rules.patch` | Vanta's speed changes and rule loader. |
| `cookiebanners/vanta-rules.json` | Vanta's own rules, loaded after Mozilla's. |
| `prefs/vanta.js` | Turns it on in reject-only mode. |

## How it rejects, cheapest first

1. **Cookie injection.** For about 200 sites Mozilla's list knows the
   "rejected" cookie. Vanta sets it on the request before the page loads, so
   the banner never appears and no page script runs. This is native code in
   the network stack: one hash lookup per top-level page load.
2. **Clicking "reject all".** For other sites with a rule, and for common
   consent platforms on any site, a small script finds the banner and clicks
   its reject button. Rules with only an accept button are dropped, since
   Vanta never accepts.

## Speed changes over Mozilla's version

Mozilla's clicker watched every DOM change on the page (a MutationObserver on
the whole body, attributes included) for up to 20 seconds. On pages that
change their DOM constantly, like web apps and Speedometer's workloads, that
costs time even when there is no banner. Vanta instead:

- checks at most every 500 ms, and only when the page is idle;
- tests every banner selector in one `querySelector` call, so a page without
  a banner costs one DOM lookup per check;
- skips rules that have nothing to click in reject-only mode;
- runs consent-platform rules only in the top page, not in every iframe
  (`cookiebanners.service.enableGlobalRules.subFrames = false`);
- stops looking 10 s after DOMContentLoaded (Mozilla: 20 s), or 5 s after load;
- stops for a site after 3 tries per session (Mozilla's default).

The service itself starts at idle priority after startup, as in Firefox.

## Vanta's rules

`cookiebanners/vanta-rules.json` uses Mozilla's rule format
(`toolkit/components/cookiebanners/schema/CookieBannerRule.schema.json`).
Rules with an empty `domains` list apply to every site. A rule with the same
`id` as one of Mozilla's global rules replaces it; a site rule replaces
Mozilla's rule for that domain.

Added consent platforms, each reject selector checked against the vendor's
own current script or markup unless noted: CookieYes, Cookie Notice (WP),
CookieLawInfo (WP), iubenda, Osano, Klaro, Cookie-Script, Moove GDPR (WP),
HubSpot, Shopify, tarteaucitron, cookieconsent (Insites), cookieconsent v3
(orestbida), Didomi (reject button added to Mozilla's accept-only rule), and
Google Funding Choices (not checked: it only serves its banner in the EU).

Not covered: platforms that draw their banner inside a closed shadow DOM
(Usercentrics, newer Axeptio) and ones whose reject button sits on a second
screen. Hiding banners that can't be rejected is the ad blocker's job, not
this feature's.

## Turning it off

`about:config`: set `cookiebanners.service.mode` (and
`cookiebanners.service.mode.privateBrowsing`) to `0`.
