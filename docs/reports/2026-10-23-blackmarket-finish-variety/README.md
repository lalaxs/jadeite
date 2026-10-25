# 黑市成品随机加工方案

## 完成的行为

新生成的 NPC 成品从玩家真实支持的取件题材和精加工组合中随机选择。取件范围为手镯、蛋面、平安扣、无字牌、叶子、水滴、佛公；未接通取件模板的如意、观音、福豆、葫芦及未开放耳坠不进入供货池。

- 先通过玩家取件参数规范化，再冻结同一份玉件快照。手镯圈口仅取 52、54、56、58、60、62；其他玉件使用 S/M/L。
- 普通成品铺的素玉编绳、金属无配石、带配石款权重分别为 35/45/20；行商为 15/45/40。先排除不适用的组合，再按剩余权重抽取。
- 非手镯亮光/柔光/哑光为 45/40/15。手镯亮光/柔光为 55/45，基础出光/标准精修/匠心精修为 25/55/20；手镯不生成金属、配石和底托。
- 蛋面戒指先检查实际尺寸、厚度，采用金属镶嵌；透底/封底为 80/20。编绳仅用于吊坠，平安扣和无字牌仅使用编绳或包镶。
- 镶法决定允许的金属、是否配石和真实石座数量；微镶必须配石，编绳、包镶不配石。数量使用玩家方案规范化和报价中的当前石座规则。
- 从玩家可达到的员工阶数与技能等级取样，通过现有阶段评分、评级、工艺增值和精加工报价计算估值，沿用原有黑市报价与清仓倍率。
- 成品铺保留满架至少三种题材，补货末尾尽量补齐编绳与金属款。新方案优先避开当前在售的相同方案，最多重抽 24 次，耗尽时使用合法候选，避免去重使补货失败。
- 成品名称根据实际器型生成；外观组件、金属和配石用量来自同一份加工记录。

已有完整货品和已购成品不重抽，旧兼容修复继续使用原默认方案。新规则不修改换货、补货计时或优惠配额；旧货随正常换货逐步退出。

## 修改范围

- 新增 `server/services/blackmarket/npc-finish-plans.js`：合法方案抽样、风格与方案标识、工艺评分。
- 调整 `npc-catalog.js`、`npc-jade-finish.js` 和 `npc.js`：新货生成、旧货兼容分离、货架覆盖。
- 新增 `blackmarket-npc-variety-smoke.mjs`，调整原成品和 Socket 测试，接入 `test:blackmarket-npc`。

## 验证

17 个相关脚本通过；未运行完整 `npm test`：

`blackmarket-npc-smoke`、`blackmarket-npc-schedule-smoke`、`blackmarket-npc-finish-smoke`、`blackmarket-npc-variety-smoke`、`blackmarket-offcut-smoke`、`blackmarket-npc-socket-e2e`、`inlay-system-smoke`、`bangle-finish-smoke`、`planning-authority-smoke`、`finished-product-design-smoke`、`workshop-craft-scoring-smoke`、`architecture-quality-gate`、`blackmarket-service-smoke`、`blackmarket-refresh-smoke`、`market-card-info-smoke`、`jade-piece-smoke`、`sqlite-world-persist-smoke`。

新增检查覆盖 350 件真实生成商品的合法取件与加工、七种题材、六种圈口、六种镶法、四种金属、三种配石、三种抛光、三种手镯精修、透底/封底；4500 次方案抽样检验风格、抛光、精修与底托比例；超大和过薄蛋面限制；20 批补货覆盖与去重；工坊报价一致、已购规范化与读档不变。Socket 测试增加真实买入成品及 SQLite 进程重启后玉件、组件、加工记录、评分、名称与估值一致性验证。

按 game-playtest 在独立 3019 测试服验收，禁用持久化。为覆盖外观，测试夹具只从真实生成器的结果中筛选六种方案，没有手工伪造加工字段。验证货架图片、购买预览及实际买入：铂金槽镶钻石蛋面戒指在库存中保留相同器型、配材、抛光与估值，浏览器错误/警告日志为空。未做本轮移动端窗口尺寸验收。

- [实际货架](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-blackmarket-finish-variety/finished-shelf.jpg)
- [铂金钻石戒指购买预览](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-blackmarket-finish-variety/ring-preview.jpg)
- [购买后的相同戒指](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-blackmarket-finish-variety/purchased-ring.jpg)

## 常驻服务生效状态

当前 `data/world.json` 已通过新版本存档导入校验，包含 104 名玩家和 5 个摊位。

2026-10-23 按用户明确要求完成本机 3000 服务重启，已加载新的成品生成规则。原进程 2716 停止，新进程 32112 就绪，持久化状态为 ready，连续持久化失败为 0，错误日志为空。

重启前备份为 `data/world.json.before-npc-finish-variety-restart-20261023-1792728297813.bak`。重启后核对 104 名玩家均保留，112 件已有完整成品的玉件、组件、加工记录、名称与估值完全一致。没有强制清空或重抽当前货架；后续正常换货和补货生成的成品使用新规则。

详细记录见 [activation.json](activation.json)。

验收附件：[文件列表](https://github.com/lalaxs/jadeite/tree/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-blackmarket-finish-variety)。
