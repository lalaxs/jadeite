# 翡翠街 Jade Market Prototype

一个多人网页经营游戏原型。玩家在同一个本地服务器里参与翡翠公盘、切石、切片、片料规划、成品分割、NPC 订单、收藏和玩家交易。

## 当前玩法

- 公盘拍原石：原石有矢量表现图，显示皮壳、开窗、色带和裂。
- 角度切石：玩家自己调整刀线角度，上机等待后才出结果。
- 切片：明料可以切成多片片料。
- 规划分割：玩家在片料板上调整取件类型、位置、尺寸和旋转。
- 成品经营：手镯、珠串、无字牌可收藏、直播卖、交易或用于订单。
- 多人同服：多个浏览器窗口连接同一个本地服务器，共享公盘、交易行和战报。

## 启动方式

先安装依赖：

```bash
npm install
```

启动本地服务器：

```bash
npm start
```

然后打开：

```text
http://localhost:3000
```

## 项目结构

```text
server.js              后端游戏服务器和核心结算逻辑
public/index.html      页面结构
public/main.js         前端交互和渲染逻辑
public/styles.css      UI 样式
docs/design-plan.md    当前游戏设计方案
docs/project-notes.md  后续开发说明
```

## 当前技术

- Node.js
- Express
- Socket.IO
- 原生 HTML/CSS/JavaScript

## 重要说明

这是原型版本，数据目前保存在服务器内存里。服务器重启后，玩家资产、库存和市场会重置。下一阶段建议接入数据库和账号系统。
