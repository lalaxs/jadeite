// 黑市 service-ui：技术支持资料 / 订单 / offer

import { lazyPreviewMarkup, observeLazyPreviews } from "../../lazy-preview.js";
import {
  marketQualityMeta,
  deriveMaterialProfile,
  mlVisual
} from "../../market-module.js";
import { WORKER_SKILL_DEFS } from "../../workshop-craft-scoring.js";
import { renderResourceCard } from "../../resource-card-view.js";
import { BM_SERVICE_TEMPLATES, bmServiceTemplateById } from "../../bm-service-templates.js";
import {
  BM_SERVICE_PROFILE_CAPS as BM_PROFILE_CAPS
} from "../../bm-constants.js";
import {
  socketRef,
  getState,
  formatMoney,
  escapeHtml,
  empty,
  showToast,
  openGameModal,
  typeName,
  bmUi,
  bmMyStall,
  bmStallById,
  bmFeatureGate,
  guardBmFeature,
  bmAffordable,
  starsHtml
} from "./shared.js";
import {
  serviceProfileHtml,
  serviceOfferCapabilityHtml,
  serviceOfferBasisHtml,
  closeBmModals
} from "./controller.js";

export let bmServiceTemplateBound = false;

export function openBmServiceOfferModal() {
  const modal = document.getElementById("bmServiceOfferModal");
  if (!modal) return;
  const templateEl = modal.querySelector("#bmSvcTemplate");
  const price = modal.querySelector("#bmSvcPrice");
  if (templateEl && !templateEl.options.length) {
    templateEl.innerHTML = BM_SERVICE_TEMPLATES.map((t) =>
      `<option value="${escapeHtml(t.id)}">${escapeHtml(t.title)}</option>`
    ).join("");
  }
  if (templateEl && !bmServiceTemplateBound) {
    templateEl.addEventListener("change", () => applyBmServiceTemplateFields(modal));
    bmServiceTemplateBound = true;
  }
  if (templateEl) templateEl.value = "open-window";
  applyBmServiceTemplateFields(modal);
  if (price) price.value = "100";
  modal.hidden = false;
}

export function openBmServiceInfoModal(stallId) {
  const stall = bmStallById(stallId);
  const modal = document.getElementById("bmServiceInfoModal");
  if (!stall || stall.type !== "service" || !modal) return;
  const title = modal.querySelector("#bmServiceInfoTitle");
  const sub = modal.querySelector("#bmServiceInfoSub");
  const body = modal.querySelector("#bmServiceInfoBody");
  if (title) title.textContent = stall.displayName || stall.ownerName || "客户评级资料";
  if (sub) {
    sub.textContent = stall.isMine
      ? "自动数据实时更新；展示项来自你的真实能力与橱窗选择。"
      : "摊主能力与橱窗信息";
  }
  if (body) {
    body.innerHTML = serviceProfileHtml(stall, { ownerHint: !!stall.isMine })
      || `<div class="bm-svc-empty">暂无客户评级资料可展示。</div>`;
  }
  modal.hidden = false;
  observeLazyPreviews(body);
}

export function applyBmServiceTemplateFields(modal) {
  const template = bmServiceTemplateById(modal?.querySelector("#bmSvcTemplate")?.value || "open-window");
  const title = modal?.querySelector("#bmSvcTitle");
  const desc = modal?.querySelector("#bmSvcDesc");
  const eta = modal?.querySelector("#bmSvcEta");
  const hint = modal?.querySelector("#bmSvcTemplateHint");
  if (title) title.value = template?.title || "";
  if (desc) desc.value = "";
  if (eta) eta.value = String(template?.defaultEta || 30);
  if (hint) {
    const keys = (template?.skillKeys || [])
      .map((key) => WORKER_SKILL_DEFS[key]?.name || key)
      .filter(Boolean);
    hint.textContent = keys.length
      ? `将自动绑定：${keys.join("、")}${template?.deviceStage ? " + 对应工序设备" : ""}`
      : "";
  }
}

