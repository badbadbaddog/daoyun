# Spec: 发帖弹窗

## Objective

发帖弹窗支持多图上传、本地草稿和正文标签。登录用户可以点击或拖拽上传最多 9 张图片，并在发布前排序或删除；标题输入框默认显示；正文中的 `#标签` 自动高亮并作为主题标签提交，不再提供独立标签输入框。未发布内容保存到当前用户的本地草稿，发布成功后清除。

## Tech Stack

- React 19、TypeScript、Vite
- Vitest、Testing Library
- 现有 `/api/v1/attachments/drafts` 上传接口
- 原生 File API、Drag and Drop API；不新增依赖

## Commands

- 测试：`pnpm test -- --run`
- 定向测试：`pnpm exec vitest run src/components/TopicComposer.test.tsx src/components/TopicRow.test.tsx`
- 类型检查：`pnpm typecheck`
- 构建：`pnpm build`

## Project Structure

- `src/components/TopicComposer.tsx`：图片选择、草稿恢复、正文标签提取和发布组装
- `src/components/RichTextEditor.tsx`：发帖场景关闭旧的正文内上传入口，并装饰正文标签
- `src/components/RichTextContent.tsx`：在已发布正文中高亮标签
- `src/utils/tags.ts`：共享正文标签识别和 API 标签转换
- `src/components/TopicComposer.test.tsx`：多图、草稿、标题和标签行为测试
- `src/styles.css`：发帖弹窗图片网格及响应式样式
- `src/editor/richContent.ts`：复用既有富文本图片节点结构

## Code Style

```tsx
<button type="button" aria-label="删除图片 1" title="删除图片">
  <Trash2 aria-hidden="true" />
</button>
```

- 使用命名导出和既有语义颜色变量。
- 图标按钮必须有可访问名称和 tooltip。
- 卡片圆角不超过 8px。
- 复用现有附件上传与富文本契约，不引入排序依赖。

## Testing Strategy

- 组件测试覆盖点击选择、拖拽选择、9 张上限、排序、删除、上传中禁止发布。
- 发布断言验证图片节点顺序及首图位置。
- 单元测试覆盖连续正文标签识别；组件测试覆盖本地草稿保存、恢复和发布后清除。
- 编辑器和展示组件测试覆盖正文标签蓝色高亮。
- 既有 `TopicRow` 测试继续证明首页只渲染前 3 张。
- 浏览器验证弹窗视觉、拖拽区域、无障碍名称和响应式布局。

## Boundaries

- Always：沿用现有 CSRF、附件校验、幂等键和错误反馈。
- Ask first：数据库结构或公开 API 契约变更。
- Never：保存图片二进制到本地草稿、添加第三方拖拽或标签库、绕过附件上传接口。

## Success Criteria

1. 点击“上传图片”或把文件拖入上传区都会上传图片。
2. 图片总数最多为 9，超限时给出明确错误且不上传多余文件。
3. 已上传图片可拖拽排序，并可通过键盘左右方向键调整顺序。
4. 每张图片都可删除。
5. 发布请求中第一张图片节点位于所有图片节点首位，作为主图候选。
6. 首页主题卡片最多渲染前 3 张图片。
7. 标题输入框打开弹窗后直接显示，不需要额外点击按钮。
8. 独立标签输入框移除；正文中的 `#我是标签#例子标签` 识别为两个标签，最多提交 5 个且自动去重。
9. 正文标签在编辑器和已发布正文中使用品牌蓝色高亮；高亮时不处理代码和链接中的 `#`。
10. 标题、正文、版块和已上传图片引用自动保存到当前用户的本地草稿；重新打开可恢复，发布成功后清除。

## Open Questions

无。图片格式与单张大小继续沿用现有 PNG/JPG/GIF/WebP、10 MiB 限制；本地草稿只保存附件 ID 和文件名，附件仍受服务端约 24 小时的草稿有效期约束。
