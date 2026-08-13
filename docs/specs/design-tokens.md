# 共享设计令牌包规格

## 目标

把当前集中在 `src/styles.css` 的刀云视觉变量抽成独立的 `@daoyun/design-tokens` 工作区包，使公开 Web、Mobile Web/PWA 和同仓 Admin Web 使用同一份主题、密度与响应式令牌，同时保持现有视觉和运行时品牌覆盖行为不变。

## 技术栈

- CSS Custom Properties：提供可跨 Web 客户端直接消费的稳定契约。
- pnpm 9 workspace：以 `workspace:*` 连接根应用和本地令牌包，不新增第三方依赖。
- Vitest：验证包导出、消费入口、选择器和值以及变量覆盖边界。

## 命令

```text
安装：pnpm install --offline
契约测试：pnpm vitest run scripts/design-tokens.test.mjs
全量测试：pnpm test
类型检查：pnpm typecheck
生产构建：pnpm build
浏览器回归：pnpm test:e2e
```

## 项目结构

```text
packages/design-tokens/package.json  独立包元数据与 CSS 导出契约
packages/design-tokens/tokens.css    主题、语义颜色、尺寸和响应式令牌
src/main.tsx                         根应用的共享包消费入口
src/styles.css                       仅保留产品组件和页面样式
scripts/design-tokens.test.mjs       共享包静态契约回归
```

## 代码风格

令牌使用语义名称，主题和官方预设只通过根元素属性覆盖：

```css
:root {
  --surface: #ffffff;
  --text: #17201c;
}

:root[data-theme="dark"] {
  --surface: #171c19;
  --text: #f2f5f3;
}
```

组件继续只消费 `var(--token-name)`，不硬编码主题颜色。运行时品牌配置仍可通过根元素内联变量覆盖默认 `--brand` 和 `--accent`。

## 测试策略

- 契约测试验证包名、CSS 子路径导出、工作区依赖和根入口导入顺序。
- 契约测试验证浅色、深色、紧凑、高对比度和窄视口选择器均保留。
- 契约测试验证 `src/styles.css` 不再声明共享变量，防止多份令牌源漂移。
- 全量 Vitest、TypeScript 和生产构建证明抽取没有破坏现有行为。
- Playwright 桌面与移动回归验证实际浏览器中的主题、布局、无障碍和控制台状态。

## 边界

- 始终：保持现有令牌名称、值、选择器优先级和 CSS 加载顺序；使用 UTF-8。
- 需要另行确认：删除或重命名公开令牌、改变颜色或间距、发布到公共 npm registry。
- 禁止：在组件内复制主题色、引入运行时主题代码、加载任意第三方主题脚本。

## 实施任务

- [x] 任务 1：添加失败的共享包契约测试。
  - 验收：当前代码因缺少独立包而稳定失败。
  - 验证：`pnpm vitest run scripts/design-tokens.test.mjs`。
  - 文件：`scripts/design-tokens.test.mjs`。
- [x] 任务 2：建立工作区包并接入根应用。
  - 验收：根应用通过 `@daoyun/design-tokens/tokens.css` 消费唯一令牌源。
  - 验证：契约测试、`pnpm install --offline`、`pnpm typecheck`、`pnpm build`。
  - 文件：`pnpm-workspace.yaml`、`package.json`、`packages/design-tokens/package.json`、`packages/design-tokens/tokens.css`、`src/main.tsx`、`src/styles.css`。
- [x] 任务 3：完成真实浏览器与全量质量门禁。
  - 验收：桌面和移动回归无视觉、控制台、无障碍或溢出回归。
  - 验证：`pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm test:e2e`。
  - 文件：不新增生产代码；仅在发现回归时做最小修正。

## 成功标准

- `@daoyun/design-tokens` 是具有明确 CSS 子路径导出的独立工作区包。
- Web、PWA 与 Admin 的共同入口先加载共享令牌，再加载产品样式。
- 现有浅色、深色、紧凑、高对比度和 900px 窄视口行为保持一致。
- `src/styles.css` 不再包含 CSS Custom Property 声明。
- 契约测试、全量测试、类型检查、生产构建和浏览器回归通过。

## 开放问题

- 独立原生移动应用不在当前仓库中；其令牌格式转换留到该客户端立项时定义，本包当前覆盖 Web、Mobile Web/PWA 和 Admin Web。
