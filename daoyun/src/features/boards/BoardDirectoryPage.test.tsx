import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardDetail, BoardSummary } from "../../api/boards";
import type { Topic } from "../../types/community";
import { BoardDirectoryPage } from "./BoardDirectoryPage";
import { BoardPage } from "./BoardPage";

afterEach(cleanup);

const parent: BoardSummary = {
  id: "019fc610-0000-7000-8000-000000000010",
  slug: "parent",
  name: "父版块",
  description: "父版块介绍",
  icon: "messages",
  tone: "green",
  parentId: null,
  position: 10,
  depth: 0,
  childCount: 1,
  topicCount: 2,
};

const child: BoardSummary = {
  ...parent,
  id: "019fc610-0000-7000-8000-000000000011",
  slug: "child",
  name: "子版块",
  description: "子版块介绍",
  parentId: parent.id,
  position: 20,
  depth: 1,
  childCount: 0,
  topicCount: 0,
};

const unrelated: BoardSummary = {
  ...parent,
  id: "019fc610-0000-7000-8000-000000000014",
  slug: "design",
  name: "产品设计",
  description: "产品与体验讨论",
  parentId: null,
  position: 30,
  childCount: 0,
  topicCount: 9,
};

const detail: BoardDetail = {
  ...parent,
  children: [child],
  breadcrumb: [
    { id: parent.id, slug: parent.slug, name: parent.name },
  ],
  viewer: {
    canRead: true,
    canCreateTopic: true,
    canReply: true,
    canUploadAttachment: false,
  },
};

const boardTopic: Topic = {
  id: "019fc610-0000-7000-8000-000000000012",
  title: "社区里的图文内容",
  excerpt: "同一 Post 在社区页也应保留媒体卡片与互动信息。",
  board: parent.name,
  boardSlug: parent.slug,
  boardTone: parent.tone,
  authorId: "019fc610-0000-7000-8000-000000000013",
  authorUsername: "board_author",
  author: "社区作者",
  avatarUrl: null,
  publishedAt: "刚刚",
  replies: 4,
  likes: 8,
  bookmarked: false,
  liked: false,
  views: 32,
  imageUrl: "/community-cover.webp",
  tags: [],
};

