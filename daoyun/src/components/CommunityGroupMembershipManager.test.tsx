import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { AdminApiError, grantAdminCommunityGroupMembership, listAdminCommunityGroupMemberships, revokeAdminCommunityGroupMembership, type AdminCommunityGroup, type AdminCommunityGroupMembership } from "../api/admin"
import { CommunityGroupMembershipManager } from "./CommunityGroupMembershipManager"
vi.mock("../api/admin", async()=>({ ...await vi.importActual<typeof import("../api/admin")>("../api/admin"), grantAdminCommunityGroupMembership:vi.fn(),listAdminCommunityGroupMemberships:vi.fn(),revokeAdminCommunityGroupMembership:vi.fn() }))
const user={id:'019fc800-0000-7000-8000-000000000002',username:'member',displayName:'成员',avatarUrl:null,status:'active' as const,primaryRole:null,topicCount:0,postCount:0,reportCount:0,createdAt:'2026-10-01T00:00:00Z',lastSeenAt:null}
const group:AdminCommunityGroup={id:'019fc800-0000-7000-8000-000000000003',internalKey:'photographer',displayName:'摄影达人',description:'',displayOrder:1,isBase:false,isDefault:false,status:'active',permissionKeys:[],quotas:{},revision:1,createdAt:user.createdAt,updatedAt:user.createdAt}
const membership:AdminCommunityGroupMembership={id:'019fc800-0000-7000-8000-000000000004',userId:user.id,group:{id:group.id,internalKey:group.internalKey,displayName:group.displayName},membershipKind:'additional',source:'operator',sourceReferenceId:null,reason:'人工授予',startsAt:user.createdAt,endsAt:null,revokedAt:null,revocationReason:null,revision:1}
beforeEach(()=>{vi.mocked(listAdminCommunityGroupMemberships).mockReset().mockResolvedValue([]);vi.mocked(grantAdminCommunityGroupMembership).mockReset().mockResolvedValue({membership,replayed:false});vi.mocked(revokeAdminCommunityGroupMembership).mockReset().mockResolvedValue({membership:{...membership,revokedAt:user.createdAt},replayed:false})})
afterEach(()=>{cleanup();vi.clearAllMocks()})
it('freezes an unknown group grant and retries the exact key and time window before notifying success',async()=>{
  vi.mocked(grantAdminCommunityGroupMembership).mockRejectedValueOnce(new Error('offline'))
  const changed=vi.fn(),busy=vi.fn(),events=userEvent.setup()
  render(<CommunityGroupMembershipManager groups={[group]} user={user} csrfToken="csrf" canWrite onChanged={changed} onBusyChange={busy} />)
  await events.type(await screen.findByRole('textbox',{name:'加入原因'}),'当前用户授予')
  await events.selectOptions(screen.getByRole('combobox',{name:'授予期限'}),'7')
  await events.click(screen.getByRole('button',{name:'确认加入用户组'}))
  await waitFor(()=>expect(busy).toHaveBeenLastCalledWith(true))
  expect(screen.getByRole('textbox',{name:'加入原因'})).toBeDisabled()
  expect(screen.getByRole('button',{name:'刷新成员关系'})).toBeDisabled()
  expect(changed).not.toHaveBeenCalled()
  const first=vi.mocked(grantAdminCommunityGroupMembership).mock.calls[0][0]
  await events.click(screen.getByRole('button',{name:'确认加入用户组'}))
  await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1))
  expect(vi.mocked(grantAdminCommunityGroupMembership).mock.calls[1][0]).toEqual(first)
  expect(busy).toHaveBeenLastCalledWith(false)
})
it('freezes an unknown revocation and retains the original revision, reason and key',async()=>{
  vi.mocked(listAdminCommunityGroupMemberships).mockResolvedValue([membership])
  vi.mocked(revokeAdminCommunityGroupMembership).mockRejectedValueOnce(new Error('offline'))
  const changed=vi.fn(),events=userEvent.setup()
  render(<CommunityGroupMembershipManager groups={[group]} user={user} csrfToken="csrf" canWrite onChanged={changed} />)
  await events.click(await screen.findByRole('button',{name:'移出摄影达人'}))
  await events.type(screen.getByRole('textbox',{name:'移出原因'}),'取消附加身份')
  await events.click(screen.getByRole('button',{name:'确认移出'}))
  expect(await screen.findByRole('textbox',{name:'移出原因'})).toBeDisabled()
  expect(screen.getByRole('button',{name:'取消'})).toBeDisabled()
  const first=vi.mocked(revokeAdminCommunityGroupMembership).mock.calls[0]
  await events.click(screen.getByRole('button',{name:'确认移出'}))
  await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1))
  expect(vi.mocked(revokeAdminCommunityGroupMembership).mock.calls[1]).toEqual(first)
})
it('blocks stale revision resubmission until conflict refresh and preserves the reason',async()=>{
  vi.mocked(listAdminCommunityGroupMemberships).mockResolvedValueOnce([membership]).mockResolvedValue([{...membership,revision:9}])
  vi.mocked(revokeAdminCommunityGroupMembership).mockRejectedValueOnce(new AdminApiError(409,'conflict','版本冲突'))
  const events=userEvent.setup();render(<CommunityGroupMembershipManager groups={[group]} user={user} csrfToken="csrf" canWrite />)
  await events.click(await screen.findByRole('button',{name:'移出摄影达人'}));await events.type(screen.getByRole('textbox',{name:'移出原因'}),'保留处理原因');await events.click(screen.getByRole('button',{name:'确认移出'}))
  expect(await screen.findByRole('button',{name:'确认移出'})).toBeDisabled()
  await events.click(screen.getByRole('button',{name:'刷新最新数据'}))
  await waitFor(()=>expect(screen.getByRole('button',{name:'确认移出'})).toBeEnabled())
  expect(screen.getByRole('textbox',{name:'移出原因'})).toHaveValue('保留处理原因')
  await events.click(screen.getByRole('button',{name:'确认移出'}))
  expect(vi.mocked(revokeAdminCommunityGroupMembership).mock.calls[1][1]).toBe(9)
})
