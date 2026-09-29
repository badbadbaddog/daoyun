import { cleanup,render,screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach,expect,it,vi } from "vitest"
import { RedemptionWorkspace } from "./RedemptionWorkspace"
import { listRedemptionProducts } from "../../api/redemptions"
vi.mock("../../api/redemptions",()=>({listRedemptionProducts:vi.fn(),putRedemptionProduct:vi.fn()}))
vi.mock("../../api/admin",()=>({listStandardEntitlementTypes:vi.fn().mockResolvedValue([])}))
it("keeps product writes unavailable when the provider is disabled",async()=>{
 vi.mocked(listRedemptionProducts).mockResolvedValue({enabled:false,products:[],next_cursor:null})
 render(<RedemptionWorkspace csrfToken="csrf" canWrite canReadTypes/>)
 expect(await screen.findByText("请先在插件管理安装并启用积分兑换。")).toBeInTheDocument()
 expect(screen.getByRole("button",{name:"新增商品"})).toBeDisabled()
})
it("does not expose product mutation controls to a read-only administrator",async()=>{
 vi.mocked(listRedemptionProducts).mockResolvedValue({enabled:true,products:[],next_cursor:null})
 render(<RedemptionWorkspace csrfToken="csrf" canWrite={false} canReadTypes={false}/>)
 await screen.findByText("暂无兑换商品")
 expect(screen.queryByRole("button",{name:"新增商品"})).not.toBeInTheDocument()
 await userEvent.click(screen.getByRole("button",{name:"刷新商品"}))
})

afterEach(cleanup)

it("explains the missing entitlement prerequisite",async()=>{vi.mocked(listRedemptionProducts).mockResolvedValue({enabled:true,products:[],next_cursor:null});render(<RedemptionWorkspace csrfToken="csrf" canWrite canReadTypes/>);expect(await screen.findByText("暂无可用权益类型，请先在标准权益中创建并发布权益。")).toBeInTheDocument();expect(screen.getByRole("button",{name:"新增商品"})).toBeDisabled()})
