import assert from "node:assert/strict";
import { readClientShellSource } from "./load-client-shell.mjs";
import { readFileSync } from "node:fs";
import { loadResolvedStyles } from "./load-styles.mjs";

const index = readFileSync("public/index.html", "utf8");
const mainEntry = readFileSync("public/main.js", "utf8");
const main = readClientShellSource();
const hire = readFileSync("public/features/hire/hire-module.js", "utf8");
const styles = loadResolvedStyles();

assert.match(index, /data-view="hireMarket"/);
assert.match(index, /hire-market-tabs/);
assert.match(index, /data-payload="roster"/);
assert.match(index, /data-payload="recruit"/);
assert.match(index, /id="hireTabRoster"/);
assert.match(index, /id="hireTabRecruit"/);
assert.match(index, /role="tabpanel"/);
assert.match(index, /id="ownedWorkerList"/);
assert.match(index, /id="recruitCandidateList"/);
assert.match(index, /刷新候选人 ¥350/);
assert.match(index, /<h3>员工<\/h3>/);

// 招募面板内部结构保持原样，仅被包进 tab-panel
assert.match(
  index,
  /data-tab-panel="recruit"[\s\S]*class="panel-head"[\s\S]*refreshRecruitCandidates[\s\S]*recruitCandidateList/
);

assert.match(main, /label:\s*"员工"/);
assert.match(main, /setHireMarketTab\("roster"\)/);
assert.match(hire, /register\("hireMarketTab"/);
assert.match(hire, /register\("openOwnedWorkerDetail"/);
assert.match(hire, /register\("promptDismissOwnedWorker"/);
assert.match(hire, /register\("confirmDismissOwnedWorker"/);
assert.match(hire, /dismissWorker/);
assert.doesNotMatch(hire, /初始员工不可解雇/);
assert.match(hire, /员工忙碌中，无法解雇/);
assert.match(hire, /确认解雇/);
assert.match(hire, /ownedWorkerDismissPrompted/);
assert.match(hire, /owned-dismiss-inline/);
assert.doesNotMatch(hire, /owned-worker-dismiss-root/);
assert.doesNotMatch(hire, /owned-worker-dismiss-modal/);
assert.match(main, /renderHireMarket/);

assert.match(hire, /export function renderOwnedWorkers/);
assert.match(hire, /export function setHireMarketTab/);
assert.match(hire, /activeHireMarketTab = "roster"/);
assert.match(hire, /function bindHireMarketTabKeyboard\b/);
assert.match(hire, /event\.key === "ArrowRight"/);
assert.match(hire, /panel\.hidden = !on/);
assert.match(hire, /去招募/);
assert.match(hire, /mode:\s*"roster"/);
assert.match(hire, /function renderRecruitCandidates/);
assert.match(hire, /刷新候选人 ¥\$\{RECRUIT_REFRESH_COST\}/);
assert.doesNotMatch(hire, /签约后现金/);
assert.match(hire, /section\.view\[data-view="hireMarket"\]/);
assert.doesNotMatch(hire, /刷新候选人 ¥350 · 员工/);

assert.match(styles, /\.owned-worker-list/);
assert.match(styles, /\.owned-worker-card/);
assert.match(styles, /\.hire-market-tabs/);
assert.match(styles, /\[data-owned-dismiss-footer\]/);
assert.match(styles, /\.danger-outline/);
assert.match(styles, /\.owned-dismiss-inline/);
assert.doesNotMatch(hire, /modal-root--detail-drawer/);
assert.doesNotMatch(styles, /\.modal-root--detail-drawer/);
assert.doesNotMatch(styles, /\.owned-worker-dismiss-modal/);
assert.doesNotMatch(styles, /\.owned-worker-dismiss-root/);

console.log("hire-market-roster-smoke: employee roster tab shell ok");