describe("BoardDirectoryPage", () => {
  it("renders the public board hierarchy with canonical links", () => {
    render(
      <BoardDirectoryPage
        boards={[child, parent]}
        status="ready"
        error={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "版块", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "当前位置" })).toContainElement(
      screen.getByRole("link", { name: "首页" }),
    );
    expect(screen.getByRole("link", { name: "首页" })).toHaveAttribute("href", "#hot");
    expect(screen.getByRole("link", { name: "全部版块" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "版块指南", level: 2 })).toBeInTheDocument();
    const directory = screen.getByRole("region", { name: "版块目录" });
    expect(within(directory).getByRole("list", { name: "全部版块列表" })).toBeInTheDocument();
    expect(within(directory).getByRole("button", { name: "收起父版块" })).toHaveAttribute("aria-expanded", "true");
    const parentLink = within(directory).getByRole("link", { name: /^父版块/ });
    expect(parentLink).toHaveAttribute("href", "#board/parent");
    expect(parentLink).toHaveTextContent("1 个子版块");
    expect(parentLink).toHaveTextContent("2 个主题");
    expect(within(directory).getByRole("link", { name: /^子版块/ })).toHaveAttribute(
      "href",
      "#board/child",
    );

    fireEvent.click(within(directory).getByRole("button", { name: "收起父版块" }));
    expect(within(directory).getByRole("button", { name: "展开父版块" })).toHaveAttribute("aria-expanded", "false");
    expect(within(directory).queryByRole("link", { name: /^子版块/ })).not.toBeInTheDocument();
  });

  it("keeps the main surface focused on the complete directory", () => {
    render(
      <BoardDirectoryPage
        boards={[child, unrelated, parent]}
        status="ready"
        error={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.queryByRole("region", { name: "活跃版块" })).not.toBeInTheDocument();
    const directory = screen.getByRole("region", { name: "版块目录" });
    expect(within(directory).getByRole("link", { name: /产品设计/ })).toHaveAttribute("href", "#board/design");
    expect(within(directory).getByRole("link", { name: /^父版块/ })).toHaveAttribute("href", "#board/parent");
    expect(within(directory).getByRole("link", { name: /^子版块/ })).toHaveAttribute("href", "#board/child");
  });

  it("filters communities locally while preserving a matching child's parent context", () => {
    render(
      <BoardDirectoryPage
        boards={[child, unrelated, parent]}
        status="ready"
        error={null}
        onRetry={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索版块" }), {
      target: { value: "子版块" },
    });

    expect(screen.getByText("1 个匹配版块")).toBeInTheDocument();
    const results = screen.getByRole("list", { name: "版块搜索结果" });
    expect(results).toBeInTheDocument();
    expect(within(results).getByRole("link", { name: /^父版块/ })).toBeInTheDocument();
    expect(within(results).getByRole("link", { name: /^子版块/ })).toBeInTheDocument();
    expect(within(results).queryByRole("link", { name: /产品设计/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索版块" }), {
      target: { value: "不存在的社区" },
    });
    expect(screen.getByText("没有找到相关版块")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除版块搜索" }));
    expect(within(screen.getByRole("region", { name: "版块目录" })).getByRole("link", { name: /产品设计/ })).toBeInTheDocument();
  });

  it("opens the first expandable group when standalone boards come first", () => {
    render(
      <BoardDirectoryPage
        boards={[{ ...unrelated, position: 1 }, child, parent]}
        status="ready"
        error={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "收起父版块" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /^子版块/ })).toBeInTheDocument();
  });

  it("resets expansion to the first available group when refreshed data changes", () => {
    const { rerender } = render(
      <BoardDirectoryPage boards={[child, parent]} status="ready" error={null} onRetry={vi.fn()} />,
    );
    const refreshedParent = { ...parent, id: "019fc610-0000-7000-8000-000000000021", name: "刷新父版块" };
    const refreshedChild = {
      ...child,
      id: "019fc610-0000-7000-8000-000000000022",
      parentId: refreshedParent.id,
      name: "刷新子版块",
    };

    rerender(
      <BoardDirectoryPage
        boards={[refreshedChild, refreshedParent]}
        status="ready"
        error={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "收起刷新父版块" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /^刷新子版块/ })).toBeInTheDocument();
  });

  it("allows nested groups to collapse independently", () => {
    const grandchild = {
      ...child,
      id: "019fc610-0000-7000-8000-000000000031",
      parentId: child.id,
      name: "三级版块",
    };
    render(
      <BoardDirectoryPage
        boards={[grandchild, { ...child, childCount: 1 }, parent]}
        status="ready"
        error={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "收起子版块" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /^三级版块/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "收起子版块" }));
    expect(screen.getByRole("button", { name: "展开子版块" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: /^三级版块/ })).not.toBeInTheDocument();
  });

  it("keeps large community counts compact enough for narrow directory rows", () => {
    render(
      <BoardDirectoryPage
        boards={[{ ...parent, name: "高密社区", childCount: 12_345, topicCount: 987_654 }]}
        status="ready"
        error={null}
        onRetry={vi.fn()}
      />,
    );

    const link = within(screen.getByRole("region", { name: "版块目录" })).getByRole("link", { name: /高密社区/ });
    expect(link).toHaveTextContent("1.2万个子版块");
    expect(link).toHaveTextContent("98.8万个主题");
  });
});

