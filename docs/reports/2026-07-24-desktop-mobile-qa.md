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

### Browser-found corrections

- Reset the inherited desktop grid rows below 768px so the topbar, navigation and main content do not overlap.
- Reset the mobile topbar from sticky to static to keep the 336px resource block from covering content.
- Reset the inherited sidepanel `top` offset so a closed drawer is fully off-screen.
- Override the chat input and navigation-item specificity conflicts to preserve 44px controls and horizontal labels.