export function confirmBmServiceOffer() {
  const modal = document.getElementById("bmServiceOfferModal");
  const templateId = modal?.querySelector("#bmSvcTemplate")?.value || "open-window";
  const template = bmServiceTemplateById(templateId);
  const mine = bmMyStall();
  if (mine?.type === "service" && (mine.offers || []).some((o) => String(o.templateId || "") === templateId)) {
    showToast({ text: `已有「${template?.title || "该"}」服务，不能重复添加。`, tone: "warn" });
    return;
  }
  socketRef.emit("bmAddServiceOffer", {
    templateId,
    title: modal?.querySelector("#bmSvcTitle")?.value || "",
    desc: modal?.querySelector("#bmSvcDesc")?.value || "",
    price: Number(modal?.querySelector("#bmSvcPrice")?.value) || 0,
    etaMinutes: Number(modal?.querySelector("#bmSvcEta")?.value) || 30
  });
}

export function bmProfileEmptyHtml(message) {
  return `<div class="bm-profile-empty"><p>${escapeHtml(message)}</p></div>`;
}

export function bmProfilePickHtml({ attrs, title, sub = "", checked = false, type }) {
  if (type) return renderResourceCard({
    type, name: title, badge: type === "employee" ? "招牌员工" : "招牌设备",
    tag: "label", className: `bm-profile-pick${checked ? " on" : ""}`,
    controlHtml: `<input type="checkbox" ${attrs} aria-label="${escapeHtml(title)}" ${checked ? "checked" : ""}>`,
    summary: sub ? [sub] : []
  });
  return `
    <label class="bm-profile-pick${checked ? " on" : ""}">
      <input type="checkbox" ${attrs} ${checked ? "checked" : ""}>
      <span class="bm-profile-pick-body">
        <strong>${escapeHtml(title)}</strong>
        ${sub ? `<small>${escapeHtml(sub)}</small>` : ""}
      </span>
    </label>`;
}

export function bmProfileInventoryItem(type, itemId) {
  const me = getState()?.me;
  if (!me) return null;
  const bucket = type === "bracelet" ? me.bracelets
    : type === "slice" ? me.slices
      : type === "material" ? me.materials
        : null;
  return (bucket || []).find((item) => item.id === itemId) || null;
}

export function readBmProfileDraft(modal) {
  return {
    headlineTagIds: [...modal.querySelectorAll("[data-bm-profile-tag]:checked")].map((el) => el.dataset.bmProfileTag),
    acceptScopes: [...modal.querySelectorAll("[data-bm-profile-scope]:checked")].map((el) => el.dataset.bmProfileScope),
    featuredWorkerIds: [...modal.querySelectorAll("[data-bm-profile-worker]:checked")].map((el) => el.dataset.bmProfileWorker),
    featuredEquipmentIds: [...modal.querySelectorAll("[data-bm-profile-device]:checked")].map((el) => el.dataset.bmProfileDevice),
    showcaseItems: [...modal.querySelectorAll("[data-bm-profile-showcase-id]:checked")].map((el) => ({
      type: el.dataset.bmProfileShowcaseType,
      itemId: el.dataset.bmProfileShowcaseId
    })),
    visibility: {
      showWorkers: modal.querySelector("#bmProfileShowWorkers")?.checked !== false,
      showEquipment: modal.querySelector("#bmProfileShowEquipment")?.checked !== false,
      showShowcase: modal.querySelector("#bmProfileShowShowcase")?.checked !== false
    }
  };
}

