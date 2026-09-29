import {cleanup,render,screen} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {afterEach,expect,it,vi} from "vitest"
import {getCommunityAnalytics,type CommunityAnalytics} from "../api/analytics"
import {CommunityAnalyticsPanel} from "./CommunityAnalyticsPanel"
vi.mock("../api/analytics",()=>({getCommunityAnalytics:vi.fn()}))
afterEach(()=>{cleanup();vi.clearAllMocks()})
const report:CommunityAnalytics={started_at:"2026-09-16T00:00:00Z",from:"2026-09-10",through:"2026-09-16",activity_complete:false,content_complete:false,new_users:3,active_users:2,topics:1,replies:0,points_issued:5,points_spent:1,retention_eligible:0,retention_returned:0,days:[],boards:[]}
it("labels insufficient retention and collection ranges without inventing a rate",async()=>{
 vi.mocked(getCommunityAnalytics).mockResolvedValue(report)
 render(<CommunityAnalyticsPanel/>)
 expect(await screen.findByText("数据不足")).toBeInTheDocument()
 expect(screen.getByText(/仅展示已采集活动/)).toBeInTheDocument()
 expect(screen.getByText(/UTC 自然日统计/)).toBeInTheDocument()
 expect(screen.queryByText("0%")).not.toBeInTheDocument()
})
it("aborts old windows and retries failed requests",async()=>{
 const user=userEvent.setup()
 vi.mocked(getCommunityAnalytics).mockRejectedValueOnce(new Error("统计服务暂不可用")).mockResolvedValue(report)
 render(<CommunityAnalyticsPanel/>)
 expect(await screen.findByRole("alert")).toHaveTextContent("统计服务暂不可用")
 await user.click(screen.getByRole("button",{name:"刷新数据"}))
 await screen.findByText("数据不足")
 const firstSignal=vi.mocked(getCommunityAnalytics).mock.calls[1][1]!
 await user.selectOptions(screen.getByLabelText("统计范围"),"90")
 expect(firstSignal.aborted).toBe(true)
 expect(getCommunityAnalytics).toHaveBeenLastCalledWith(90,expect.any(AbortSignal))
})
