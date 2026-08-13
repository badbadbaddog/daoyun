import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { UserAvatar } from "./UserAvatar"

describe("UserAvatar", () => {
  it("uses the username initial when no avatar URL exists", () => {
    render(<UserAvatar username="member" displayName="社区成员" avatarUrl={null} />)
    expect(screen.getByText("M")).toBeInTheDocument()
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
  })

  it("falls back after the configured image fails", () => {
    render(
      <UserAvatar
        username="linyu"
        displayName="林屿"
        avatarUrl="https://example.com/avatar.png"
      />,
    )
    fireEvent.error(screen.getByRole("img"))
    expect(screen.getByText("L")).toBeInTheDocument()
  })
})