export function buildBmProfilePreviewStall(mine, draft) {
  const options = mine.serviceProfileOptions || {};
  const baseSnap = mine.serviceSnapshot || {};
  const tagsById = new Map((options.eligibleHeadlineTags || []).map((tag) => [tag.id, tag]));
  const scopesById = new Map((options.acceptScopes || []).map((scope) => [scope.id, scope]));
  const workersById = new Map((options.workers || []).map((worker) => [worker.id, worker]));
  const devicesById = new Map((options.devices || []).map((device) => [device.id, device]));

  const featuredWorkers = draft.visibility.showWorkers
    ? draft.featuredWorkerIds.map((id) => {
      const worker = workersById.get(id);
      if (!worker) return null;
      const match = String(worker.topSkill || "").match(/^(.*)\sL(\d+)$/);
      return {
        label: worker.name,
        topSkills: match
          ? [{ name: match[1], level: Number(match[2]) }]
          : (worker.topSkill ? [{ name: worker.topSkill, level: 1 }] : [])
      };
    }).filter(Boolean)
    : [];

  let topDevices = baseSnap.topDevices || [];
  if (draft.visibility.showEquipment && draft.featuredEquipmentIds.length) {
    topDevices = draft.featuredEquipmentIds.map((id) => {
      const device = devicesById.get(id);
      if (!device) return null;
      const parts = String(device.label || "").split("·").map((part) => part.trim());
      return {
        stageLabel: parts[0] || "设备",
        brand: parts[1] || device.label || "",
        modelName: parts.slice(2).join(" · ") || "",
        focus: ""
      };
    }).filter(Boolean);
  }

  const showcaseItems = draft.visibility.showShowcase
    ? draft.showcaseItems.map((row) => {
      const item = bmProfileInventoryItem(row.type, row.itemId);
      const fallback = (options.showcaseCandidates || []).find((c) => c.type === row.type && c.itemId === row.itemId);
      return {
        type: row.type,
        itemId: row.itemId,
        name: item?.name || fallback?.name || row.itemId,
        item: item || { name: fallback?.name || row.itemId, type: row.type }
      };
    })
    : [];

  return {
    ...mine,
    serviceSnapshot: {
      ...baseSnap,
      headlineTags: draft.headlineTagIds.map((id) => tagsById.get(id)).filter(Boolean),
      acceptScopes: draft.acceptScopes.map((id) => scopesById.get(id)).filter(Boolean),
      featuredWorkers,
      topDevices,
      showcaseItems
    }
  };
}

export function updateBmProfileChrome(modal, draft = null) {
  const next = draft || readBmProfileDraft(modal);
  const counts = {
    tags: next.headlineTagIds.length,
    scopes: next.acceptScopes.length,
    workers: next.featuredWorkerIds.length,
    devices: next.featuredEquipmentIds.length,
    showcase: next.showcaseItems.length
  };
  const setCount = (key, text) => {
    modal.querySelectorAll(`[data-bm-tab-count="${key}"]`).forEach((el) => {
      el.textContent = text;
    });
  };
  setCount("tags", `${counts.tags}/${BM_PROFILE_CAPS.tags}`);
  setCount("scopes", String(counts.scopes));
  setCount("workers", `${counts.workers}/${BM_PROFILE_CAPS.workers}`);
  setCount("devices", `${counts.devices}/${BM_PROFILE_CAPS.devices}`);
  setCount("showcase", `${counts.showcase}/${BM_PROFILE_CAPS.showcase}`);

  const foot = modal.querySelector("#bmProfileFootStats");
  if (foot) {
    foot.textContent = `已选 ${counts.tags}/${BM_PROFILE_CAPS.tags} 标签 · ${counts.workers}/${BM_PROFILE_CAPS.workers} 员工 · ${counts.devices}/${BM_PROFILE_CAPS.devices} 设备 · ${counts.showcase}/${BM_PROFILE_CAPS.showcase} 案例`;
  }

  const mine = bmMyStall();
  const preview = modal.querySelector("#bmProfilePreview");
  if (preview && mine) {
    const html = serviceProfileHtml(buildBmProfilePreviewStall(mine, next), { ownerHint: false });
    preview.innerHTML = html || `<div class="bm-profile-empty"><p>完善橱窗后，买家会在这里看到你的服务能力。</p></div>`;
    observeLazyPreviews(preview);
  }
}

export function enforceBmProfileCap(input) {
  if (!input?.checked) return true;
  const modal = input.closest("#bmServiceProfileModal");
  if (!modal) return true;
  let selector = "";
  let cap = 0;
  let label = "";
  if (input.hasAttribute("data-bm-profile-tag")) {
    selector = "[data-bm-profile-tag]:checked";
    cap = BM_PROFILE_CAPS.tags;
    label = "主打标签最多 3 个";
  } else if (input.hasAttribute("data-bm-profile-worker")) {
    selector = "[data-bm-profile-worker]:checked";
    cap = BM_PROFILE_CAPS.workers;
    label = "台柱子最多 3 名";
  } else if (input.hasAttribute("data-bm-profile-device")) {
    selector = "[data-bm-profile-device]:checked";
    cap = BM_PROFILE_CAPS.devices;
    label = "招牌设备最多 4 台";
  } else if (input.hasAttribute("data-bm-profile-showcase-id")) {
    selector = "[data-bm-profile-showcase-id]:checked";
    cap = BM_PROFILE_CAPS.showcase;
    label = "案例展示最多 3 件";
  } else {
    return true;
  }
  if (modal.querySelectorAll(selector).length <= cap) return true;
  input.checked = false;
  input.closest(".bm-profile-pick")?.classList.remove("on");
  showToast({ text: label, tone: "warn" });
  return false;
}

