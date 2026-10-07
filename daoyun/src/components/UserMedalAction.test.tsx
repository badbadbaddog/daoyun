import {cleanup,render,screen,waitFor} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {afterEach,beforeEach,expect,it,vi} from "vitest"
import {AdminApiError,getAdminMedalState,getAdminMedalReceipt,getMembershipMedalRules,grantMembershipMedal,listMembershipMedalOperations,revokeMembershipMedal} from "../api/admin"
import {UserMedalAction} from "./UserMedalAction"
vi.mock('../api/admin',async()=>({...await vi.importActual<typeof import('../api/admin')>('../api/admin'),getAdminMedalState:vi.fn(),getAdminMedalReceipt:vi.fn(),getMembershipMedalRules:vi.fn(),grantMembershipMedal:vi.fn(),listMembershipMedalOperations:vi.fn(),revokeMembershipMedal:vi.fn()}))
const userId='019fc800-0000-7000-8000-000000000002'
const medal={key:'medal_01',displayName:'热心成员',assetUrl:'/assets/membership/medals/medal1.gif',sha256:'a'.repeat(64),grantedAt:'2026-10-01T00:00:00Z'}
const receipt={id:userId,userId,medalKey:medal.key,medalDisplayName:medal.displayName,operation:'grant' as const,reason:'operator.award',actorId:userId,idempotencyKey:'original-key',expectedRevision:0,revision:1,affected:true,ownedAfter:true,auditId:userId,operationRequestId:userId,createdAt:medal.grantedAt,replayed:false}
beforeEach(()=>{vi.mocked(getMembershipMedalRules).mockReset().mockResolvedValue([{...medal,assetKey:'medal_01',revision:1,enabled:false,requiredLifetimePoints:null,updatedAt:medal.grantedAt}]);vi.mocked(listMembershipMedalOperations).mockReset().mockResolvedValue({operations:[],nextCursor:null});vi.mocked(getAdminMedalState).mockReset().mockResolvedValue({userId,revision:0,medals:[]});vi.mocked(getAdminMedalReceipt).mockReset();vi.mocked(grantMembershipMedal).mockReset().mockImplementation(async input=>({medal,created:true,receipt:{...receipt,idempotencyKey:input.idempotencyKey}}));vi.mocked(revokeMembershipMedal).mockReset().mockImplementation(async input=>({userId,medalKey:medal.key,revoked:true,receipt:{...receipt,operation:'revoke',reason:input.reason,ownedAfter:false,expectedRevision:1,revision:2,idempotencyKey:input.idempotencyKey}}))})
afterEach(()=>{cleanup();vi.clearAllMocks()})
const props={userId,medals:[],csrfToken:'csrf',canRead:true,canWrite:true,onChanged:vi.fn(),onBusyChange:vi.fn()}
it('grants an available manual catalog medal with exact UID, revision and receipt',async()=>{
 const changed=vi.fn(),user=userEvent.setup();render(<UserMedalAction {...props} onChanged={changed}/>)
 await waitFor(()=>expect(screen.getByRole('button',{name:'确认发放勋章'})).toBeEnabled());await user.click(screen.getByRole('button',{name:'确认发放勋章'}))
 expect(grantMembershipMedal).toHaveBeenCalledWith(expect.objectContaining({userId,medalKey:medal.key,reason:'operator.award',expectedRevision:0,idempotencyKey:expect.any(String)}),'csrf')
 await screen.findByLabelText('勋章操作回执');await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1))
})
it('keeps unknown parameters locked after a missing receipt and retries only the original command',async()=>{
 vi.mocked(grantMembershipMedal).mockRejectedValueOnce(new Error('offline'));vi.mocked(getAdminMedalReceipt).mockRejectedValueOnce(new AdminApiError(404,'membership.medal_receipt_not_found','未知回执'))
 const busy=vi.fn(),user=userEvent.setup();render(<UserMedalAction {...props} onBusyChange={busy}/>)
 await waitFor(()=>expect(screen.getByRole('button',{name:'确认发放勋章'})).toBeEnabled());await user.click(screen.getByRole('button',{name:'确认发放勋章'}));await screen.findByRole('alert')
 const original=vi.mocked(grantMembershipMedal).mock.calls[0][0]
 expect(screen.getByLabelText('勋章授予理由')).toBeDisabled();expect(busy).toHaveBeenLastCalledWith(true)
 await user.click(screen.getByRole('button',{name:'核验操作回执'}));await waitFor(()=>expect(getAdminMedalReceipt).toHaveBeenCalledWith(userId,original.idempotencyKey))
 expect(screen.getByLabelText('勋章授予理由')).toBeDisabled();expect(screen.queryByText('已核对记录并结束')).not.toBeInTheDocument()
 await user.click(screen.getByRole('button',{name:'使用原请求重试确认'}));await screen.findByLabelText('勋章操作回执')
 expect(vi.mocked(grantMembershipMedal).mock.calls[1][0]).toEqual(original)
})
it('refreshes a conflict baseline while preserving reason and issues a fresh key',async()=>{
 vi.mocked(grantMembershipMedal).mockRejectedValueOnce(new AdminApiError(409,'membership.medal_revision_conflict','状态已变化'))
 const user=userEvent.setup();render(<UserMedalAction {...props}/>);await waitFor(()=>expect(screen.getByRole('button',{name:'确认发放勋章'})).toBeEnabled());await user.clear(screen.getByLabelText('勋章授予理由'));await user.type(screen.getByLabelText('勋章授予理由'),'community.reward');await user.click(screen.getByRole('button',{name:'确认发放勋章'}))
 await screen.findByRole('alert');const original=vi.mocked(grantMembershipMedal).mock.calls[0][0];vi.mocked(getAdminMedalState).mockResolvedValue({userId,revision:3,medals:[]})
 await user.click(screen.getByRole('button',{name:'刷新勋章基线'}));await waitFor(()=>expect(screen.getByRole('button',{name:'确认发放勋章'})).toBeEnabled());expect(screen.getByLabelText('勋章授予理由')).toHaveValue('community.reward')
 await user.click(screen.getByRole('button',{name:'确认发放勋章'}));expect(vi.mocked(grantMembershipMedal).mock.calls[1][0]).toMatchObject({expectedRevision:3,reason:'community.reward'});expect(vi.mocked(grantMembershipMedal).mock.calls[1][0].idempotencyKey).not.toBe(original.idempotencyKey)
})
it('reads current holding state before revocation and gates writes',async()=>{
 vi.mocked(getAdminMedalState).mockResolvedValue({userId,revision:1,medals:[medal]});const user=userEvent.setup();render(<UserMedalAction {...props}/>);await user.click(await screen.findByRole('button',{name:'撤销热心成员'}));await user.type(screen.getByLabelText('勋章撤销原因'),'资格取消');await user.click(screen.getByRole('button',{name:'确认撤销勋章'}));expect(revokeMembershipMedal).toHaveBeenCalledWith(expect.objectContaining({userId,medalKey:medal.key,reason:'资格取消',expectedRevision:1}),'csrf')
})