describe("BoardPage", () => {
  it("renders breadcrumb, children, feed controls and current-board creation", () => {
    const onCreateTopic = vi.fn();
    const onSearchChange = vi.fn();
    const onSortChange = vi.fn();
    render(
      <BoardPage
        slug="parent"
        state={{ kind: "ready", board: detail }}
        topics={[] as Topic[]}
        topicState="ready"
        topicError={null}
        nextCursor={null}
        loadingMore={false}
        errorMore={null}
        searchQuery=""
        onSearchChange={onSearchChange}
        onSortChange={onSortChange}
        onCreateTopic={onCreateTopic}
        onLoadMore={vi.fn()}
        onRetryTopics={vi.fn()}
      />,
    );

    const breadcrumb = screen.getByRole("navigation", { name: "社区路径" });
    expect(breadcrumb).toBeInTheDocument();
    expect(within(breadcrumb).getByRole("link", { name: "首页" })).toHaveAttribute("href", "#hot");
    expect(screen.getByRole("navigation", { name: "版块快捷操作" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回社区版块" })).toHaveAttribute("href", "#boards");
    expect(screen.getByRole("button", { name: "搜索当前版块" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "浏览全部版块" })).toHaveAttribute("href", "#boards");
    expect(screen.getByLabelText("父版块社区概览")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "父版块" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "版块数据" })).toHaveTextContent("2帖子");
    expect(screen.getByRole("region", { name: "版块数据" })).toHaveTextContent("1子版块");
    const childNavigation = screen.getByRole("region", { name: "子版块导航" });
    const childLink = within(childNavigation).getByRole("link", { name: "子版块" });
    expect(screen.getByRole("heading", { name: "子版块导航" })).toBeInTheDocument();
    expect(childLink).toHaveAttribute(
      "href",
      "#board/child",
    );
    expect(childLink).toHaveAttribute("title", "子版块介绍");
    expect(childNavigation.querySelector(".board-children__icon")).not.toBeInTheDocument();
    expect(childNavigation).not.toHaveTextContent("1 主题");
    expect(screen.getByRole("list", { name: "子版块列表" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /收藏版块|关注版块/ })).not.toBeInTheDocument();
    for (const sort of ["最新", "活跃", "热门", "精华"]) {
      expect(screen.getByRole("button", { name: sort })).toHaveAttribute("aria-pressed");
    }
    expect(screen.getByRole("button", { name: "最新" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "热门" }));
    expect(onSortChange).toHaveBeenCalledWith("hot");
    expect(screen.getByText("这个版块还没有帖子")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索本版" }), {
      target: { value: "Rust" },
    });
    expect(onSearchChange).toHaveBeenCalledWith("Rust");
    fireEvent.click(screen.getByRole("button", { name: "发帖" }));
    expect(onCreateTopic).toHaveBeenCalledWith(detail.id);
  });

  it("reuses the unified post card presentation inside a community", () => {
    const onOpenTopic = vi.fn();
    const { container } = render(
      <BoardPage
        slug="parent"
        state={{ kind: "ready", board: detail }}
        topics={[boardTopic]}
        topicState="ready"
        onOpenTopic={onOpenTopic}
      />,
    );

    expect(container.querySelector(".topic-row")).toHaveAttribute("data-layout", "media");
    expect(container.querySelector(".board-topic-marker--discussion")).toBeInTheDocument();
    expect(container.querySelector(".topic-row > .topic-avatar")).not.toBeInTheDocument();
    expect(container.querySelector(".topic-author-meta .topic-author-avatar")).toBeInTheDocument();
    expect(container.querySelector(".topic-author-meta"))
      .toContainElement(screen.getByRole("link", { name: boardTopic.author }));
    expect(container.querySelector(".topic-context-meta"))
      .toContainElement(screen.getByRole("link", { name: boardTopic.board }));
    expect(screen.getByLabelText("主题列表列名")).not.toHaveClass("sr-only");
    expect(within(screen.getByLabelText("主题列表列名")).getAllByText(/帖子|点赞|回复|收藏/))
      .toHaveLength(4);
    expect(screen.getByRole("feed", { name: "主题列表" })).toHaveAttribute("aria-describedby", "board-topic-columns");
    expect(container.querySelector(".board-header__icon .lucide-message-square-text")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("heading", { name: boardTopic.title }));
    expect(onOpenTopic).toHaveBeenCalledWith(boardTopic.id);
  });

  it("places child boards before pins, sort controls and regular posts", () => {
    const pinnedTopic = { ...boardTopic, id: "pinned-topic", title: "置顶说明", pinned: true };
    const regularTopic = { ...boardTopic, id: "regular-topic", title: "普通讨论" };
    const { container } = render(
      <BoardPage
        slug="parent"
        state={{ kind: "ready", board: detail }}
        topics={[pinnedTopic, regularTopic]}
        topicState="ready"
      />,
    );

    const tabs = screen.getByRole("group", { name: "主题排序" });
    const pinned = screen.getByRole("region", { name: "置顶" });
    const children = screen.getByRole("region", { name: "子版块导航" });
    const topics = screen.getByRole("feed", { name: "主题列表" });

    expect(children.compareDocumentPosition(pinned) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pinned.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tabs.compareDocumentPosition(topics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(pinned).getByRole("heading", { name: "置顶说明" })).toBeInTheDocument();
    expect(within(topics).getByRole("heading", { name: "普通讨论" })).toBeInTheDocument();
    expect(within(pinned).getByLabelText("置顶主题")).toBeInTheDocument();
    expect(container.querySelectorAll(".topic-author-avatar")).toHaveLength(2);
  });

  it("keeps forbidden and missing states distinct and hides unauthorized actions", () => {
    const { rerender } = render(
      <BoardPage slug="private" state={{ kind: "forbidden" }} />,
    );
    expect(screen.getByText("你没有访问这个社区的权限")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "发主题" })).not.toBeInTheDocument();

    rerender(<BoardPage slug="missing" state={{ kind: "notFound" }} />);
    expect(screen.getByText("社区不存在")).toBeInTheDocument();
  });
});