export function syncBmProfilePickState(modal) {
  modal.querySelectorAll(".bm-profile-pick").forEach((pick) => {
    const checked = pick.querySelector("input")?.checked;
    pick.classList.toggle("on", Boolean(checked));
  });
}

export function setBmProfileTab(tabId = "tags") {
  const modal = document.getElementById("bmServiceProfileModal");
  if (!modal) return;
  const next = String(tabId || "tags");
  modal.querySelectorAll("[data-bm-profile-tab]").forEach((btn) => {
    const on = btn.dataset.bmProfileTab === next;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
    btn.setAttribute("tabindex", on ? "0" : "-1");
  });
  modal.querySelectorAll("[data-bm-profile-pane]").forEach((pane) => {
    const on = pane.dataset.bmProfilePane === next;
    pane.classList.toggle("on", on);
    pane.hidden = !on;
  });
}

export function renderBmServiceProfileModal(mine) {
  const modal = document.getElementById("bmServiceProfileModal");
  if (!modal || !mine) return;
  const profile = mine.serviceProfile || {};
  const options = mine.serviceProfileOptions || {};
  const tagSet = new Set(profile.headlineTagIds || []);
  const scopeSet = new Set(profile.acceptScopes || []);
  const workerSet = new Set(profile.featuredWorkerIds || []);
  const deviceSet = new Set(profile.featuredEquipmentIds || []);
  const showcaseSet = new Set((profile.showcaseItems || []).map((row) => `${row.type}:${row.itemId}`));
  const visibility = profile.visibility || {};

  const tagGrid = modal.querySelector("#bmProfileTagGrid");
  const scopeGrid = modal.querySelector("#bmProfileScopeGrid");
  const workerGrid = modal.querySelector("#bmProfileWorkerGrid");
  const deviceGrid = modal.querySelector("#bmProfileDeviceGrid");
  const showcaseGrid = modal.querySelector("#bmProfileShowcaseGrid");

  const eligibleTags = options.eligibleHeadlineTags || [];
  if (tagGrid) {
    tagGrid.innerHTML = eligibleTags.length
      ? eligibleTags.map((tag) => bmProfilePickHtml({
        attrs: `data-bm-profile-tag="${escapeHtml(tag.id)}"`,
        title: tag.label,
        sub: "技能达标已解锁",
        checked: tagSet.has(tag.id)
      })).join("")
      : bmProfileEmptyHtml("暂无达标主打标签，去工坊提升员工技能后会自动解锁。");
  }
  if (scopeGrid) {
    const scopes = options.acceptScopes || [];
    scopeGrid.innerHTML = scopes.length
      ? scopes.map((scope) => bmProfilePickHtml({
        attrs: `data-bm-profile-scope="${escapeHtml(scope.id)}"`,
        title: scope.label,
        checked: scopeSet.has(scope.id)
      })).join("")
      : bmProfileEmptyHtml("暂无接单范围可选。");
  }
  if (workerGrid) {
    const workers = options.workers || [];
    workerGrid.innerHTML = workers.length
      ? workers.map((worker) => bmProfilePickHtml({
        type: "employee",
        attrs: `data-bm-profile-worker="${escapeHtml(worker.id)}"`,
        title: worker.name,
        sub: worker.topSkill || "加工员工",
        checked: workerSet.has(worker.id)
      })).join("")
      : bmProfileEmptyHtml("暂无可展示的加工员工，先去招募或安排工坊岗位。");
  }
  if (deviceGrid) {
    const devices = options.devices || [];
    deviceGrid.innerHTML = devices.length
      ? devices.map((device) => bmProfilePickHtml({
        type: "equipment",
        attrs: `data-bm-profile-device="${escapeHtml(device.id)}"`,
        title: device.label,
        checked: deviceSet.has(device.id)
      })).join("")
      : bmProfileEmptyHtml("尚未购置可展示设备，去商城添置后再挂到橱窗。");
  }
  if (showcaseGrid) {
    const rows = options.showcaseCandidates || [];
    showcaseGrid.innerHTML = rows.length
      ? rows.map((row) => {
        const key = `${row.type}:${row.itemId}`;
        const item = bmProfileInventoryItem(row.type, row.itemId) || { name: row.name, type: row.type };
        return `
          <label class="bm-profile-pick bm-profile-pick-showcase${showcaseSet.has(key) ? " on" : ""}">
            <input type="checkbox" data-bm-profile-showcase-type="${escapeHtml(row.type)}" data-bm-profile-showcase-id="${escapeHtml(row.itemId)}" ${showcaseSet.has(key) ? "checked" : ""}>
            <span class="bm-profile-pick-visual">${lazyPreviewMarkup(mlVisual(item), { eager: false })}</span>
            <span class="bm-profile-pick-body">
              <strong>${escapeHtml(row.name)}</strong>
              <small>${escapeHtml(typeName?.(row.type) || row.type)}</small>
            </span>
          </label>`;
      }).join("")
      : bmProfileEmptyHtml("库存中暂无完工案例（成品镯子或 finished 物料）。");
    observeLazyPreviews(showcaseGrid);
  }

  const showWorkers = modal.querySelector("#bmProfileShowWorkers");
  const showEquipment = modal.querySelector("#bmProfileShowEquipment");
  const showShowcase = modal.querySelector("#bmProfileShowShowcase");
  if (showWorkers) showWorkers.checked = visibility.showWorkers !== false;
  if (showEquipment) showEquipment.checked = visibility.showEquipment !== false;
  if (showShowcase) showShowcase.checked = visibility.showShowcase !== false;

  setBmProfileTab("tags");
  updateBmProfileChrome(modal);
}

