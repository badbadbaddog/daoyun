# Spec: 版块合并的预览、迁移与回滚

## Objective

为版块合并定义可预览、可执行、可回滚的语义。
[站点后台重设计规格](station-administration-redesign.md) 第 124 行明确写道
"首版不提供不可逆版块合并；合并必须在后续规格中单独定义预览、迁移和回滚语义"，
但此前没有任何 spec 或 plan 承接这句话。本文件承接它。

当前版块树只提供删除，且在存在子版块或主题时以 `409` 拒绝
（[admin.rs:2884-2911](../../apps/api/src/admin.rs)）。这让"这个版块建错了/太冷清了"
成为死结：站长既不能删除，也没有把内容并入其他版块的手段，
只能逐条使用主题治理的 `move` 动作搬运。合并就是把这个批量搬运做成一次有边界的事务。

## Assumptions

- 合并是"把源版块的全部主题移入目标版块，然后软删除源版块"，不是新建第三个版块。
- 主题的搬运语义必须与既有单条移动完全一致
  （[topics.rs:461-481](../../crates/infrastructure/src/topics.rs)）：
  更新 `topics.board_id`，源版块 `topic_count` 递减，目标版块递增。
  合并不引入第二套计数口径。
- 回复、附件、标签、收藏、点赞和通知都通过 `topic_id` 关联，不直接引用 `board_id`，
  因此不需要在合并中改写。这一点必须由测试固定，而不是靠假设。
- 合并是低频高风险操作。宁可要求站长分两步（先迁子版块，再合并），
  也不要让一次调用产生难以预测的树形变更。
- 软删除是既有的版块删除语义，合并沿用它；这也是回滚成为可能的前提。

## Contract

### 预览

`GET /api/v1/admin/boards/{board_id}/merge-impact?target_board_id={uuid}`

要求 `admin.configuration.read`，与既有 `deletion-impact` 端点同级。返回：

| 字段 | 含义 |
| --- | --- |
| `source_board_id` / `target_board_id` | 参与合并的两个版块 |
| `topic_count` | 将被移动的主题数 |
| `reply_count` | 随主题一并归属变更的回复数（只用于展示，不单独改写） |
| `child_count` | 源版块的活动子版块数；非零时合并被拒绝 |
| `slug_conflict` | 源与目标是否存在会冲突的标识 |
| `blocked_reason` | 阻断原因；可执行时为 `null` |

预览是只读的，不占锁、不预留资源。它的计数与执行时刻的实际值可能不同，
因此执行必须自行重新校验，不得信任预览结果。

### 执行

`POST /api/v1/admin/boards/{board_id}/merge`

请求体：

```json
{
  "target_board_id": "uuid",
  "expected_source_revision": 3,
  "expected_target_revision": 7
}
```

- 要求 Cookie 会话、会话绑定 CSRF 和 `admin.configuration.write`，与既有版块写入一致。
- 两个 revision 都必须显式传入并匹配，采用与 `update_admin_board` 相同的乐观并发；
  任一过期返回 `409`，不做部分合并。
- 单事务内按固定 UUID 顺序锁定两个版块，避免与并发合并互相死锁。

拒绝条件，全部返回稳定 `409` 且不产生任何写入：

| 条件 | 理由 |
| --- | --- |
| 源与目标相同 | 无意义操作 |
| 目标是源的后代 | 会在软删除源之后使目标脱离树 |
| 源存在活动子版块 | 首版不级联；引导站长先迁移子版块 |
| 源或目标已软删除 | 不对已删除资源操作 |
| 主题数超过单次上限 | 见下 |

### 批量上限

单次合并至多移动 5000 个主题。超过上限返回 `409 board.merge_too_large`，
并在错误中给出实际数量。理由：合并在单事务内完成，无界事务会长时间持有
`boards` 行锁并阻塞该版块的所有发帖；5000 是既有批处理上限
（Outbox 100、举报 50、限制恢复 500）之上一个数量级的保守值，
足以覆盖真实冷清版块，又不会让事务长到影响在线写入。

超限版块应先用主题治理的 `move` 分批搬运，再执行合并。

### 事务步骤

1. 按 UUID 序锁定源与目标版块，校验 revision、后代关系、子版块和软删除状态。
2. 统计待移动主题数；超限则中止。
3. `UPDATE topics SET board_id = target WHERE board_id = source AND deleted_at IS NULL`。
4. 源 `topic_count` 归零，目标 `topic_count` 增加实际移动数；
   两者 `revision` 各加一，`updated_at` 刷新。
5. 软删除源版块，与既有 `delete_admin_board` 语义一致。
6. 写入一条 `admin_audit_log`，action 为 `board.merge`，
   摘要只含源 ID、目标 ID、移动主题数和两个新 revision。
7. 写入 `board.merged` Outbox 事件，供缓存失效与后续订阅方消费。

任何一步失败，全部回滚：不存在"主题已搬走但源版块还在"的中间态。

