# M03 后的暂停交接

> 历史记录（2026-10-07 标注）：下文状态、待办、暂停要求和环境描述仅适用于当时的旧任务。当前 M01–M08 已全部 DONE；最新进度与后续入口见 [当前交接](../../handoffs/membership-admin-redesign/current.md)，最终验证及限制见 [M08 最终报告](../../handoffs/membership-admin-redesign/m08-final.md)。旧草稿与旧阶段结果保持原事实。

状态：PAUSED（用户明确要求完成当前任务后暂停）。2026-10-06。

## 已完成
M01 架构核对、M02 导航与首页、M03-T01 membership-summary 聚合读取、M03-T02 会员核心用户列表与真实筛选均 DONE。最新代码未提交。不要清理工作区已有无关文件。

## 恢复入口
用户明确要求继续后，先完整阅读 architecture.md、plan.md、M03-T01-result.md、M03-T02-result.md 与本文件，然后为 M04 保存 Task Plan 和失败行为测试。不要重新实施 M03，不要并行修改 M04–M08。

## M04 尚未完成的产品工作
用户详情概览顶部完整身份信息、统一会员身份页、概览/会员身份/有效权限/内容/账号安全/管理记录标签，以及同一 UID 的组/EXP/积分/权益/勋章读取与领域独立写操作、流水、历史。新聚合 getAdminUserMembershipSummary 已可复用；列表 membership 是紧凑投影，不应拿它替代完整档案。

EXP 当前等级来自 experience_accounts.current_level_id；旧积分 level_key 绝不能当成长。组只配置普通能力，治理仍来自 Role/Assignment。权益保留版本快照和历史；所有写入保留原会话、CSRF、能力、revision、幂等、审计及未知结果恢复。勋章写契约现有缺口应在 M04 单独核对，不能为了界面伪造幂等字段。

## 环境与证据
当前真实预览 http://127.0.0.1:5173/#admin/users；API 3000，PostgreSQL 55433。API 原 wasm-plugins 开启配置已恢复。运行中的 Windows 二进制会锁住构建输出，重建该服务前先停止该服务进程并在构建后恢复原配置。

最新证据：test-results/admin-membership-rebuild/M03/T02。前端 1131、Rust 503、TS、build、fmt、clippy、OpenAPI、浏览器均 PASS。Rust 使用已安装的 1.94.1 GNU 工具链；shell 执行工具当前存在 CET 启动限制，验证通过 Node 进程接口执行。不要在交接文件记录密码、会话或环境变量内容。

M04–M08 NOT DONE。用户尚未授权恢复工作，暂停期间不启动新的探索、实现、测试或自动化任务。
