# 工坊锦匣交付

开料、规划取件和精加工成功后，产物保存在工坊待领取批次中。设备和师傅立即释放，产物在领取之前不能再次加工、交易或提交订单。

右侧「进行事项 → 工坊」优先展示待领取批次，页签和手机「事项」入口显示数量。点击领取打开锦匣弹窗，点击锦匣后，真实玉件预览沿弧线依次飞出并排列；单件居中，多件自适应网格，S/A 级产物带一次扫光。支持跳过动画与减少动态效果偏好。

点击「收入背包」才实际发放产物，同批取件余料一同入库。已开匣时间随存档保存，关闭或刷新后可以继续领取。领取成功后播放收拢动画，标记库存为新，并移除对应待领事项。失败加工沿用碎裂/退料规则，不生成交付锦匣。

服务端揭晓和领取都经过现有持久化事务与请求编号校验。领取权属于当前玩家，请求不能提交或替换产物数据；重复领取不能增发。待领取产物纳入所有权唯一校验、资产报告和救济资格检查。委托物保留归属，领取后才能提交；到期或失联回收可以找回待领批次中的全部委托产物，余料继续保留。

## 验证

- package.json 中完整 test 链的 106 项检查全部通过，详情见 [checks.json](checks.json)。当前执行环境未提供 npm 命令，因此使用同一 Node.js 运行时依次执行原 test 链中的全部脚本。
- 新增领域检查覆盖三道工序、多产物和余料、无法提前使用、设备与师傅释放、揭晓及领取防重、存档与公开快照、离线完成、失败、委托到期回收和请求格式校验。
- 新增真实 Socket.IO + SQLite 检查覆盖越权、伪造产物请求、揭晓后重连、领取后重启，以及跨重启请求防重。
- 浏览器使用独立 3013 端口和关闭持久化的测试世界，经真实生产服务生成测试批次，没有修改正常玩家存档。
- 检查桌面 1280×720、手机 390×844 及 320×568，包含三件取件与余料、单件镶嵌成品、跳过演出、刷新续领和入包完成。小屏无横向溢出，底部领取按钮可见；浏览器 warn/error 日志为空。
- 现有回归用例的手动领取步骤已补齐；旧用例同步采用当前服务端自动计算配石颗数、复制原料纹理快照的约定。

## 截图

- [桌面多件产物](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-21-workshop-delivery/desktop.png)
- [390px 手机多件产物](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-21-workshop-delivery/mobile.png)
- [手机镶嵌成品](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-21-workshop-delivery/finished-mobile.png)
- [320px 小屏](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-21-workshop-delivery/mobile-320.png)
- [白天主题](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-21-workshop-delivery/day.png)
- [领取完成](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-21-workshop-delivery/collected.png)

## 本地运行状态

正常存档已备份并验证 JSON 可读取：`backups/before-workshop-delivery-20261021-164515.json`。

自动审批拒绝了停止并重启 3000 端口本地游戏服务的操作，仅返回 `blocked by policy`。该操作未执行，需手动重启当前游戏服务以完整加载后端改动，再刷新游戏页面。隔离试玩服务已停止。

验收附件：[文件列表](https://github.com/lalaxs/jadeite/tree/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-21-workshop-delivery)。
