import { cleanup,render,screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach,afterEach,expect,it,vi } from "vitest"
import { RedemptionPanel } from "./RedemptionPanel"
import { listRedemptionProducts,listRedemptions,redeemPoints } from "../../api/redemptions"
vi.mock("../../api/redemptions",()=>({listRedemptionProducts:vi.fn(),listRedemptions:vi.fn(),redeemPoints:vi.fn()}))
const product={id:"019fc800-0000-7000-8000-000000000001",name:"七日权益",entitlement_type_id:"019fc800-0000-7000-8000-000000000002",type_version:1,price:60,duration_days:7,per_user_limit:1,enabled:true,revision:1,permission_keys:[],quotas:{},unavailable_reason:null}
beforeEach(()=>{
 vi.clearAllMocks()
 vi.mocked(listRedemptionProducts).mockResolvedValue({enabled:true,products:[product],next_cursor:null})
 vi.mocked(listRedemptions).mockResolvedValue({records:[],next_cursor:null})
})
it("prevents redemption when the displayed balance is insufficient",async()=>{
 render(<RedemptionPanel balance={10} csrfToken="csrf" onChanged={()=>{}}/>)
 expect(await screen.findByRole("button",{name:"积分不足"})).toBeDisabled()
 expect(redeemPoints).not.toHaveBeenCalled()
})
it("shows the deduction preview and reuses the attempt key after a network error",async()=>{
 const user=userEvent.setup()
 vi.mocked(redeemPoints).mockRejectedValue(new Error("网络失败"))
 render(<RedemptionPanel balance={100} csrfToken="csrf" onChanged={()=>{}}/>)
 await user.click(await screen.findByRole("button",{name:"兑换 七日权益"}))
 expect(screen.getByText("兑换后余额：40")).toBeInTheDocument()
 await user.click(screen.getByRole("button",{name:"确认兑换"}))
 expect(await screen.findByRole("alert")).toHaveTextContent("网络失败")
 await user.click(screen.getByRole("button",{name:"确认兑换"}))
 expect(redeemPoints).toHaveBeenCalledTimes(2)
 expect(vi.mocked(redeemPoints).mock.calls[0]).toEqual(vi.mocked(redeemPoints).mock.calls[1])
})

afterEach(cleanup)
