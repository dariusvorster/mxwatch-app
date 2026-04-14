# MxWatch — Frontend Redesign Prompt
## Paste this into Claude Code in the /Users/dariusvorster/Projects/Mxwatch-app directory

---

Redesign the MxWatch frontend. The app is at V3 and the current UI is too plain.
We have detailed mockups to follow exactly. Read this entire prompt before touching
any code.

---

## Design system (implement this first as CSS variables)

```css
/* Light mode (default) */
:root {
  --bg: #F8F9FB;
  --bg2: #F0F2F6;
  --surf: #FFFFFF;
  --surf2: #F4F6FA;

  --blue: #185FA5;
  --blue-dim: #E6F1FB;
  --blue-border: #B5D4F4;
  --blue-mid: #378ADD;

  --green: #0F6E56;
  --green-dim: #E1F5EE;
  --green-border: #9FE1CB;

  --amber: #854F0B;
  --amber-dim: #FAEEDA;
  --amber-border: #FAC775;

  --red: #A32D2D;
  --red-dim: #FCEBEB;
  --red-border: #F7C1C1;

  --text: #0D1117;
  --text2: #4A5568;
  --text3: #8892A4;

  --border: rgba(0, 0, 0, 0.07);
  --border2: rgba(0, 0, 0, 0.12);

  --mono: 'IBM Plex Mono', monospace;
  --sans: 'Inter', sans-serif;
  --radius: 12px;
  --radius-sm: 8px;
}

/* Dark mode */
.dark {
  --bg: #0B0E14;
  --bg2: #111520;
  --surf: #1C2333;
  --surf2: #232A3D;

  --blue: #4A9EFF;
  --blue-dim: #4A9EFF18;
  --blue-border: #4A9EFF40;
  --blue-mid: #378ADD;

  --green: #00C896;
  --green-dim: #00C89618;
  --green-border: #00C89640;

  --amber: #F5A623;
  --amber-dim: #F5A62318;
  --amber-border: #F5A62340;

  --red: #F55A5A;
  --red-dim: #F55A5A18;
  --red-border: #F55A5A40;

  --text: #E8EDF5;
  --text2: #8892A4;
  --text3: #4A5568;

  --border: #1E2738;
  --border2: #2A3450;
}
```

---

## Fonts

Add to layout.tsx or _document:
```
IBM Plex Mono (weights 400, 500, 600) — for all technical values, scores,
  domain names, code, DNS records, IP addresses, response times, labels
Inter (weights 300, 400, 500, 600) — for all body copy, navigation, descriptions
```

Both from Google Fonts.

---

## App shell

### Sidebar (220px, white background in light mode)