export function openBmServiceProfileModal() {
  const mine = bmMyStall();
  if (!mine || mine.type !== "service") return;
  const modal = document.getElementById("bmServiceProfileModal");
  if (!modal) return;
  renderBmServiceProfileModal(mine);
  modal.hidden = false;
}

export function confirmBmServiceProfile() {
  const modal = document.getElementById("bmServiceProfileModal");
  if (!modal) return;
  const draft = readBmProfileDraft(modal);
  socketRef.emit("bmUpdateServiceProfile", draft);
  modal.hidden = true;
}

export function bindBmServiceProfileModal() {
  const modal = document.getElementById("bmServiceProfileModal");
  if (!modal || modal.dataset.bmProfileBound === "1") return;
  modal.dataset.bmProfileBound = "1";
  modal.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "checkbox") return;
    if (!input.closest(".bm-profile-pick, .bm-profile-visibility")) return;
    if (!enforceBmProfileCap(input)) {
      updateBmProfileChrome(modal);
      return;
    }
    syncBmProfilePickState(modal);
    updateBmProfileChrome(modal);
  });
}

export function clientItemStage(item) {
  if (!item) return "unknown";
  if (item.materialStage) return item.materialStage;
  if (item.type === "rough") return item.revealed ? "opened" : "rough";
  if (item.type === "bracelet") return "finished";
  return item.stage || "unknown";
}

export function bmItemMatchesScope(item, scopeId) {
  const stage = clientItemStage(item);
  const score = Number(item.score || 0);
  switch (scopeId) {
    case "sealed": return item.type === "rough" && stage === "rough";
    case "opened": return stage === "opened" || stage === "carved";
    case "finished": return stage === "finished";
    case "premium": return score >= 5 || String(item.color || "").includes("帝王");
    default: return false;
  }
}

export function bmStallAcceptScopeIds(stall) {
  const fromProfile = stall?.serviceProfile?.acceptScopes;
  if (Array.isArray(fromProfile) && fromProfile.length) return fromProfile.map(String);
  const snap = stall?.serviceSnapshot?.acceptScopes || [];
  return snap.map((row) => (typeof row === "string" ? row : row.id)).filter(Boolean);
}

export function bmOrderEligibleItems(stall) {
  const me = getState()?.me;
  if (!me || !stall) return [];
  const scopes = bmStallAcceptScopeIds(stall);
  const rows = [];
  const push = (type, bucket) => {
    for (const item of bucket || []) {
      if (!item?.id) continue;
      if (scopes.length && !scopes.some((scopeId) => bmItemMatchesScope(item, scopeId))) continue;
      rows.push({ type, item });
    }
  };
  push("rough", me.rough);
  push("material", me.materials);
  push("slice", me.slices);
  push("bracelet", me.bracelets);
  return rows;
}

