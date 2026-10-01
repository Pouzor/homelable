# 简体中文（zh-CN）使用说明

Homelable 前端已内置简体中文。**后端、`.env`、docker-compose 全部不用改** —— 语言选择存在
浏览器的 `localStorage`（键名 `homelable.locale`），不带 `v` 前缀。

## 怎么切换

三处入口，任选其一：

| 位置 | 场景 |
|---|---|
| 登录页底部 | 还没登录时就想切 |
| 顶栏（Save 按钮左边） | 编辑画布时随手切 |
| 设置弹窗 → Language | 正式设置位置 |

选择**立即生效**，不需要点保存，也不会重新加载页面。

## 默认语言

按这个顺序决定：

1. `localStorage` 里存过的选择（优先级最高）
2. 浏览器语言以 `zh` 开头 → 自动用简体中文
3. 其它情况 → English

所以中文系统的浏览器打开就是中文，不需要手动切；想换回英文随时可以切。

## 覆盖范围

界面文案（按钮、标题、提示、报错、气泡提示、`aria-label`、占位提示、右键菜单式文案）、
网络扫描与各集成（Zigbee / Z-Wave / Proxmox / UniFi）的导入流程、文档中心、机柜视图、
新手导览、toast 提示、相对时间（`15 分钟前`）。

**不翻译**的（有意为之）：设备名/主机名等你自己填的内容、设备状态枚举在数据位上的原值、
技术标识（Proxmox、MQTT、YAML、IP、MAC…）、示例占位输入（`My Server`、`10.0.0.1`）、
`Home`+`lable` 品牌字样。

## 词典在哪、怎么改

```
frontend/src/i18n/
  core.ts              运行时：t() / 语言状态 / localStorage
  index.ts             React 绑定：useI18n()
  LanguageSwitcher.tsx 语言下拉框
  locales/
    GLOSSARY.md        术语表 —— 改译文前先看这个
    zh-CN.ts           合并入口
    parts/*.ts         词典分片（按界面区域分）
```

**key 就是英文原文**：`t('Save')` 查不到中文时直接显示 `Save`。所以：

- 漏翻不会白屏，只会退回英文；
- 英文文案改了而中文没跟上，那一条会自动退回英文，不会串词；
- 改译文只动 `parts/*.ts`，不用碰组件代码。

`GLOSSARY.md` 是跨区域统一的术语表，`Save`/`Cancel`/`Device` 这类词以它为准；
`parts/common.ts` 专门放多个区域共用的短词。

## 防止漏翻的三道自动检查

`frontend/src/i18n/__tests__/i18n.test.tsx`（`npm test` 会跑）：

1. 扫描全部源码里 `t('...')` 的字面量，**任何一条没有中文译文就测试失败**；
2. 反向检查：词典里有、代码里已不再使用的条目也失败（防止改英文后留下失效条目）；
3. 同一个英文在两个分片里译成不同中文就失败（防止同一个词两种译法）。

跑法：

```bash
cd frontend
npx tsc -b          # 类型
npm run lint        # 规范
npm test            # 全部测试
npm run build       # 产物
```

## 加一种新语言

1. 在 `locales/parts/` 下建 `<locale>.ts`，照抄 `zh-CN` 的结构；
2. `core.ts` 的 `LOCALES` / `LOCALE_LABELS` 加一项；
3. `locales/zh-CN.ts` 旁边新建合并入口，或把 parts 改成按语言分组。

`t()` 的英文兜底逻辑对新语言同样成立：不存在的 key 会退回英文。
