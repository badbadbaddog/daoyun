# DYR-002｜授权、额度与接口冻结

日期：2026-10-02。此任务只增加特征测试和现状文档，不改变业务授权语义。基线 OpenAPI 文档和 SHA256 保存在独立证据目录；公开 DTO 继续位于 crates/api-contract。

## 冻结的规则

1. 社区用户组只提供允许项，未勾选表示该组不提供，不是全局 deny。数据库允许表还具有 allow-only 约束。多个有效组与标准权益 permission_snapshot 取并集；同名权限保留各自来源身份。
2. 同名额度跨组、权益取 MAX，不求和；缺省返回 0。单次额度 amount < 0 或 amount > limit 拒绝；每日额度 amount < 1、超过总额或已用额度不足拒绝。因此 0 不表示无限。字节字段保持整数 bytes，界面 MiB 换算不能改变契约。
3. starts_at <= effective_at 且 ends_at 为空或严格大于 effective_at 才有效。撤销记录、停用组不贡献规则；权益采用授予时版本和权限/额度快照。不能读取最新版规则替换历史快照。
4. active/restricted 才能进入社区动作授权。restricted 拒绝定义的九种写权限；suspended/deleted 拒绝所有社区动作。诊断、前端按钮和旧客户端都不能覆盖账号限制。
5. 社区动作允许不替代资源访问。公开/发布/删除状态、目标及父版块访问策略、目标内容策略、版块发帖限制、治理团队作用域各自继续检查。版块只提供资源条件，不建立另一套社区用户组。
6. 每日额度窗口沿用 effective_at.date()，生产调用传 UTC 当前时间。事务内 UPSERT 的条件更新串行化最后额度竞争；后续资源校验失败必须回滚事务。幂等成功重放只复验权限，不重复扣额。verify_community_action_with_executor 传入 None/None，不写使用量。
7. role 与社区组分别服务管理授权和社区动作；版块角色 exact/subtree 范围用 daoyun_board_scope_covers 实际计算。组被允许不能授予管理角色，诊断结果不能作为授权令牌。

## 实际入口索引

| 入口 | 授权及资源边界 |
|---|---|
| 发布主题 | topics.rs::create_published_topic_with_extensions：重放先 verify；新写入 authorize(topic.create.daily,1)，再检查版块访问和版块用户限制；事务失败回滚 |
| 发布回复 | topics.rs::create_reply_with_extensions：相同重放与额度原则；检查发布主题、版块访问、锁定及版块限制 |
| 私信 | messages.rs::send_direct_message：重放 verify；新写入 message.send.daily；保留接收方关系与防重规则 |
| 上传 | attachments.rs::authorize_attachment_upload_with_executor：保留已有超级管理员分支；普通上传检查 upload.daily 和 file.bytes，再校验存储 |
| 下载 | attachments.rs::read_attachment：先内容可见性，verify 下载权限，读取对象后以实际字节扣每日下载额度；缩略图遵循内容访问检查 |
| 版块与内容读取 | boards.rs::list_public_boards/get_public_board；topics.rs feed/search/detail/replies；content_access_policies 与 daoyun_can_access_board/附件检查保持一致 |
| 内容治理 | topics.rs govern_topic/moderate_topic 检查真实目标 scope；移动还检查目标版块 scope |
| 举报 | governance.rs::resolve_content_report 保留当前实例权限路径；是否需要更小作用域须在治理任务明确，不能默改 |
| 通知 | notifications.rs 当前没有调用内容访问判断；列入 DYR-004/028 受限目标回归，不能把当前缺口当安全规则冻结 |

具体调用点：community_permissions.rs 的 verify、authorize、community_quota_limit_with_executor；topics.rs 原始基线 1063/1127/1138/1152、1739/1802/1814/1842；attachments.rs 原始基线 315–431/440/497/619–657；messages.rs 原始基线 343/409。父版块限制见 migration 202608180001；管理范围见 authorization.rs::has_permission_with_executor。行号属于 source-snapshot 基线，后续修改以符号查找。

## 错误和并发契约

社区动作权限拒绝：HTTP 403 + community.permission_denied；上传使用现有 attachment.forbidden，不统一重命名旧错误。额度拒绝：HTTP 429 + community.quota_exceeded。未认证 HTTP 401 + auth.unauthenticated；CSRF、request.idempotency_conflict、各领域 revision conflict 继续分别返回，不能以一般网络错误掩盖。所有业务响应 meta.request_id 与 x-request-id 相同；原始 OpenAPI 只带响应头。

真实 /api/v1/users/me/membership 未认证返回 401 且 request_id 匹配。首次探测不存在路径返回 404，保留为 initial_route_probe，不用于 401 验收。OpenAPI 基线 SHA256：8dd95b04cf46ca1156421c74034c5f7b0a412c29e45302fe4a407ed418380182；当前生成客户端检查 PASS。

## 特征测试

新增 community_permissions_characterization_tests.rs 在 sqlx 隔离数据库内固定 Unix 时间 1800000000，直接调用生产事务函数：

- AC-002-01：组 10/20 的快照与真实额度均为 20；21 拒绝、20 消耗成功、再用 1 拒绝，使用量保持 20。
- AC-002-02：删除所有组 topic.create 允许项，唯一标准权益仍使真实动作允许；未勾选组不产生全局否定。
- AC-002-03：到期前 1 秒允许，到期相等及之后 1 秒拒绝；快照同步移除过期权益，verify 不产生 quota_usage。
- 补充：0 与缺省每日额度均拒绝消费且不创建使用量。

这是当前行为特征补测，首轮语法错误日志单独保留，修正 fixture 引用后 3 项 PASS；没有把编译错误称为行为 RED。今后新行为继续先写能复现缺口的失败测试。定向日志：artifacts/v3/baseline-2026-10-02/logs/dyr002-characterization-fixed.log。

## 后续安全缺口

DYR-012 已验证系统角色及最后管理员任命保护、拒绝审计、授权上限与本人提权拒绝（见 team-roles-2026-10-03.md）；DYR-013 已完成只读诊断、真实动作重新校验和普通用户脱敏，并修复附件 clean／未删除读取边界（见 permission-check-2026-10-03.md）；DYR-028 覆盖通知、受限附件、缓存、搜索、并发最后额度和诊断后条件变化。上述安全缺口必须按对应卡修复验证，不因特征冻结永久保留。生产数据、框架、锁文件未改变。