export function bmOrderStageLabel(item, type) {
  const stage = clientItemStage(item);
  if (stage === "rough") return "暗料";
  if (stage === "opened") return "明料";
  if (stage === "carved") return "造型中";
  if (stage === "finished") return "成品";
  return typeName?.(type) || type || "物料";
}

export function bmOrderItemHint(item) {
  try {
    const profile = deriveMaterialProfile(item);
    if (profile?.sealed) {
      return String(item.publicHint || item.hint || "暗料 · 种水未揭露").trim().slice(0, 36);
    }
    const q = marketQualityMeta(item);
    const parts = [];
    if (item.quality || q?.name) parts.push(`${item.quality || q.name}${q?.stars ? ` ${q.stars}` : ""}`);
    if (item.color) parts.push(item.color);
    return parts.join(" · ").slice(0, 36);
  } catch {
    return "";
  }
}

export function bmOrderFilterTypes(eligible) {
  const order = ["rough", "material", "slice", "bracelet"];
  const present = new Set(eligible.map((row) => row.type));
  return order.filter((type) => present.has(type));
}

export function bmOrderFilteredItems(eligible, filter = bmUi.orderFilter) {
  if (!filter || filter === "all") return eligible;
  return eligible.filter((row) => row.type === filter);
}

export function bmOrderItemCardHtml(row, { checked = false } = {}) {
  const { type, item } = row;
  const hint = bmOrderItemHint(item);
  return `
    <label class="bm-order-pick${checked ? " on" : ""}">
      <input type="radio" name="bmOrderItem" value="${escapeHtml(item.id)}" data-item-type="${escapeHtml(type)}" ${checked ? "checked" : ""}>
      <span class="bm-order-pick-visual">${lazyPreviewMarkup(mlVisual(item), { eager: false })}</span>
      <span class="bm-order-pick-body">
        <strong>${escapeHtml(item.name || "物料")}</strong>
        <small>${escapeHtml(typeName?.(type) || type)} · ${escapeHtml(bmOrderStageLabel(item, type))}</small>
        ${hint ? `<em>${escapeHtml(hint)}</em>` : ""}
      </span>
    </label>`;
}

export function updateBmOrderChrome(modal) {
  if (!modal) return;
  const stall = bmStallById(bmUi.orderStallId);
  const offer = (stall?.offers || []).find((row) => row.id === bmUi.orderOfferId);
  const picked = modal.querySelector('input[name="bmOrderItem"]:checked');
  const eligible = stall ? bmOrderEligibleItems(stall) : [];
  const filtered = bmOrderFilteredItems(eligible, bmUi.orderFilter);
  const price = Number(offer?.price || 0);
  const cash = Number(getState()?.me?.cash || 0);
  const can = cash >= price;
  const short = Math.max(0, price - cash);

  modal.querySelectorAll(".bm-order-pick").forEach((pick) => {
    pick.classList.toggle("on", Boolean(pick.querySelector("input")?.checked));
  });

  const foot = modal.querySelector("#bmOrderFootStats");
  if (foot) {
    if (!eligible.length) {
      foot.textContent = "暂无符合接单范围的库存";
    } else if (!picked) {
      foot.textContent = "请先选择一件物料";
    } else {
      const itemName = picked.closest(".bm-order-pick")?.querySelector("strong")?.textContent || "物料";
      const typeLabelText = typeName?.(picked.dataset.itemType) || picked.dataset.itemType || "";
      foot.textContent = `已选：${itemName}${typeLabelText ? ` · ${typeLabelText}` : ""}`;
    }
  }

  const cashEl = modal.querySelector("#bmOrderCashHint");
  if (cashEl) {
    cashEl.textContent = can ? "现金足够" : `现金不足 · 还差 ${formatMoney(short)}`;
    cashEl.classList.toggle("is-warn", !can);
  }

  const countEl = modal.querySelector("#bmOrderPickCount");
  if (countEl) {
    countEl.textContent = filtered.length ? `可选 ${filtered.length}` : "无可选";
  }

  const confirmBtn = modal.querySelector("[data-action='confirmBmOrderService']");
  if (confirmBtn) {
    const ready = Boolean(picked) && can && eligible.length > 0;
    confirmBtn.disabled = !ready;
    confirmBtn.textContent = !eligible.length ? "无可用物料" : (!can ? "现金不足" : "确认下单");
  }
}

