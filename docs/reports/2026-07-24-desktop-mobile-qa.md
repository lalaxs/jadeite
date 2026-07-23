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
