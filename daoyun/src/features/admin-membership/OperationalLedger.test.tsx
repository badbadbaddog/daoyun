import {cleanup,render,screen,waitFor} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {afterEach,beforeEach,expect,it,vi} from "vitest"
import {listAdminPointsLedger,listAdminExperienceLedger} from "../../api/admin"
import {OperationalLedger} from "./OperationalLedger"
vi.mock('../../api/admin',async()=>({...await vi.importActual<typeof import('../../api/admin')>('../../api/admin'),listAdminPointsLedger:vi.fn(),listAdminExperienceLedger:vi.fn()}))
const entry={id:'a',amount:10,reason:'operations.reward',balanceAfter:10,actorId:null,actorUsername:null,actorDisplayName:null,operationRequestId:null,createdAt:'2026-10-06T00:00:00Z'}
beforeEach(()=>{vi.mocked(listAdminPointsLedger).mockReset().mockResolvedValue({entries:[entry],nextCursor:null});vi.mocked(listAdminExperienceLedger).mockReset().mockResolvedValue({entries:[],nextCursor:null})});afterEach(cleanup)
it('loads real points pages and preserves missing historical actor metadata',async()=>{
 vi.mocked(listAdminPointsLedger).mockResolvedValueOnce({entries:[entry],nextCursor:'a'}).mockResolvedValueOnce({entries:[{...entry,id:'b',amount:-5,balanceAfter:5}],nextCursor:null});const user=userEvent.setup();render(<OperationalLedger kind="points" userId="uid" canRead/>);await screen.findAllByText('历史记录未提供');await user.click(screen.getByRole('button',{name:'加载更早积分流水'}));await waitFor(()=>expect(listAdminPointsLedger).toHaveBeenLastCalledWith('uid',expect.objectContaining({cursor:'a',limit:20})));expect(screen.getByLabelText('积分流水')).toHaveTextContent('-5')
})
it('does not fabricate zero rows or request forbidden domains',async()=>{render(<OperationalLedger kind="experience" userId="uid" canRead={false}/>);expect(listAdminExperienceLedger).not.toHaveBeenCalled();expect(screen.queryByLabelText('EXP 流水')).not.toBeInTheDocument()})
it('discards a prior UID response after switching users',async()=>{
 let resolve!:(page:{entries:typeof entry[];nextCursor:null})=>void;vi.mocked(listAdminPointsLedger).mockImplementationOnce(()=>new Promise(r=>{resolve=r}));const view=render(<OperationalLedger kind="points" userId="old" canRead/>);view.rerender(<OperationalLedger kind="points" userId="new" canRead/>);await screen.findByText('operations.reward');resolve({entries:[{...entry,id:'old',reason:'old user row'}],nextCursor:null});await waitFor(()=>expect(screen.queryByText('old user row')).not.toBeInTheDocument())
})