// 搜索路径和无标题行为必须来自可见数据，不能把展示回退持久化为标题。
it("distinguishes identically named descendants by their full visible paths", () => {
  const third = { ...child, id: "019fc610-0000-7000-8000-000000000031", slug: "css", name: "CSS", parentId: child.id, depth: 2 };
  const other = { ...third, id: "019fc610-0000-7000-8000-000000000032", slug: "design-css", parentId: unrelated.id, depth: 1 };
  render(<BoardDirectoryPage boards={[parent, child, unrelated, third, other]} status="ready" error={null} onRetry={vi.fn()} />);
  fireEvent.change(screen.getByRole("searchbox", { name: "搜索版块" }), { target: { value: "CSS" } });
  expect(screen.getByText("父版块 / 子版块 / CSS")).toBeInTheDocument();
  expect(screen.getByText("产品设计 / CSS")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /^CSS.*父版块/ })).toHaveAttribute("href", "#board/css");
  expect(screen.getByRole("link", { name: /^CSS.*产品设计/ })).toHaveAttribute("href", "#board/design-css");
});

it.each(["loading", "error", "ready"] as const)("keeps directory %s distinct", status => {
  const retry = vi.fn();
  render(<BoardDirectoryPage boards={[]} status={status} error="请求失败" onRetry={retry} />);
  if (status === "loading") expect(screen.getByRole("status")).toHaveTextContent("正在加载版块");
  if (status === "error") {
    expect(screen.getByRole("alert")).toHaveTextContent("请求失败");
    fireEvent.click(screen.getByRole("button", { name: "重试加载版块" }));
    expect(retry).toHaveBeenCalledOnce();
  }
  if (status === "ready") expect(screen.getByRole("status")).toHaveTextContent("还没有可见版块");
});

it("keeps featured posts separate from board pins and gives image-only rows a destination", () => {
  render(<BoardPage slug="parent" state={{ kind: "ready", board: detail }} topics={[
    { ...boardTopic, id: "featured", title: "全站精华", featured: true, pinned: false },
    { ...boardTopic, id: "pin", title: "版块公告", pinned: true },
    { ...boardTopic, id: "image-only", title: "", excerpt: "" },
  ]} />);
  const pinned = screen.getByRole("feed", { name: "置顶主题列表" });
  expect(within(pinned).getByText("版块公告")).toBeInTheDocument();
  expect(within(pinned).queryByText("全站精华")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "查看图片帖" })).toHaveAttribute("href", "#topic/image-only");
  expect(screen.queryByTitle("32 次浏览")).not.toBeInTheDocument();
  expect(screen.getByText("仅显示本版帖子")).toBeInTheDocument();
});

it("shows read-only capabilities without an executable publish action", () => {
  render(<BoardPage slug="parent" state={{ kind: "ready", board: { ...detail, viewer: { ...detail.viewer, canCreateTopic: false, canReply: false } } }} onCreateTopic={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "发帖" })).not.toBeInTheDocument();
  expect(screen.getByText("当前账号仅可浏览")).toBeInTheDocument();
});
