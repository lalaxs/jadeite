# 10 Minute Sealed Auction Design

## Goal

Unify the jade auction system around a simple recurring sealed auction:

- One auction round starts every 10 minutes.
- There is no separate registration phase and no separate formal bidding phase.
- A live round is immediately open for paid entry, window inspection, and sealed bids.
- Players never see other players' bids, current highest bid, or whether they are leading.
- Bid controls start from the stone's base price and provide dynamic increment buttons based on the player's own current bid.

## Current State

The current prototype uses a registration phase, a bidding phase, registration deposits, bid deposits, proxy maximum bids, AI filler bids, and a settlement display window. This design replaces the public interaction model with paid entry and direct sealed bids while preserving the valuable parts of the existing system:

- server-authoritative auction lifecycle
- hidden bid privacy
- one latest bid per player per stone
- paid public window reveals
- AI filler bids at settlement
- deterministic settlement on the server

## Auction Cadence

Each auction round lasts exactly 10 minutes in the normal timing profile. The test timing profile should use a shorter equivalent value for smoke tests.

At the end of a round, the server settles all lots and immediately creates the next live round. There is no waiting period that blocks entry or bidding. The UI may show the latest settlement results while the next round is already active.

The round has a single public phase:

- `live`: players may enter, open windows, and submit sealed bids.

Internally, settled rounds may still exist as historical results, but they are not treated as a separate player-facing phase.

## Entry Rule

Players can enter the current live auction at any time before the round ends.

Entry costs a non-refundable entry fee for the current round. The fee is paid once per player per round. After entry, the player may inspect and bid on any lot in that round.

Initial implementation should keep only the novice hall active, matching the current prototype. The existing hall list can remain visible, but inactive halls should not be enterable until later balance work.

## Lot Inspection

After entering the current round, a player may pay to open a window on a stone.

Window reveals remain public. If one player opens a window, all players in the auction can see the revealed window information.

For this implementation, keep the existing click-to-select window position behavior and existing maximum of 6 windows unless the user asks to revise the inspection model. The auction refactor should not also rebalance window pricing.

## Bidding Rule

After entering, a player can submit a direct sealed bid price for a specific stone.

Rules:

- One player can have at most one active bid per stone per round.
- Submitting again replaces that player's previous bid for the same stone.
- Bid amount must be at least the stone's base price.
- There is no proxy maximum field.
- There is no bid deposit or bid hold.
- The player pays nothing when submitting a bid.
- The winner pays the full final price at settlement.

## Dynamic Increment Buttons

The bid UI should show the stone's base price, the player's current bid, and quick increment buttons.

The increment buttons are based only on the player's own displayed bid. If the player has not bid yet, they are based on the base price. They are never based on other players' bids.

Use tiered increments so small stones and expensive stones feel natural:

| Current player bid | Quick increments |
| --- | --- |
| `< 1,000` | `+50`, `+100`, `+200` |
| `1,000 - 9,999` | `+100`, `+500`, `+1,000` |
| `10,000 - 99,999` | `+1,000`, `+2,000`, `+5,000` |
| `>= 100,000` | `+5,000`, `+10,000`, `+20,000` |

The UI should also allow manual numeric entry for players who want exact control.

## Settlement

At round end, the server settles each stone:

- Valid bids below the base price are ignored.
- Highest bid wins.
- If multiple bids have the same amount, the earliest submitted bid wins.
- If no valid human or AI bid exists, the stone passes.
- AI filler bids still supplement thin participation at settlement.

The final price is the winner's direct bid amount. Since proxy maximum bidding is removed, there is no second-price "just enough to win" calculation in this version.

If a human winner has enough cash, the full final price is deducted and the rough stone enters their inventory.

If a human winner does not have enough cash, their bid is skipped and settlement should try the next eligible bidder for that lot. If no eligible bidder can pay, the stone passes. No deposit is forfeited because bid deposits no longer exist.

If AI wins, the stone leaves the public pool as it does today.

## Public Snapshot And Privacy

During a live round, clients receive:

- auction id
- hall label
- live start and end timestamps
- entry fee
- whether the current player has entered
- public lot information
- public window reveals
- the current player's own bids
- latest settlement results, if available

Clients must not receive:

- all bids
- other players' bid amounts
- current highest bid
- bidder count during a live round
- leading or losing status before settlement
- hidden stone value fields

After settlement, public results may include final price, result status, and bid count. Winner id is shown only to the winner.

## Server Components

`public/jade-auction.js` should own shared pure rules:

- auction phase naming for the new live-only lifecycle
- entry fee helpers
- bid increment tier calculation
- direct bid upsert
- AI bid generation
- direct sealed bid settlement
- privacy-safe auction snapshots

`server.js` should own authoritative side effects:

- current round creation every 10 minutes
- player entry fee charging
- window fee charging
- bid submission validation
- settlement payment, inventory transfer, AI removal, and pass handling
- offline settlement events
- broadcasting snapshots

`public/main.js` should own the browser experience:

- live auction status and countdown
- entry button
- window button gated by entry
- direct bid input
- dynamic increment buttons
- submit or update sealed bid button
- latest results display while a new round is live

## Error Handling

Expected rejections should produce toast messages:

- player is not found
- round is no longer live
- entry fee is unaffordable
- player tries to open a window without entering
- player tries to bid without entering
- bid is below base price
- bid payload is invalid
- selected stone is not in the current round

Settlement should tolerate malformed bids by ignoring them, not crashing the round.

## Testing

Update smoke tests to cover:

- no registration phase in the public auction lifecycle
- a round is live immediately after creation
- entering charges the entry fee once and does not charge again
- bidding is blocked before entry
- direct bid upsert replaces the player's previous bid
- no bid deposit is charged
- dynamic increments scale by bid tier
- highest direct bid wins at its bid amount
- same-amount ties go to the earlier bid
- unaffordable winners are skipped in favor of the next eligible bidder
- public snapshots do not leak other bids or live bidder counts
- results can be shown while the next round is already live

## Out Of Scope

This implementation does not rebalance hall tiers, open all hall types, add persistent database storage, add real multiplayer identity controls, or redesign the stone renderer.
