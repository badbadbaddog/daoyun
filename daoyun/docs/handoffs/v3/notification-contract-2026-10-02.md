# DYR-004 通知契约冻结

状态：已冻结并于 2026-10-03 通过 DYR-004 定向验收；整体 V3 仍 IN_PROGRESS。

- 列表新增可选 unread=true，缺省保留全部列表。服务端在分页前筛选，不使用已加载条目模拟全局未读。
- 排序沿用 (created_at,id) 倒序。全部游标保留 UUID；未读游标采用 unread:UUID，不能交叉使用。游标归属与资源检查仍由服务端执行；游标通知随后已读时仍可继续该未读页。
- 游标锚点随后变为已读仍可使用；筛选绑定编码不构成授权，归属由服务端重新校验。
- 单条已读仍返回原 Notification，保持幂等和 CSRF；前端随后读取权威 unread-count，不按当前页长度减一。
- 全部已读保持原 PATCH 和无请求体契约。水位是服务端该 UPDATE 语句开始时的 PostgreSQL READ COMMITTED 快照中本人已有未读通知；包含未加载页面，排除当时未提交的事件，即使它们的 created_at 较早。操作内不按客户端时间或 UUID 截止。修改、审计、计数在同一事务内完成；计数代表计数语句开始时可见的剩余未读，提交之后新到通知由下一次刷新反映。
- 全部已读成功后重新取列表与权威计数，不把页面里的每条通知按客户端时钟标成已读。
- 首屏、分页、计数、写操作均持有会话作用域与取消信号；切账号、筛选和卸载后的旧响应不写回。父角标有请求代次，子页新权威计数使旧初始计数失效。
- 多标签页采用进入路由、窗口聚焦和重新可见时刷新；不广播 Cookie/CSRF，不轮询全站数据。

依赖锁定：React 19、Axum 0.8.9（Cargo.lock）、PostgreSQL 16。沿用既有 React effect 清理与 Axum Query rejection 封套，不更换请求库。

官方依据：[PostgreSQL 16 READ COMMITTED](https://www.postgresql.org/docs/16/transaction-iso.html#XACT-READ-COMMITTED)、[React effect 请求竞态](https://react.dev/reference/react/useEffect#fetching-data-with-effects)、[Axum 0.8.9 Query](https://docs.rs/axum/0.8.9/axum/extract/struct.Query.html)。

预定验收：55→54、首屏已读而后页未读、UPDATE 等锁期间提交较早 created_at 的新通知、筛选绑定游标、会话/筛选/旧计数竞态、匿名/跨账号/CSRF/request_id/OpenAPI。