export function renderBmOrderItemGrid(modal, eligible) {
  const grid = modal.querySelector("#bmOrderItemGrid");
  if (!grid) return;
  const filtered = bmOrderFilteredItems(eligible, bmUi.orderFilter);
  const selectedId = modal.querySelector('input[name="bmOrderItem"]:checked')?.value
    || (filtered.length === 1 ? filtered[0].item.id : bmUi.orderItemId);
  grid.innerHTML = filtered.length
    ? filtered.map((row) => bmOrderItemCardHtml(row, {
      checked: selectedId && row.item.id === selectedId
    })).join("")
    : `<div class="bm-order-empty modal-empty-state">
        <strong>${eligible.length ? "筛选下没有匹配物料" : "没有可委托的物料"}</strong>
        <p>${eligible.length
          ? "切换品类筛选，查看其他可委托物料。"
          : "先去公盘或交易行备料，也可以换一家接单范围更合适的服务摊。"}</p>
      </div>`;
  observeLazyPreviews(grid);
}

export function openBmOrderServiceModal(stallId, offerId) {
  const stall = bmStallById(stallId);
  const offer = (stall?.offers || []).find((row) => row.id === offerId);
  if (!stall || !offer || stall.isMine) return;
  const modal = document.getElementById("bmOrderServiceModal");
  const body = document.getElementById("bmOrderServiceBody");
  if (!modal || !body) return;
  bmUi.orderStallId = stallId;
  bmUi.orderOfferId = offerId;
  bmUi.orderItemId = null;
  bmUi.orderItemType = null;
  bmUi.orderNote = "";
  bmUi.orderFilter = "all";

  const eligible = bmOrderEligibleItems(stall);
  const filterTypes = bmOrderFilterTypes(eligible);
  const titleEl = modal.querySelector("#bmOrderServiceTitle");
  const subEl = modal.querySelector("#bmOrderServiceSub");
  if (titleEl) titleEl.textContent = `下单托管 · ${offer.title || "服务"}`;
  if (subEl) subEl.textContent = offer.desc || "选择库存物料并冻结加工费，完成后确认收货。";

  const autoId = eligible.length === 1 ? eligible[0].item.id : null;
  if (autoId) {
    bmUi.orderItemId = autoId;
    bmUi.orderItemType = eligible[0].type;
  }

  body.innerHTML = `
    <div class="bm-order-layout">
      <div class="bm-order-editor">
        <div class="bm-order-pane-head">
          <div>
            <h4>选择待加工物品</h4>
            <span>下单后物品进入托管，完成前不可另作他用</span>
          </div>
          <b id="bmOrderPickCount">可选 ${eligible.length}</b>
        </div>
        ${filterTypes.length > 1 ? `
          <div class="bm-order-filters" role="group" aria-label="品类筛选">
            <button type="button" class="on" data-action="bmOrderFilter" data-bm-order-filter="all" aria-pressed="true">全部</button>
            ${filterTypes.map((type) => `
              <button type="button" data-action="bmOrderFilter" data-bm-order-filter="${escapeHtml(type)}" aria-pressed="false">${escapeHtml(typeName?.(type) || type)}</button>
            `).join("")}
          </div>` : ""}
        <div class="bm-order-item-grid" id="bmOrderItemGrid"></div>
      </div>
      <aside class="bm-order-summary-col">
        <div class="bm-order-summary-head">
          <h4>${escapeHtml(offer.title || "服务")}</h4>
          <p>${escapeHtml(offer.desc || "暂无说明")}</p>
          <div class="bm-order-summary-meta">
            <span>摊主 ${escapeHtml(stall.displayName || "匿名摊主")}</span>
            <span>${bmRatingPublicHtml(stall)}</span>
            <span>约 ${offer.etaMinutes || 0} 分钟</span>
          </div>
        </div>
        <div class="bm-order-fee-card">
          <div class="bm-order-fee-row">
            <span>加工费<span class="bm-order-fee-tag">冻结</span></span>
            <b>${formatMoney(offer.price)}</b>
          </div>
          <div class="bm-order-fee-row">
            <span>预计完成</span>
            <b>约 ${offer.etaMinutes || 0} 分钟</b>
          </div>
          <p class="bm-order-fee-note">下单后物品与加工费一并冻结；完工确认后费用结算给摊主，取消则退回。</p>
          <div class="bm-order-cash-hint" id="bmOrderCashHint"></div>
        </div>
        ${serviceOfferCapabilityHtml(offer)}
        ${serviceOfferBasisHtml(offer)}
        <div class="bm-order-note-field">
          <label for="bmOrderServiceNote">备注（可选）</label>
          <textarea id="bmOrderServiceNote" maxlength="120" rows="4" placeholder="说明加工要求，例如圈口、开窗位置…"></textarea>
        </div>
      </aside>
    </div>`;

  renderBmOrderItemGrid(modal, eligible);
  updateBmOrderChrome(modal);
  modal.hidden = false;
}

