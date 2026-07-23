// livestream-module.js — 从 main.js 解耦（依赖注入模式）
// state→getState()、els→elsRef、socket→socketRef，共享 helper 经 deps.helpers 注入。
// 后端 server.js 不受影响。

let socketRef, getState, elsRef, getActiveView;

let finishedProducts, productCanvas, formatMoney, escapeHtml, empty;

export function initLivestreamModule(deps) {
  socketRef = deps.socket;
  getState = deps.getState;
  elsRef = deps.els;
  getActiveView = deps.getActiveView;
  ({ finishedProducts, productCanvas, formatMoney, escapeHtml, empty } = deps.helpers);
}

// ---- 以下函数原定义于 main.js ----

export function renderLivestream() {
  const products = finishedProducts();
  const jobs = getState().me.livestreamJobs || [];
  const livestreamHistory = getState().me.livestreamHistory || [];
  const workers = getState().me.workshop?.workers || [];
  const availableWorkers = workers.filter((worker) => !worker.busy);
  const defaultWorker = availableWorkers.find((worker) => worker.job === "streamer") || availableWorkers[0] || null;
  const workerName = (workerId) => workers.find((worker) => worker.id === workerId)?.name || "未指定";
  const workerOptions = availableWorkers.map((worker) =>
    `<option value="${escapeHtml(worker.id)}" ${worker.id === defaultWorker?.id ? "selected" : ""}>${escapeHtml(worker.name)} · ${worker.tier}阶</option>`
  ).join("");
  const modeName = {
    manual: "手动",
    autoConservative: "保守",
    autoBalanced: "均衡",
    autoAggressive: "激进"
  };
  const cards = [
    ...jobs.map((job) => {
      const remain = Math.max(0, Math.ceil((job.readyAt - Date.now()) / 1000));
      return `
        <article class="rough-card livestream-job-card">
          ${productCanvas(job.product)}
          <h3>直播中</h3>
          <p>${escapeHtml(job.product.name)} · ${escapeHtml(modeName[job.mode] || job.mode)}</p>
          <p class="card-meta">${escapeHtml(workerName(job.workerId))} · 预计 ${remain} 秒后自动结算，可离线完成</p>
        </article>
      `;
    }),
    ...products.map((item) => `
        <article class="rough-card livestream-product-card">
          ${productCanvas(item)}
          <h3>${escapeHtml(item.name)}</h3>
          <p class="card-meta">估值 ${formatMoney(item.value)} · 自动直播可离线完成</p>
          <label class="livestream-worker-field">直播员工
            <select class="livestream-worker-select" ${availableWorkers.length ? "" : "disabled"}>
              ${workerOptions || '<option>暂无空闲员工</option>'}
            </select>
          </label>
          <div class="card-actions">
            <button data-action="scheduleLivestream" data-payload="${item.id}" data-mode="autoConservative" ${availableWorkers.length ? "" : "disabled"}>保守</button>
            <button data-action="scheduleLivestream" data-payload="${item.id}" data-mode="autoBalanced" ${availableWorkers.length ? "" : "disabled"}>均衡</button>
            <button data-action="scheduleLivestream" data-payload="${item.id}" data-mode="autoAggressive" ${availableWorkers.length ? "" : "disabled"}>激进</button>
          </div>
        </article>
      `)
  ];
  if (livestreamHistory.length) {
    cards.push(`
      <article class="rough-card livestream-history-card">
        <h3>最近直播</h3>
        <div class="fit-list">
          ${livestreamHistory.slice(0, 6).map((entry) => {
            const sold = Boolean(entry.outcome?.sold);
            const status = sold ? `成交 ${formatMoney(entry.outcome.price)}` : "未成交退回";
            return `
              <div>
                <strong>${escapeHtml(entry.product?.name || "成品")}</strong>
                <span>${escapeHtml(modeName[entry.mode] || entry.mode || "自动")} · ${status}</span>
              </div>
            `;
          }).join("")}
        </div>
      </article>
    `);
  }
  elsRef.livestream.innerHTML = cards.join("") || empty("暂无可直播成品。");
}

// ---- dispatch 动作封装（原 main.js 内联分支迁入）----
export function livestreamSchedule(target, payload) {
  const workerId = target.closest(".livestream-product-card")?.querySelector(".livestream-worker-select")?.value;
  socketRef.emit("scheduleLivestream", {
    productId: payload,
    mode: target.dataset.mode,
    workerId,
    requestId: globalThis.crypto?.randomUUID?.() || `livestream-${Date.now()}`
  });
}
