
import AxeBuilder from "@axe-core/playwright"
import {expect,test,type Page} from "@playwright/test"
import type {DraftContent,MemberDraft} from "../src/api/drafts"
import type {RichTextDocument} from "../src/editor/richContent"
import {assertNoHorizontalOverflow,mockPublicApi,publicTopicFixture,requestId,topicId,userId} from "./fixtures"

const csrf = "a".repeat(64)
const files = (count:number) => Array.from({length:count},(_,index)=>({name:"image-"+(index+1)+".png",mimeType:"image/png",buffer:Buffer.from("image-"+index)}))
const envelope = (data:unknown) => ({data,meta:{request_id:requestId}})
interface PostInput {content:string;rich_content:RichTextDocument;draft?:{id:string;revision:number}}
interface PublisherState {attempts:string[];drafts:Map<string,MemberDraft>;published:PostInput[]}

async function mockPublisher(page:Page,failFirst=false):Promise<PublisherState> {
  const state:PublisherState={attempts:[],drafts:new Map(),published:[]}
  let publishedDetail:Record<string,unknown>|undefined
  await mockPublicApi(page)
  await page.route("**/api/v1/**",async route=>{
    const request=route.request(),path=new URL(request.url()).pathname,method=request.method()
    if(path==="/api/v1/auth/session")return route.fulfill({json:envelope({user:{id:userId,username:"quality_author",email:"author@test.invalid",display_name:"质量作者"},csrf_token:csrf})})
    if(path==="/api/v1/polls/policy")return route.fulfill({json:envelope({enabled:false,can_create:false})})
    if(path==="/api/v1/attachments/drafts"&&method==="POST") {
      expect(request.headers()["x-csrf-token"]).toBe(csrf)
      const name=decodeURIComponent(request.headers()["x-file-name"])
      state.attempts.push(name)
      if(failFirst&&state.attempts.length===1)return route.fulfill({status:503,json:{error:{code:"unavailable",message:"模拟上传失败"},meta:{request_id:requestId}}})
      const index=Number(name.match(/image-(\d+)/)?.[1]??1)
      return route.fulfill({status:201,json:envelope({id:"019fc700-0000-7000-8000-"+String(700+index).padStart(12,"0"),original_name:name,mime_type:"image/png",size_bytes:7,expires_at:"2099-01-01T00:00:00Z"})})
    }
    if(path.startsWith("/api/v1/attachments/")&&method==="GET")return route.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#dbeafe"/></svg>'})
    if(path.startsWith("/api/v1/users/me/drafts/")) {
      const id=path.split("/").at(-1)!
      if(method==="PUT") {
        expect(request.headers()["x-csrf-token"]).toBe(csrf)
        const input=request.postDataJSON() as {expected_revision:number;content:DraftContent}
        expect(input.content.images.length).toBeLessThanOrEqual(9)
        expect(input.content.images.every(image=>image.attachmentId.length>0)).toBe(true)
        const row={id,revision:input.expected_revision+1,content:input.content,updated_at:new Date().toISOString()}
        state.drafts.set(id,row)
        return route.fulfill({json:envelope(row)})
      }
      if(method==="GET")return route.fulfill({json:envelope(state.drafts.get(id))})
    }
    if(path==="/api/v1/users/me/drafts")return route.fulfill({json:envelope({drafts:[...state.drafts.values()],next_cursor:null})})
    if(path==="/api/v1/topics"&&method==="POST") {
      expect(request.headers()["x-csrf-token"]).toBe(csrf)
      expect(request.headers()["idempotency-key"]).toBeTruthy()
      const input=request.postDataJSON() as PostInput
      state.published.push(input)
      const urls=input.rich_content.content.filter(node=>node.type==="image").map(node=>"/api/v1/attachments/"+node.attrs?.attachmentId+"/thumbnail")
      publishedDetail={...publicTopicFixture,image_url:urls[0]??null,image_urls:urls.slice(0,3),visible_image_count:urls.length,media_urls:urls,content:input.content,rich_content:input.rich_content,has_locked_content:false,content_revision:1}
      return route.fulfill({status:201,json:envelope(publishedDetail)})
    }
    if(path==="/api/v1/topics/"+topicId&&method==="GET"&&publishedDetail)return route.fulfill({json:envelope(publishedDetail)})
    return route.fallback()
  })
  return state
}

