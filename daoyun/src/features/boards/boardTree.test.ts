import { describe, expect, it } from "vitest";
import type { BoardSummary } from "../../api/boards";
import { buildBoardTree } from "./boardTree";

function board(
  id: string,
  slug: string,
  parentId: string | null,
  position: number,
): BoardSummary {
  return {
    id,
    slug,
    name: slug,
    description: "",
    icon: "messages",
    tone: "green",
    parentId,
    position,
    depth: parentId ? 1 : 0,
    childCount: 0,
    topicCount: 0,
  };
}

describe("buildBoardTree", () => {
  it("builds a stable hierarchy and keeps an orphan visible at the root", () => {
    const result = buildBoardTree([
      board("child", "child", "parent", 20),
      board("orphan", "orphan", "missing", 5),
      board("parent", "parent", null, 10),
    ]);

    expect(result.map((node) => node.board.slug)).toEqual(["orphan", "parent"]);
    expect(result[1].children.map((node) => node.board.slug)).toEqual(["child"]);
  });
});
