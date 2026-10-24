# 工资结算弹窗精简布局（已上线）

按确认的设计，将工资回执改为580px宽的紧凑账单：顶部并列展示结算状态和实际扣款；员工、岗位和本期工资使用表格；移除现金余额及数字、计薪天数，保留员工人数。零欠薪项不显示，规则说明默认折叠。

欠薪时显示待补金额，提供“前往补薪”；已结清但停工时提供“前往复工”。两者通过现有员工页入口跳转，确认回执仍使用原来的ackEmployeePayrollSettle，不直接执行扣款。存在历史欠薪时，表格同时显示原有欠薪及应付合计。姓名按HTML转义，旧回执缺少岗位时显示“—”。

## 修改范围

- `public/shell/payroll-settle-modal.js`：账单模板和状态文案。
- `public/shell/game-modal.js`：可选页脚内容槽、将当前名册传入岗位展示。
- `public/styles/payroll-settle.css`、`public/styles.css`：专用样式，适配窄屏、夜间和触屏。
- `scripts/employee-payroll-smoke.mjs`：更新既有UI断言。
- `scripts/employee-payroll-browser-fixture.mjs`：独立验收安装现有员工测试夹具，不操作正式存档。

工资规则保持当前版本：登录日记薪、下个登录日结算、离线不计薪、同日去重、解雇结清当天工资、一个营业日宽限、保留周转金后按经营收入20%补薪。工资结算、经济服务、周转金、共享日薪规则和补薪命令五个文件修改前后SHA256完全一致，记录见`rules-preserved.json`。

## 验证

通过现有检查：employee-payroll-smoke、employee-payroll-policy-smoke、employee-payroll-socket-e2e、auction-settle-modal-smoke、livestream-settle-modal-smoke、modal-lifecycle-smoke、styles-split-smoke、responsive-layout-smoke、night-theme-smoke、architecture-quality-gate、action-router-smoke、ui-stability-smoke。

浏览器在无存档的3019/3020端口验收正常结算、资金不足、规则展开/折叠、跳转员工补薪页、关闭后刷新不重复扣款，以及夜间模式。截图为`paid.png`、`grace.png`、`night.png`。验收服务和页面已关闭。

## 上线与存档

- 2026-10-24北京时间11:34重启，正式端口3000，PID37792，替换PID28860。
- 重启前备份：`data/world.json.before-payroll-compact-20261024-113335.bak`。
- 恢复106名玩家、424名员工；逐玩家比对现金、名册及完整employeePayroll字段均一致。
- 健康检查ready=true、persistence=ready、连续持久化失败0；错误日志为空。
- 正式服务已验证提供新弹窗模板及样式。启用核对见`activation.json`。
- 日志：`data/payroll-compact-service-20261024.out.log`、`data/payroll-compact-service-20261024.err.log`。
