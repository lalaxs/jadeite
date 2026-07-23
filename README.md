# 翡翠街 Jade Market Prototype

一个多人网页经营游戏原型。玩家在同一个本地服务器里参与翡翠公盘、加工经营、NPC 订单、收藏、直播和玩家交易。

## 当前核心流程

公盘竞拍 → 开料（opening）→ 规划取件（carving）→ 精加工（finishing）→ 藏品 / 订单 / 市场 / 直播

每台加工设备容量固定为 1；同一设备没有等待队列。

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

## 验证

```powershell
npm test
npm start
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

这是原型版本，数据目前只保存在服务器内存里。服务器重启后，玩家资产、库存和市场会重置；当前尚未接入数据库和正式账号系统。
