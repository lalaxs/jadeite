// Feature module wiring (moved from main.js init*Module block)

export function wireFeatureModules(ctx) {
  const {
    initAuctionModule,
    initMarketModule,
    initBlackmarketModule,
    initWorkshopModule,
    initInventoryModule,
    initChatModule,
    initRankingModule,
    initOrdersModule,
    initLivestreamModule,
    initExtraModule,
    initBillModule,
    initMiningModule,
    socket,
    opening,
    getState,
    els,
    getActiveView,
    registerAction,
    helpers,
    leaveLockedBlackmarket,
    openBillView,
    openHomeOverview
  } = ctx;

  initAuctionModule({
    socket, getState, els, getActiveView, registerAction,
    helpers: helpers.auction
  });
  initMarketModule({
    socket, getState, els, getActiveView, registerAction,
    helpers: helpers.market
  });
  initBlackmarketModule({
    socket, getState, els, getActiveView, leaveLockedBlackmarket, registerAction,
    helpers: helpers.blackmarket
  });
  initWorkshopModule({
    socket, getState, els, getActiveView, registerAction, opening,
    helpers: helpers.workshop
  });
  initInventoryModule({
    socket, getState, els, getActiveView, registerAction,
    helpers: helpers.inventory
  });
  initChatModule({
    socket, getState, els, getActiveView, registerAction, openBillView,
    helpers: helpers.chat
  });
  initRankingModule({
    socket, getState, els, getActiveView, registerAction,
    helpers: helpers.ranking
  });
  initOrdersModule({
    socket, getState, els, getActiveView, registerAction,
    helpers: helpers.orders
  });
  initLivestreamModule({
    socket, getState, els, getActiveView,
    helpers: helpers.livestream
  });
  initExtraModule({
    socket, getState, els, getActiveView, registerAction, openBillView,
    helpers: helpers.extra
  });
  initBillModule({
    getState, els, openHomeOverview,
    helpers: helpers.bill
  });
  initMiningModule({
    socket, getState, getActiveView, registerAction,
    helpers: helpers.mining
  });
}