async function openPublisher(page:Page) {
  await page.getByRole("button",{name:/发布新主题/}).first().click()
  return page.getByRole("dialog",{name:"发布内容"})
}

for(const width of [320,390,768,1024,1440]) {
  test("publisher retry, button sorting and reload at "+width+"px",async({page},testInfo)=>{
    const errors:string[]=[]
    page.on("pageerror",error=>errors.push(error.message))
    await page.setViewportSize({width,height:900})
    const state=await mockPublisher(page,true)
    await page.goto("/")
    let composer=await openPublisher(page)
    await composer.getByRole("textbox",{name:"正文"}).fill("失败与重排后正文仍保留")
    await composer.getByLabel("选择帖子图片").setInputFiles(files(3))
    await expect(composer.getByRole("img",{name:"image-3.png"})).toBeVisible()
    await expect(composer.getByRole("button",{name:"发布",exact:true})).toBeDisabled()
    await expect(composer.getByRole("alert")).toHaveText("模拟上传失败")
    await page.screenshot({path:testInfo.outputPath("failed-upload.png")})
    await composer.getByRole("button",{name:"重试图片 1"}).click()
    await expect(composer.getByText("已上传 3 / 9 张",{exact:true})).toBeVisible()
    expect(state.attempts).toEqual(["image-1.png","image-2.png","image-3.png","image-1.png"])
    const move=composer.getByRole("button",{name:"前移图片 3"})
    await move.click()
    await expect(composer.getByRole("button",{name:"前移图片 2"})).toBeFocused()
    await page.keyboard.press("ArrowRight")
    await expect(composer.getByRole("button",{name:"前移图片 3"})).toBeFocused()
    await page.keyboard.press("ArrowLeft")
    await expect(composer.getByRole("button",{name:"前移图片 2"})).toBeFocused()
    expect(await composer.locator(".composer-image-item img").evaluateAll(images=>images.map(image=>image.getAttribute("alt")))).toEqual(["image-1.png","image-3.png","image-2.png"])
    for(const button of await composer.locator(".composer-image-item__actions button").all()) {
      const bounds=await button.boundingBox()
      expect(bounds!.width).toBeGreaterThanOrEqual(44)
      expect(bounds!.height).toBeGreaterThanOrEqual(44)
    }
    await expect.poll(()=>[...state.drafts.values()].at(-1)?.content.images.map(image=>image.fileName)).toEqual(["image-1.png","image-3.png","image-2.png"])
    expect((await new AxeBuilder({page}).include(".composer-dialog").analyze()).violations).toEqual([])
    await assertNoHorizontalOverflow(page)
    await page.screenshot({path:testInfo.outputPath("sorted-composer.png")})
    await composer.getByRole("button",{name:"关闭发布窗口"}).click()
    await page.getByRole("button",{name:"确认关闭"}).click()
    await expect(composer).toHaveCount(0)
    await page.reload()
    composer=await openPublisher(page)
    await expect(composer.getByRole("textbox",{name:"正文"})).toHaveText("失败与重排后正文仍保留")
    expect(await composer.locator(".composer-image-item img").evaluateAll(images=>images.map(image=>image.getAttribute("alt")))).toEqual(["image-1.png","image-3.png","image-2.png"])
    await composer.getByRole("button",{name:"发布",exact:true}).click()
    await expect(composer).toHaveCount(0)
    expect(state.published).toHaveLength(1)
    expect(state.published[0].rich_content.content.slice(1).map(image=>image.attrs?.attachmentId)).toEqual([701,703,702].map(index=>"019fc700-0000-7000-8000-"+String(index).padStart(12,"0")))
    expect(state.published[0].draft).toBeTruthy()
    await expect(page).toHaveURL(new RegExp("#topic/"+topicId+"$"))
    expect(errors).toEqual([])
  })
}