Top: Logo area
- SVG pulse/heartbeat icon (polyline zigzag in blue #378ADD)
- Wordmark: "mx" (dark) + "watch" (blue #378ADD) — IBM Plex Mono 15px 600
- Version badge: "v3" — IBM Plex Mono 8px, blue-dim bg, blue-border border

Nav sections (each with uppercase 10px 600 Inter label + 6px bottom margin):
- OVERVIEW: Dashboard, Activity
- MONITORING: Domains (count badge), Blacklists (red badge if any listed),
  DMARC reports (green badge), Certificates
- ALERTS: Alert rules, History

Active state: blue-dim background + blue-border border, blue text
Hover state: bg2 background
Icons: 14×14px SVG inline icons (not emoji, not lucide strings)

Bottom: User section
- 28px avatar circle (blue-dim bg, blue text, initials)
- Name + plan/version text
- Dark mode toggle button (moon/sun icon, 26px square, bg2 background)

### Topbar (white bg, 1px bottom border)
- Breadcrumb left: Inter 13px, text3 color, active page in bold text color
- Right: sync indicator (green dot + "synced Xm ago"), "+ Add domain" button
  (blue filled, IBM Plex Mono 12px)

---

## Dashboard page

### Summary cards row (4 columns, 12px gap)
Each card: white bg, 1px border, 12px radius, 16px 18px padding

1. Overall health — score number (IBM Plex Mono 28px 600, green if ≥80,
   amber if 60–79, red if <60) + trend badge (↑4 in green-dim or ↓n in red-dim)
2. Domains — count in blue + "X healthy · Y issues" subtext
3. RBL status — count of listed IPs in red if any, green "all clean" if none
4. DMARC reports — count in blue + "last 30 days"

### Domain health grid (2 columns, 12px gap)

Each domain card structure:
```
[left border accent: 3px — red=critical, amber=warning, green=healthy]
[header: 14px 16px padding]
  [score ring 44px] [domain name 14px 600 + subtext 11px text3] [status badge]
[checks row: 4 equal columns, 1px grid lines between]
  SPF | DKIM | DMARC | SMTP
  9px uppercase label + 11px mono value (green=pass, red=fail, amber=warn)
[footer: 8px 16px padding, bg background]
  [checked X min ago] [RBL: ✓ 8/8 clean OR ⚠ N listed]
```

Score ring: SVG circle, 44px, 4px stroke width
- Track circle: color-dim background
- Progress arc: color stroke, stroke-dasharray calculated from score
- Number centered: IBM Plex Mono 13px 600

Status badge: 10px 500 Inter, 3px 8px padding, 10px border-radius
- green-dim bg + green text = healthy
- red-dim bg + red text = issue/critical
- amber-dim bg + amber text = warning

### Active alerts section
Below domain grid, "Active alerts" label (same style as section labels)

Alert row: red-dim bg, red-border border, 10px radius, 12px 14px padding, flex row
- 28px icon square (red bg, white icon)
- Title (13px 500 red) + subtitle (11px text2)
- Timestamp (IBM Plex Mono 10px text3)
- Action button (outlined, red border/text)

---

## Domain detail page

### Domain header card (white bg, full width, 20px 24px padding)
Flex row:
- Score ring (64px, 5px stroke)
- Domain name (18px 600) + status badge inline
- Subtitle: mail server + IP
- Meta row: 3 items with coloured dots — SPF/DKIM/DMARC status, RBL status, SMTP
- Actions column right: "Run checks" (blue filled), "Settings" (outlined)

### Tab bar
Pill-style tabs in bg2 container with 3px padding:
Overview | DMARC | DNS records | Blacklists | SMTP | History
Active tab: white bg, subtle box-shadow, dark text
Inactive: text3 color

### Overview tab content

**DNS check cards (2×2 grid):**
Each card: white bg, 1px border, 12px radius
- Header: title (13px 600) + status badge, 1px bottom border
- Body: key/value rows (11px text3 key, IBM Plex Mono 11px value)
  Values coloured: green=pass/valid, red=fail, amber=warning

Cards: SPF, DKIM, DMARC, MX records

**RBL section:**
White bg card, full width
- Header: "Blacklist checks" + summary ("1 of 8 listed" in red or "all clean" in green)
- 4×2 grid of RBL items (1px grid lines between cells, 10px 12px padding each)
  - RBL name (IBM Plex Mono 10px text2)
  - Status (11px 600: green ✓ clean OR red ✗ listed)
  - Last checked time (9px text3)
- If any listed: red alert banner at bottom of card (flex row, icon + text + delist button)

**SMTP health card:**
- Header: "SMTP health" + connected badge
- 3-column grid: Response time | TLS version | Banner
  Each cell: 10px uppercase label + 16px IBM Plex Mono value + 10px subtext

---

## Dark mode implementation

Add a dark mode toggle to the sidebar footer (moon → sun icon).
Toggle adds/removes `.dark` class on `<html>` element.
Persist preference in localStorage key `mxwatch-theme`.
On load, read localStorage and apply class before render to avoid flash.

All colours use CSS variables so dark mode is automatic.

---

## Component checklist

Build in this order, confirm each before proceeding:

1. **Design tokens** — CSS variables file (light + dark), font imports in layout
2. **App shell** — sidebar + topbar layout, dark mode toggle wired
3. **Score ring component** — reusable SVG ring with score, accepts score + size props
4. **Status badge component** — severity-aware badge (healthy/warning/critical/info)
5. **Domain card component** — full card with ring, checks grid, footer
6. **Summary card component** — metric card with label, value, subtext, trend badge
7. **Dashboard page** — summary row + domain grid + alerts section
8. **Domain detail page** — header + tab bar + Overview tab content
   (DMARC/DNS/Blacklists/SMTP tabs can be stubs with "coming soon" for now)
9. **Alert row component** — used on dashboard and in history

---

## Implementation notes

- Keep existing tRPC data fetching — only change presentation layer
- Domain scores, check statuses, RBL results all come from existing API calls
- Do not change any API routes, DB schema, or backend logic
- Score calculation: if it doesn't exist yet, derive from check results:
  - Base: 100
  - SPF fail: -15, DKIM fail: -15, DMARC p=none: -10, DMARC missing: -20
  - Each RBL listing: -12
  - SMTP unreachable: -20, SMTP slow (>500ms): -5
- IBM Plex Mono for: domain names, IP addresses, DNS records, scores,
  response times, timestamps, badge counts, button labels
- Inter for: page titles, section labels, descriptions, nav labels, body copy
- Never hardcode colours — always use CSS variables
- All borders: 1px solid var(--border) or var(--border2)
- Card border-radius: var(--radius) = 12px
- Button border-radius: 7–8px
- No box-shadows except: active tab (subtle), cards (very subtle on light mode only)

---

## What NOT to change

- tRPC routers and procedures
- Database schema
- Monitoring job logic (node-cron)
- SMTP listener
- Authentication (better-auth)
- Docker configuration
- Any environment variables
- The data — only how it's displayed