export function setBmOrderFilter(filterId = "all") {
  const modal = document.getElementById("bmOrderServiceModal");
  if (!modal) return;
  bmUi.orderFilter = String(filterId || "all");
  modal.querySelectorAll("[data-bm-order-filter]").forEach((btn) => {
    const on = btn.dataset.bmOrderFilter === bmUi.orderFilter;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const stall = bmStallById(bmUi.orderStallId);
  const eligible = stall ? bmOrderEligibleItems(stall) : [];
  const prev = modal.querySelector('input[name="bmOrderItem"]:checked');
  if (prev) {
    bmUi.orderItemId = prev.value;
    bmUi.orderItemType = prev.dataset.itemType;
  }
  renderBmOrderItemGrid(modal, eligible);
  // keep selection if still visible
  if (bmUi.orderItemId) {
    const next = [...modal.querySelectorAll('input[name="bmOrderItem"]')]
      .find((el) => el.value === bmUi.orderItemId);
    if (next) {
      next.checked = true;
    } else {
      bmUi.orderItemId = null;
      bmUi.orderItemType = null;
    }
  }
  updateBmOrderChrome(modal);
}

export function bindBmOrderServiceModal() {
  const modal = document.getElementById("bmOrderServiceModal");
  if (!modal || modal.dataset.bmOrderBound === "1") return;
  modal.dataset.bmOrderBound = "1";
  modal.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.name !== "bmOrderItem") return;
    bmUi.orderItemId = input.value;
    bmUi.orderItemType = input.dataset.itemType;
    updateBmOrderChrome(modal);
  });
}

export function confirmBmOrderService() {
  if (!guardBmFeature("bmBuy")) return;
  const modal = document.getElementById("bmOrderServiceModal");
  const picked = modal?.querySelector('input[name="bmOrderItem"]:checked');
  if (!picked) {
    showToast({ text: "请选择要加工的物品。", tone: "warn" });
    return;
  }
  bmUi.orderItemId = picked.value;
  bmUi.orderItemType = picked.dataset.itemType;
  bmUi.orderNote = modal?.querySelector("#bmOrderServiceNote")?.value?.trim() || "";
  socketRef.emit("bmOrderService", {
    stallId: bmUi.orderStallId,
    offerId: bmUi.orderOfferId,
    itemType: bmUi.orderItemType,
    itemId: bmUi.orderItemId,
    note: bmUi.orderNote
  });
  closeBmModals();
}

export function promptBmEarlySubmit(orderId, { message, penalty } = {}) {
  const id = String(orderId || "");
  if (!id) {
    showToast({ text: "订单无效。", tone: "warn" });
    return;
  }
  const text = message || "该订单尚未完成加工。";
  showToast({ text, tone: "warn" });
  const fee = formatMoney(Number(penalty || 0));
  if (typeof openGameModal !== "function") return;
  openGameModal({
    title: "订单尚未完成",
    tone: "warn",
    body: [
      text,
      `提前提交将退还加工费 ${fee} 给买家，您本单收入为 ¥0。`
    ],
    actions: [
      { label: "仍要提交", variant: "warn", socketAction: "bmSubmitService", payload: id, forceEarly: true },
      { label: "再等等", variant: "secondary" }
    ]
  });
}