test("publisher reserves all nine image slots and rejects the tenth",async({page},testInfo)=>{
  const state=await mockPublisher(page)
  await page.goto("/")
  const composer=await openPublisher(page)
  await composer.getByLabel("选择帖子图片").setInputFiles(files(10))
  await expect(composer.getByText("已上传 9 / 9 张",{exact:true})).toBeVisible()
  await expect(composer.getByRole("alert")).toHaveText("最多上传 9 张图片")
  expect(state.attempts).toHaveLength(9)
  await expect(composer.getByRole("button",{name:"上传图片",exact:true})).toHaveCount(0)
  await assertNoHorizontalOverflow(page)
  await page.screenshot({path:testInfo.outputPath("nine-image-composer.png")})
})

test("failed image draft requires explicit reselection after reload",async({page})=>{
  const state=await mockPublisher(page,true)
  await page.goto("/")
  let composer=await openPublisher(page)
  await composer.getByRole("textbox",{name:"正文"}).fill("失败文件恢复")
  await composer.getByLabel("选择帖子图片").setInputFiles(files(1))
  await expect(composer.getByRole("button",{name:"重试图片 1"})).toBeVisible()
  await composer.getByRole("button",{name:"关闭发布窗口"}).click()
  await page.getByRole("button",{name:"确认关闭"}).click()
  await expect(composer).toHaveCount(0)
  await page.reload()
  composer=await openPublisher(page)
  await expect(composer.getByRole("button",{name:"发布",exact:true})).toBeDisabled()
  await composer.getByRole("button",{name:"重新选择图片 1"}).click()
  await composer.getByLabel("重新选择失败图片").setInputFiles(files(1))
  await expect(composer.getByText("已上传 1 / 9 张",{exact:true})).toBeVisible()
  expect(state.attempts).toEqual(["image-1.png","image-1.png"])
  await composer.getByRole("button",{name:"删除图片 1"}).click()
  await expect(composer.getByRole("button",{name:"发布",exact:true})).toBeEnabled()
})

test("canceling an upload retains each file for retry",async({page})=>{
  const state=await mockPublisher(page)
  let release:(()=>void)|undefined
  const held=new Promise<void>(resolve=>{release=resolve})
  let first=true
  await page.route("**/api/v1/attachments/drafts",async route=>{
    if(first) {
      first=false
      await held
      await route.abort().catch(()=>undefined)
    } else await route.fallback()
  })
  try {
    await page.goto("/")
    const composer=await openPublisher(page)
    await composer.getByLabel("选择帖子图片").setInputFiles(files(2))
    const cancel=composer.getByRole("button",{name:"取消上传"})
    await expect(cancel).toBeVisible()
    const bounds=await cancel.boundingBox()
    expect(bounds!.height).toBeGreaterThanOrEqual(44)
    await cancel.click()
    release?.()
    await expect(composer.getByRole("button",{name:"重试图片 1"})).toBeEnabled()
    await expect(composer.getByRole("button",{name:"重试图片 2"})).toBeEnabled()
    await composer.getByRole("button",{name:"重试图片 1"}).click()
    await expect(composer.getByText("已上传 1 / 9 张",{exact:true})).toBeVisible()
    await composer.getByRole("button",{name:"重试图片 2"}).click()
    await expect(composer.getByText("已上传 2 / 9 张",{exact:true})).toBeVisible()
    expect(state.attempts).toEqual(["image-1.png","image-2.png"])
  } finally {release?.()}
})
