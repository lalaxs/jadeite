// extra-module.js — 兼容 barrel：商铺 / 员工 / 账房 / 藏品
export {
  initShopModule,
  renderShop
} from "../../shop-module.js";
export {
  initHireModule,
  renderHireMarket,
  setHireMarketTab,
  openOwnedWorkerDetail,
  closeOwnedWorkerDetail,
  openRecruitCandidateDetail,
  closeRecruitCandidateDetail,
  confirmRecruitCandidate,
  renderOwnedWorkers,
  renderRecruitCandidates
} from "../../hire-module.js";
export {
  initReportsModule,
  renderReports,
  renderOfflineSummary
} from "../../reports-module.js";
export {
  initCollectionModule,
  renderCollection
} from "../../collection-module.js";

import { initShopModule } from "../../shop-module.js";
import { initHireModule } from "../../hire-module.js";
import { initReportsModule } from "../../reports-module.js";
import { initCollectionModule } from "../../collection-module.js";

export function initExtraModule(deps) {
  initShopModule(deps);
  initHireModule(deps);
  initReportsModule(deps);
  initCollectionModule(deps);
}
