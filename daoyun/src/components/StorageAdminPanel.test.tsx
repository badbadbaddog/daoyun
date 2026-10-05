import {cleanup,render,screen} from "@testing-library/react"
import {afterEach,expect,it,vi} from "vitest"
import {StorageAdminPanel} from "./StorageAdminPanel"
afterEach(()=>{cleanup();vi.restoreAllMocks()})
it("shows local writes and retained S3 history without exposing deployment secrets",async()=>{
 vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({data:{write_provider:"local",legacy_provider:"s3",local_configured:true,s3_configured:true,s3_supported:true},meta:{request_id:"019fc900-0000-7000-8000-000000000001"}}),{status:200}))
 render(<StorageAdminPanel />)
 expect(await screen.findByRole("heading",{name:"附件存储"})).toBeInTheDocument()
 expect(screen.getByText("本地目录")).toBeInTheDocument()
 expect(screen.getByText("S3 对象存储")).toBeInTheDocument()
 expect(screen.getByText(/完整备份/)).toBeInTheDocument()
 expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
})
it("does not report malformed configuration as healthy",async()=>{
 vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({data:{write_provider:"local",legacy_provider:"s3",local_configured:"yes",s3_configured:true,s3_supported:true},meta:{request_id:"019fc900-0000-7000-8000-000000000001"}}),{status:200}))
 render(<StorageAdminPanel />)
 expect(await screen.findByRole("alert")).toHaveTextContent("存储配置暂时无法加载")
 expect(screen.queryByText("已配置")).not.toBeInTheDocument()
})
