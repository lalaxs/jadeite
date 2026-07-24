# Desktop and Mobile QA

## Desktop

| Viewport | Overview regions unchanged | Chat clear | Workshop third column visible | Center scroll resets | Console |
|---|---|---|---|---|---|
| 1280×720 | Pass | Pass | Pass | Pass | Clean |
| 1440×900 | Pass | Pass | Pass | Pass | Clean |

### Evidence

- [1280×720 overview](screenshots/2026-07-24/desktop-1280-overview.png)
- [1280×720 workshop](screenshots/2026-07-24/desktop-1280-workshop.png)
- [1440×900 overview](screenshots/2026-07-24/desktop-1440-overview.png)
- [1440×900 workshop](screenshots/2026-07-24/desktop-1440-workshop.png)

The desktop shell retained its topbar, left navigation, center content, right affairs panel and bottom chat regions. The body had no horizontal overflow at either viewport. All three workshop detail columns remained inside the center region, and switching views reset only `#mainStage` from a tested scroll offset of 335 back to 0.

## Mobile

| Viewport | Overview/nav | Auction controls | Workshop | Shop modal | Affairs/chat | Horizontal access | Console |
|---|---|---|---|---|---|---|---|
| 390×844 | Pass | Pass | Pass | Pass | Pass | Pass | Clean |
| 430×932 | Pass | Pass | Pass | Pass | Pass | Pass | Clean |

### Evidence

- [390×844 overview](screenshots/2026-07-24/mobile-390-overview.png)
- [390×844 auction](screenshots/2026-07-24/mobile-390-auction.png)
- [390×844 workshop](screenshots/2026-07-24/mobile-390-workshop.png)
- [390×844 workshop detail](screenshots/2026-07-24/mobile-390-workshop-detail.png)
- [390×844 affairs drawer](screenshots/2026-07-24/mobile-390-affairs.png)
- [390×844 chat drawer](screenshots/2026-07-24/mobile-390-chat.png)
- [390×844 material modal](screenshots/2026-07-24/mobile-390-material-modal.png)
- [430×932 overview](screenshots/2026-07-24/mobile-430-overview.png)
- [430×932 workshop](screenshots/2026-07-24/mobile-430-workshop.png)

The mobile implementation reuses the desktop DOM. The topbar, horizontal feature navigation and main content stack without overlap; the affairs and chat drawers are mutually exclusive and expose synchronized `aria-expanded` states. All measured interactive controls were at least 44px tall, every checked view stayed within the viewport width, the workshop detail collapsed to one column, and the material modal remained fully visible and closable.

## Core-loop regression

| Scenario | Result |
|---|---|
| Opening → planning/carving → finishing | Pass |
| Per-device active job count | Pass: 0/1 or 1/1 only |
| Waiting production queue | Pass: none implemented or shown |
| Equipment purchase, durability loss and repair | Pass |
| Recruitment, paid refresh and 8-person cap | Pass |
| Exhausted free recruit batch stays empty until paid refresh | Pass |
| Worker busy state across workshop/live work | Pass |
| Finishing plan compatibility and live quote | Pass |
| Incompatible finishing options stay visible, disabled, with reasons | Pass |
| Insufficient material/cash leaves state unchanged | Pass |
| Finishing failure refunds jade and materials | Pass |
| Successful finish persists full inlay metadata | Pass |
| Missing or duplicate mutation request IDs are rejected | Pass |
| Collection action and collection metadata | Pass |
| Order product selector metadata | Pass |
| Market listing metadata | Pass |

The browser pass used a shortened local timing profile only to avoid waiting through prototype production timers. The same authoritative server functions are covered by the normal automated test suite.

### Finishing and metadata evidence

- [Desktop finishing plan](screenshots/2026-07-24/task7-finish-plan-desktop.png)
- [Desktop collection metadata](screenshots/2026-07-24/task8-collection-metadata-desktop.png)
- [390×844 collection metadata](screenshots/2026-07-24/task8-collection-metadata-390x844.png)

The finishing plan stayed within the desktop viewport and showed product type, setting, compatible metal, polish, gem count, backing, inventory requirements, labor cost and value multiplier. At 390×844 and 430×932, the collection card and its complete inlay summary stayed within the viewport width with no horizontal document overflow.

## Automated verification

Final command: `npm test`

Covered suites: loop, auction, server-idle, tasks, equipment, employee, inlay, rules, renderer, opening, volume, canvas, simplified flow, UI overlay and responsive layout.

### Browser-found corrections

- Reset the inherited desktop grid rows below 768px so the topbar, navigation and main content do not overlap.
- Reset the mobile topbar from sticky to static to keep the 336px resource block from covering content.
- Reset the inherited sidepanel `top` offset so a closed drawer is fully off-screen.
- Override the chat input and navigation-item specificity conflicts to preserve 44px controls and horizontal labels.
- Unmount the independent material picker after selection so its invisible cards cannot cover the workshop start button.
- Preserve the collapsed stage-inventory drawer state across server renders so the collection action remains reachable.
- Preserve an exhausted first recruit batch so new candidates require the explicit ¥500 refresh.
- Reject missing mutation request IDs and require them on legacy workshop/live-sale compatibility events.
- Keep incompatible product, setting and metal options visible but disabled with an explicit reason.
