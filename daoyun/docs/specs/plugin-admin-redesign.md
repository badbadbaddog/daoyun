# 插件管理页改版

## 目标与验收
按已确认效果图实现：默认已安装列表、官方插件页签、名称/键/描述搜索、启停筛选、紧凑列表和右侧单插件面板。设置、权限、详情分别展示，开发者工具放入高级入口。保留安装审批、权限控制、冲突刷新、卸载确认、沙箱贡献与业务管理入口。空列表、加载失败、无搜索结果有明确提示。320、768、1024、1440 宽度无横向溢出。

## 实施顺序
1. 补页签、筛选、单插件面板的失败行为测试。
2. 在 src/components/PluginAdminPanel.tsx 重排展示，复用现有设置与弹窗、API，样式放在 src/styles.admin.css。
3. 更新原有行为测试的交互入口；浏览器验证页面、键盘、启停、设置、安装和响应式布局。

## 技术与代码约定
React 19 + TypeScript + Lucide；命名导出、语义颜色令牌、UTF-8。示例：`const [selectedId, setSelectedId] = useState<string | null>(null)`。只使用现有依赖和服务端权限契约。

## 验证命令
- pnpm test
- pnpm typecheck
- pnpm build
- pnpm test:e2e:typecheck
- pnpm exec playwright test e2e/plugin-admin-redesign.spec.ts --project=chromium-desktop

## 边界
沿用现有数据与校验；不修改后端和数据库、不提交生成产物或用户既有改动。用户已确认效果图并授权实施，无待确认问题。

## 验证结果
全量单元测试 96 个文件、727 项通过；最终补充权限撤回与重复打开焦点检查后，插件组件 24 项通过。生产与浏览器测试类型检查、Vite 构建通过。Playwright 在 320/768/1024/1440 宽度验证配置保存与草稿保留、键盘页签、筛选、启停、卸载确认、官方插件重装及焦点恢复；4 项通过，无横向溢出、控制台错误或 WCAG 2 A/AA、2.1 AA 检查违规。浏览器使用真实前端和模拟 API，未执行真实后端安装。