### 回滚

合并本身不可逆地改变了主题归属，因此"回滚"是一次显式的反向操作，而非撤销按钮。

`POST /api/v1/admin/boards/{board_id}/merge/rollback` 接受合并产生的 `audit_id`：

- 只允许回滚 24 小时内的合并，且该源版块此后没有再参与过合并。
  超出窗口返回 `409 board.merge_rollback_expired`。
- 反向操作恢复源版块的软删除标记，并把**当时移动的那批主题**移回源版块。
  这批主题由合并事务写入的 `board_merge_topics` 明细表确定，
  不能用"当前目标版块中的全部主题"反推——那会把目标版块原有主题一并搬走。
- 回滚后在目标版块新发的主题不受影响，仍留在目标版块。
- 回滚同样写入审计（`board.merge.rollback`）和 Outbox 事件。

`board_merge_topics` 明细在回滚窗口过期后由 [Outbox 保留与清理](outbox-retention.md)
同一个保留任务按 30 天窗口清理。

## Commands

```text
cargo test -p infrastructure --test admin_boards
cargo test -p daoyun-api --test admin
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
pnpm test
pnpm typecheck
pnpm build
pnpm generate:api --check
```

## Project Structure

- `migrations/`：`board_merge_topics` 明细表、索引及反向迁移。
- `crates/infrastructure/src/admin.rs`：预览查询、合并事务和回滚事务。
- `crates/infrastructure/tests/`：计数、并发、拒绝条件和回滚测试。
- `apps/api/src/admin.rs`：三个端点、capability 校验和错误映射。
- `src/components/`：版块树的合并入口、影响预览和确认。
- `docs/specs/board-merge.md`：本文件。

## Code Style

```rust
let impact = database
    .get_admin_board_merge_impact(source_id, target_id)
    .await?;
```

计数使用 `i64` 与既有版块记录一致；拒绝条件建模为枚举而非布尔组合，
使 `blocked_reason` 与 API 错误码一一对应，不在两处重复判断逻辑。

## Testing Strategy

- 计数正确性：合并后源 `topic_count` 为 0，目标等于原有加实际移动数；
  软删除主题不参与移动也不计入。
- 关联完整性：回复、附件、标签、收藏、点赞和通知在合并前后仍指向同一主题，
  且主题详情、板块列表和搜索返回一致结果。这条测试同时固定"关联无需改写"的假设。
- 拒绝条件：相同版块、后代目标、存在子版块、已删除版块、超限主题数分别返回稳定错误且无写入。
- 并发：两个合并同时以相反方向操作同一对版块时，UUID 锁序保证不死锁，且只有一个成功。
- 乐观并发：过期 revision 返回 `409` 且不产生部分写入。
- 回滚：窗口内回滚恢复源版块与那批主题；目标版块在合并后新发的主题不被搬走；
  超窗口和重复回滚被拒绝。
- 迁移：明细表正向和反向执行。

## Boundaries

- Always：单事务；固定 UUID 锁序；两个 revision 都显式校验；软删除而非物理删除；
  移动主题数有界。
- Ask first：级联合并子版块、跨站点合并、提高 5000 上限、延长回滚窗口。
- Never：物理删除版块或主题；在预览中占锁或预留；用"目标版块当前全部主题"反推回滚集合；
  在审计或 Outbox 摘要中输出主题标题、正文或作者。

## Success Criteria

- 预览返回的阻断原因与执行时的实际拒绝一一对应，不出现"预览可行但执行失败"以外的偏差
  （并发导致的偏差可接受，且必须返回稳定错误）。
- 合并后两个版块的 `topic_count` 与实际主题行数一致。
- 回复、附件、标签、收藏、点赞和通知在合并前后行为不变。
- 任何拒绝路径都不留下部分写入。
- 24 小时内的回滚精确恢复那批主题，不影响目标版块的其他内容。
- Rust workspace 与前端质量门禁保持通过。

## Decisions

- 合并定义为"移动加软删除"，而非新建合并版块：后者会使所有既有主题链接失效，
  且与 `station-administration-redesign.md:120-123` 已确立的软删除加审计语义冲突。
- 要求先手工迁移子版块，不做级联：级联合并会在一次调用里同时改变树结构和内容归属，
  失败时站长很难判断实际发生了什么。两步操作各自可预览、可验证。
- 用明细表而非"目标版块全部主题"支持回滚：后者会把目标版块原有主题错误搬走，
  这是合并回滚最容易出现的数据事故。
- 回滚窗口 24 小时而非无限：合并后目标版块会持续产生新内容和新的治理动作，
  时间越久，"恢复原状"的语义越模糊。24 小时覆盖误操作发现窗口，超出后应通过正向合并调整。
- 复用 `admin.configuration.write` 而非新增 capability：合并是版块配置写操作，
  与创建、更新、删除同属一类，新增维度不增加实际隔离。
