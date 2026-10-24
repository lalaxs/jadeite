const INVENTORY_LOCATIONS = ["rough", "materials", "slices", "bracelets", "collection"];
const jsonEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function playerRow(playerId, player) {
  return {
    player_id: String(playerId), display_name: String(player.name || "掌柜").slice(0, 64),
    cash: Math.max(0, Math.round(Number(player.cash) || 0)), reputation: Number(player.rep) || 0,
    level: Math.max(1, Math.round(Number(player.level) || 1))
  };
}

function inventoryRows(playerId, player) {
  const rows = new Map();
  for (const location of INVENTORY_LOCATIONS) {
    for (const item of player[location] || []) {
      if (!item?.id) continue;
      rows.set(String(item.id), {
        item_id: String(item.id), owner_player_id: String(playerId), location,
        item_type: String(item.type || "unknown"), payload: item
      });
    }
  }
  return rows;
}

function requestIds(player) {
  return new Set((player.processedRequestIds || []).map((entry) =>
    typeof entry === "object" ? entry?.requestId : entry
  ).filter(Boolean).map((id) => String(id).slice(0, 128)));
}

// Compare only participating roots. All removals are applied before upserts so that
// transfers remain correct regardless of the order of the two players in the delta.
export function createProjectionDelta(beforeSnapshot, delta) {
  const beforePlayers = new Map(beforeSnapshot?.players || []);
  const changes = { players: [], inventory: [], removedInventory: [], requests: [], removedRequests: [], ledger: [] };
  for (const [playerId, player] of delta.players?.upsert || []) {
    const before = beforePlayers.get(playerId) || {};
    const row = playerRow(playerId, player);
    if (!beforePlayers.has(playerId) || !jsonEqual(playerRow(playerId, before), row)) changes.players.push(row);
    const previousInventory = inventoryRows(playerId, before);
    const nextInventory = inventoryRows(playerId, player);
    for (const [id, previous] of previousInventory) {
      if (!nextInventory.has(id)) changes.removedInventory.push({ item_id: id, owner_player_id: String(playerId) });
      else if (!jsonEqual(previous, nextInventory.get(id))) changes.inventory.push(nextInventory.get(id));
    }
    for (const [id, next] of nextInventory) {
      if (!previousInventory.has(id)) changes.inventory.push(next);
    }
    const previousRequests = requestIds(before);
    const nextRequests = requestIds(player);
    for (const id of previousRequests) {
      if (!nextRequests.has(id)) changes.removedRequests.push({ player_id: String(playerId), request_id: id });
    }
    for (const id of nextRequests) {
      if (!previousRequests.has(id)) changes.requests.push({ player_id: String(playerId), request_id: id });
    }
    const previousEntries = new Set((before.ledger || []).map((entry) => String(entry?.id || "")));
    for (const entry of player.ledger || []) {
      if (!entry?.id || previousEntries.has(String(entry.id))) continue;
      changes.ledger.push({
        player_id: String(playerId), entry_id: String(entry.id), kind: String(entry.kind || "unknown"),
        source: String(entry.source || entry.kind || "unknown"), amount: Math.round(Number(entry.amount) || 0),
        balance_before: entry.before == null ? null : Math.round(Number(entry.before) || 0),
        balance_after: entry.after == null ? null : Math.round(Number(entry.after) || 0),
        note: String(entry.note || "").slice(0, 500), occurred_at: Math.round(Number(entry.at) || delta.savedAt), payload: entry
      });
    }
  }
  return changes;
}
