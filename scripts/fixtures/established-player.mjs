import { normalizeBusiness } from "../../shared/domain/progression/business-growth.js";

// Saved-business fixture for tests of trading and production already in progress.
export function makeEstablishedPlayer(hooks, id) {
  const player = hooks.makePlayer(id);
  player.cash = 12_000;
  player.assets.workshopOwned = true;
  player.rough = hooks.makeStarterRoughs(player.id);
  delete player.business;
  normalizeBusiness(player);
  return player;
}
