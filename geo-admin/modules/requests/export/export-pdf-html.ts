import type { Root } from "react-dom/client"
import type { RequestRecord } from "../lib/types"
import { RequestExportView } from "./request-export-view"

export type PdfExportResult = { ok: true } | { ok: false; error: string }

const PDF_MARGIN_SIDE_PT = 40
const PDF_MARGIN_TOP_PT = 28
const PDF_MARGIN_BOTTOM_PT = 40
/** 正文与页脚之间的预留高度（pt） */
const PDF_FOOTER_PT = 32
const CAPTURE_WIDTH_PX = 794
const CAPTURE_SCALE = 2
/** 页面截图 JPEG 质量（0.94 在体积与文字清晰度之间较均衡） */
const JPEG_QUALITY = 0.94
/** 页脚文字距左右边缘的内边距（与正文 capture 同坐标系） */
const PDF_FOOTER_PAD_X = 28
/** 字段块之间的垂直间距（与 export.css 一致） */
const _FIELD_GAP_PX = 16
/** 板块标题区下方的间距 */
const SECTION_HEAD_GAP_PX = 20

type PdfBlockKind = "header" | "section-head" | "field" | "field-continue" | "field-label" | "card"

interface PdfBlock {
  kind: PdfBlockKind
  height: number
  source: HTMLElement
  sectionKey: string | null
  sectionTitle: string
  sectionDesc?: string
  fieldLabel?: string
  forcePageBefore?: boolean
  /** 文本字段拆分时，仅 value 区域的 HTML 片段 */
  valueHtml?: string
}

async function preloadLogo(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve()
    img.onerror = () => reject(new Error("Logo 加载失败"))
    img.src = "/brand-qinglan.svg"
  })
}

let exportCssCache: string | null = null

async function loadExportCss(): Promise<string> {
  if (exportCssCache) return exportCssCache
  const res = await fetch("/request-export.css")
  if (!res.ok) throw new Error("导出样式加载失败")
  exportCssCache = await res.text()
  return exportCssCache
}

/** html2canvas 不支持 oklch/lab；用 canvas.fillStyle 转成 hex/rgb */
const COLOR_PROPS = [
  "color",
  "background-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "text-decoration-color",
  "fill",
  "stroke",
] as const

let colorNormalizeCanvas: HTMLCanvasElement | null = null

function normalizeColorForCanvas(value: string): string {
  if (!value || value === "transparent" || value === "none") return value
  if (!/oklch|oklab|lab\(|lch\(|color-mix/i.test(value)) return value
  if (!colorNormalizeCanvas) colorNormalizeCanvas = document.createElement("canvas")
  const ctx = colorNormalizeCanvas.getContext("2d")
  if (!ctx) return "#0f172a"
  try {
    ctx.fillStyle = "#000000"
    ctx.fillStyle = value
    return ctx.fillStyle
  } catch {
    return "#0f172a"
  }
}

function needsColorNormalize(value: string): boolean {
  return /oklch|oklab|lab\(|lch\(|color-mix|color\(/i.test(value)
}

/** 克隆文档内剥离 Tailwind，并把 oklch 计算值改成 html2canvas 可识别的颜色 */
function prepareCloneForCapture(clonedDoc: Document, clonedRoot: HTMLElement, cssText: string) {
  clonedDoc.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => node.remove())

  const style = clonedDoc.createElement("style")
  style.textContent = cssText
  clonedDoc.head.appendChild(style)

  const html = clonedDoc.documentElement
  const body = clonedDoc.body
  html.removeAttribute("class")
  body.removeAttribute("class")
  html.style.cssText = "background:#ffffff;color:#0f172a;"
  body.style.cssText = "margin:0;padding:0;background:#ffffff;color:#0f172a;"

  const view = clonedDoc.defaultView
  if (!view) return

  const nodes: Element[] = [html, body, clonedRoot, ...Array.from(clonedRoot.querySelectorAll("*"))]
  for (const node of nodes) {
    if (!(node instanceof HTMLElement || node instanceof SVGElement)) continue
    const computed = view.getComputedStyle(node)
    for (const prop of COLOR_PROPS) {
      const raw = computed.getPropertyValue(prop)
      if (!raw || !needsColorNormalize(raw)) continue
      node.style.setProperty(prop, normalizeColorForCanvas(raw))
    }
    const bg = computed.backgroundColor
    if (needsColorNormalize(bg)) {
      node.style.backgroundColor = normalizeColorForCanvas(bg)
    }
  }

  void clonedRoot.offsetHeight
}

async function captureElement(el: HTMLElement, cssText: string): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import("html2canvas")

  const isMainAppDocument = el.ownerDocument === document
  let captureTarget = el
  let tempIframe: HTMLIFrameElement | null = null

  if (isMainAppDocument) {
    const mounted = await mountRootCloneInIframe(el, cssText)
    captureTarget = mounted.clonedRoot
    tempIframe = mounted.iframe
  }

  try {
    return await html2canvas(captureTarget, {
      scale: CAPTURE_SCALE,
      width: CAPTURE_WIDTH_PX,
      useCORS: true,
      allowTaint: false,
      backgroundColor: "#ffffff",
      logging: false,
      onclone: (clonedDoc, clonedRoot) => {
        if (clonedRoot instanceof HTMLElement) {
          prepareCloneForCapture(clonedDoc, clonedRoot, cssText)
        }
      },
    })
  } finally {
    tempIframe?.remove()
  }
}

/** 将已渲染节点复制到空白 iframe，彻底隔离 Tailwind oklch */
async function mountRootCloneInIframe(root: HTMLElement, cssText: string): Promise<{
  iframe: HTMLIFrameElement
  clonedRoot: HTMLElement
}> {
  const iframe = document.createElement("iframe")
  iframe.setAttribute("aria-hidden", "true")
  iframe.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    `width:${CAPTURE_WIDTH_PX}px`,
    "height:0",
    "border:0",
    "opacity:0",
    "pointer-events:none",
    "z-index:-1",
  ].join(";")
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument
  if (!doc) {
    iframe.remove()
    throw new Error("无法创建导出画布")
  }

  doc.open()
  doc.write('<!DOCTYPE html><html><head></head><body style="margin:0;background:#fff;color:#0f172a"></body></html>')
  doc.close()

  const styleEl = doc.createElement("style")
  styleEl.textContent = cssText
  doc.head.appendChild(styleEl)

  const host = doc.createElement("div")
  host.innerHTML = root.outerHTML
  doc.body.appendChild(host)

  const clonedRoot = host.querySelector("#request-export-root")
  if (!(clonedRoot instanceof HTMLElement)) {
    iframe.remove()
    throw new Error("模板复制失败")
  }

  const images = Array.from(clonedRoot.querySelectorAll("img"))
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) resolve()
          else {
            img.onload = () => resolve()
            img.onerror = () => resolve()
          }
        }),
    ),
  )
  await new Promise((r) => setTimeout(r, 50))

  return { iframe, clonedRoot }
}

function measureValueHeight(doc: Document, valueClass: string, html: string): number {
  let host = doc.getElementById("pdf-measure-host")
  if (!host) {
    host = doc.createElement("div")
    host.id = "pdf-measure-host"
    host.style.cssText = `position:absolute;left:0;top:0;width:${CAPTURE_WIDTH_PX}px;visibility:hidden;pointer-events:none;`
    doc.body.appendChild(host)
  }

  host.innerHTML = `<div id="request-export-root"><section class="rex-section"><div class="rex-fields"><div class="rex-pdf-field"><div class="${valueClass}">${html}</div></div></div></section></div>`
  const value = host.querySelector<HTMLElement>(".rex-field-value, .rex-pdf-field > div:last-child")
  return value?.offsetHeight ?? 0
}

function isSplittableFieldValue(value: HTMLElement): boolean {
  return !value.querySelector("table, .rex-subcard, .rex-product-card, svg, img, .rex-top-badge-svg")
}

/** 按高度拆分纯文本字段 value，返回 HTML 片段列表 */
function splitValueHtmlByHeight(
  value: HTMLElement,
  maxHeight: number,
  doc: Document,
  _cssText: string,
): string[] {
  const plain = value.innerText.trim()
  if (!plain || maxHeight < 40) return [value.innerHTML]

  const valueClass = value.className
  if (measureValueHeight(doc, valueClass, value.innerHTML) <= maxHeight) {
    return [value.innerHTML]
  }

  const parts: string[] = []
  let rest = plain

  while (rest.length > 0) {
    let lo = 1
    let hi = rest.length
    let best = 1

    while (lo <= hi) {
      const mid = Math.ceil((lo + hi) / 2)
      const escaped = rest
        .slice(0, mid)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
      const h = measureValueHeight(doc, valueClass, escaped)
      if (h <= maxHeight) {
        best = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }

    if (best < 1) best = 1
    const chunk = rest
      .slice(0, best)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
    parts.push(chunk)
    rest = rest.slice(best).trimStart()
  }

  return parts.length ? parts : [value.innerHTML]
}

function collectBlocks(root: HTMLElement): PdfBlock[] {
  const blocks: PdfBlock[] = []

  const header = root.querySelector<HTMLElement>(".rex-header")
  if (header) {
    blocks.push({
      kind: "header",
      source: header,
      height: header.offsetHeight,
      sectionKey: null,
      sectionTitle: "",
    })
  }

  root.querySelectorAll<HTMLElement>(".rex-section").forEach((section, idx) => {
    const sectionKey = `section-${idx}`
    const title = section.querySelector(".rex-section-title")?.textContent?.trim() ?? ""
    const desc = section.querySelector(".rex-section-desc")?.textContent?.trim() ?? ""
    const forcePageBefore = section.hasAttribute("data-pdf-break")

    const head = section.querySelector<HTMLElement>(".rex-section-head")
    if (head) {
      blocks.push({
        kind: "section-head",
        source: head,
        height: head.offsetHeight + SECTION_HEAD_GAP_PX,
        sectionKey,
        sectionTitle: title,
        sectionDesc: desc,
        forcePageBefore,
      })
    }

    section.querySelectorAll<HTMLElement>(".rex-pdf-field").forEach((field) => {
      const cards = field.querySelectorAll<HTMLElement>(".rex-product-card, .rex-subcard")
      const fieldLabel = field.querySelector(".rex-field-label")?.textContent?.trim() ?? ""

      if (cards.length > 0) {
        const label = field.querySelector<HTMLElement>(".rex-field-label")
        if (label) {
          blocks.push({
            kind: "field-label",
            source: label,
            height: label.offsetHeight + 8,
            sectionKey,
            sectionTitle: title,
            fieldLabel,
          })
        }
        cards.forEach((card, cardIdx) => {
          const gap = cardIdx === 0 ? 0 : card.classList.contains("rex-subcard") ? 8 : 12
          blocks.push({
            kind: "card",
            source: card,
            height: card.offsetHeight + gap,
            sectionKey,
            sectionTitle: title,
            fieldLabel,
          })
        })
      } else {
        blocks.push({
          kind: "field",
          source: field,
          height: field.offsetHeight,
          sectionKey,
          sectionTitle: title,
          fieldLabel,
        })
      }
    })
  })

  return blocks
}

function expandOversizedFields(
  blocks: PdfBlock[],
  pageBodyH: number,
  doc: Document,
  cssText: string,
): PdfBlock[] {
  const maxValueH = pageBodyH * 0.78
  const expanded: PdfBlock[] = []

  for (const block of blocks) {
    if (block.kind !== "field" || block.height <= pageBodyH * 0.95) {
      expanded.push(block)
      continue
    }

    const field = block.source
    const label = field.querySelector<HTMLElement>(".rex-field-label")
    const value = field.querySelector<HTMLElement>(".rex-field-value")
    if (!label || !value || !isSplittableFieldValue(value)) {
      expanded.push(block)
      continue
    }

    const labelH = label.offsetHeight + 8
    const parts = splitValueHtmlByHeight(value, maxValueH - labelH, doc, cssText)
    if (parts.length <= 1) {
      expanded.push(block)
      continue
    }

    parts.forEach((html, i) => {
      const valueH = measureValueHeight(doc, value.className, html)
      if (i === 0) {
        expanded.push({
          ...block,
          height: labelH + valueH,
          valueHtml: html,
        })
      } else {
        expanded.push({
          kind: "field-continue",
          source: field,
          height: (label.offsetHeight + 8) + valueH,
          sectionKey: block.sectionKey,
          sectionTitle: block.sectionTitle,
          fieldLabel: block.fieldLabel,
          valueHtml: html,
        })
      }
    })
  }

  return expanded
}

function measurePageBlocksHeight(pageBlocks: PdfBlock[], doc: Document): number {
  if (!pageBlocks.length) return 0
  const root = buildPageRoot(doc, pageBlocks)
  root.style.cssText = "position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;"
  doc.body.appendChild(root)
  const h = root.offsetHeight
  root.remove()
  return h
}

/** 流式排版：以 DOM 实测高度分配页，避免单页内容溢出 */
function layoutBlocksToPages(blocks: PdfBlock[], pageBodyH: number, doc: Document): PdfBlock[][] {
  const pages: PdfBlock[][] = []
  let current: PdfBlock[] = []

  const flush = () => {
    if (current.length) pages.push(current)
    current = []
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]

    // breakBefore：仅当当前页剩余空间放不下板块标题时才换页（避免上一页留白、下一页才开头）
    if (block.forcePageBefore && current.length > 0) {
      const trial = [...current, block]
      if (measurePageBlocksHeight(trial, doc) > pageBodyH) flush()
    }

    // 孤行控制：field-label 应与紧随其后的 card 同页
    if (block.kind === "field-label" && blocks[i + 1]?.kind === "card" && current.length > 0) {
      const withLabel = measurePageBlocksHeight([...current, block], doc)
      const withCard = measurePageBlocksHeight([...current, block, blocks[i + 1]], doc)
      if (withLabel <= pageBodyH && withCard > pageBodyH) flush()
    }

    if (current.length > 0) {
      const trial = [...current, block]
      if (measurePageBlocksHeight(trial, doc) > pageBodyH) flush()
    }

    // 单块超页：独占一页
    if (current.length === 0 && measurePageBlocksHeight([block], doc) > pageBodyH) {
      current.push(block)
      flush()
      continue
    }

    current.push(block)
  }

  flush()
  return pages
}

function appendSectionContinue(doc: Document, section: HTMLElement, title: string) {
  const bar = doc.createElement("div")
  bar.className = "rex-section-continue"
  bar.textContent = `${title}（续）`
  section.appendChild(bar)
}

function mountFieldBlock(doc: Document, block: PdfBlock, fieldsHost: HTMLElement) {
  const wrap = doc.createElement("div")
  wrap.className = block.kind === "card" ? "rex-pdf-field rex-pdf-field--card-only" : "rex-pdf-field"

  if (block.kind === "field" && block.valueHtml !== undefined) {
    const label = doc.createElement("p")
    label.className = "rex-field-label"
    label.textContent = block.fieldLabel ?? block.source.querySelector(".rex-field-label")?.textContent ?? ""
    const value = doc.createElement("div")
    value.className = "rex-field-value"
    value.innerHTML = block.valueHtml
    wrap.appendChild(label)
    wrap.appendChild(value)
  } else if (block.kind === "field-continue" && block.valueHtml !== undefined) {
    const label = doc.createElement("p")
    label.className = "rex-field-label rex-field-label--continue"
    label.textContent = `${block.fieldLabel ?? ""}（续）`
    const value = doc.createElement("div")
    value.className = "rex-field-value"
    value.innerHTML = block.valueHtml
    wrap.appendChild(label)
    wrap.appendChild(value)
  } else if (block.kind === "field") {
    wrap.appendChild(block.source.cloneNode(true))
  } else if (block.kind === "field-label") {
    const label = doc.createElement("p")
    label.className = "rex-field-label"
    label.textContent = block.fieldLabel ?? block.source.textContent ?? ""
    wrap.appendChild(label)
  } else if (block.kind === "card") {
    const value = doc.createElement("div")
    value.className = "rex-field-value"
    value.appendChild(block.source.cloneNode(true))
    wrap.appendChild(value)
  }

  fieldsHost.appendChild(wrap)
}

function buildPageRoot(doc: Document, pageBlocks: PdfBlock[]): HTMLElement {
  const root = doc.createElement("div")
  root.id = "request-export-root"

  let sectionEl: HTMLElement | null = null
  let sectionKey: string | null = null
  let fieldsHost: HTMLElement | null = null

  const ensureSection = (block: PdfBlock, pagePrefix: PdfBlock[]) => {
    const continued =
      block.kind !== "section-head" &&
      !pagePrefix.some((b) => b.sectionKey === block.sectionKey && b.kind === "section-head")

    if (block.sectionKey === sectionKey && sectionEl) {
      if (continued && !sectionEl.querySelector(".rex-section-continue") && block.sectionTitle) {
        appendSectionContinue(doc, sectionEl, block.sectionTitle)
        sectionEl.classList.add("rex-section--continued")
      }
      return
    }

    sectionEl = doc.createElement("section")
    sectionEl.className = continued ? "rex-section rex-section--continued" : "rex-section"
    if (continued && block.sectionTitle) appendSectionContinue(doc, sectionEl, block.sectionTitle)
    fieldsHost = doc.createElement("div")
    fieldsHost.className = "rex-fields"
    sectionEl.appendChild(fieldsHost)
    root.appendChild(sectionEl)
    sectionKey = block.sectionKey
  }

  for (let i = 0; i < pageBlocks.length; i++) {
    const block = pageBlocks[i]
    const pagePrefix = pageBlocks.slice(0, i)

    if (block.kind === "header") {
      sectionEl = null
      sectionKey = null
      fieldsHost = null
      root.appendChild(block.source.cloneNode(true))
      continue
    }

    ensureSection(block, pagePrefix)

    if (block.kind === "section-head") {
      sectionEl!.insertBefore(block.source.cloneNode(true), fieldsHost!)
      continue
    }

    mountFieldBlock(doc, block, fieldsHost!)
  }

  return root
}

async function buildPageInIframe(blocks: PdfBlock[], cssText: string): Promise<{
  iframe: HTMLIFrameElement
  root: HTMLElement
}> {
  const iframe = document.createElement("iframe")
  iframe.setAttribute("aria-hidden", "true")
  iframe.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    `width:${CAPTURE_WIDTH_PX}px`,
    "height:0",
    "border:0",
    "opacity:0",
    "pointer-events:none",
    "z-index:-1",
  ].join(";")
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument
  if (!doc) {
    iframe.remove()
    throw new Error("无法创建导出画布")
  }

  doc.open()
  doc.write('<!DOCTYPE html><html><head></head><body style="margin:0;background:#fff;color:#0f172a"></body></html>')
  doc.close()

  const styleEl = doc.createElement("style")
  styleEl.textContent = cssText
  doc.head.appendChild(styleEl)

  const root = buildPageRoot(doc, blocks)
  doc.body.appendChild(root)

  const images = Array.from(root.querySelectorAll("img"))
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) resolve()
          else {
            img.onload = () => resolve()
            img.onerror = () => resolve()
          }
        }),
    ),
  )
  await new Promise((r) => setTimeout(r, 50))

  return { iframe, root }
}

/** 白底文档截图用 JPEG 可显著减小 PDF 体积，肉眼观感与 PNG 基本一致 */
function canvasToJpegDataUrl(canvas: HTMLCanvasElement, quality = JPEG_QUALITY): string {
  return canvas.toDataURL("image/jpeg", quality)
}

/** jsPDF 内置字体不支持中文，用 Canvas 系统字体渲染页脚再贴入 PDF */
function renderPdfFooterCanvas(
  leftText: string,
  rightText: string,
  canvasWidthPx: number,
): HTMLCanvasElement {
  const logicalW = canvasWidthPx / CAPTURE_SCALE
  const logicalH = 28
  const canvas = document.createElement("canvas")
  canvas.width = canvasWidthPx
  canvas.height = logicalH * CAPTURE_SCALE
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("无法创建页脚画布")
  ctx.scale(CAPTURE_SCALE, CAPTURE_SCALE)
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, logicalW, logicalH)
  ctx.strokeStyle = "rgb(226, 232, 240)"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PDF_FOOTER_PAD_X, 8)
  ctx.lineTo(logicalW - PDF_FOOTER_PAD_X, 8)
  ctx.stroke()
  ctx.fillStyle = "rgb(100, 116, 139)"
  ctx.font = '11px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif'
  ctx.textBaseline = "middle"
  const textY = 19
  ctx.textAlign = "left"
  ctx.fillText(leftText, PDF_FOOTER_PAD_X, textY)
  ctx.textAlign = "right"
  ctx.fillText(rightText, logicalW - PDF_FOOTER_PAD_X, textY)
  return canvas
}

function logicalPageBodyHeight(contentW: number, contentH: number): number {
  return (contentH * CAPTURE_WIDTH_PX) / contentW
}

/** 从已渲染的 #request-export-root 导出 PDF（按块流式排版 + 逐页独立渲染） */
export async function exportPdfFromElement(root: HTMLElement, filename: string): Promise<PdfExportResult> {
  try {
    await preloadLogo()
    const cssText = await loadExportCss()
    const { jsPDF } = await import("jspdf")

    const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true })
    const pdfW = pdf.internal.pageSize.getWidth()
    const pdfH = pdf.internal.pageSize.getHeight()
    const contentW = pdfW - PDF_MARGIN_SIDE_PT * 2
    const contentH = pdfH - PDF_MARGIN_TOP_PT - PDF_MARGIN_BOTTOM_PT - PDF_FOOTER_PT
    const pageBodyH = logicalPageBodyHeight(contentW, contentH)
    const pxToPt = contentW / (CAPTURE_WIDTH_PX * CAPTURE_SCALE)

    const doc = root.ownerDocument ?? document
    let blocks = collectBlocks(root)
    blocks = expandOversizedFields(blocks, pageBodyH, doc, cssText)
    const pages = layoutBlocksToPages(blocks, pageBodyH, doc)
    const exportedAt = new Date().toLocaleString("zh-CN", { hour12: false })
    const totalPages = pages.length

    for (let index = 0; index < pages.length; index++) {
      const { iframe, root: pageRoot } = await buildPageInIframe(pages[index], cssText)
      try {
        const canvas = await captureElement(pageRoot, cssText)
        if (canvas.width === 0 || canvas.height === 0) {
          return { ok: false, error: "导出内容渲染为空" }
        }

        if (index > 0) pdf.addPage()
        const drawH = canvas.height * pxToPt
        pdf.addImage(
          canvasToJpegDataUrl(canvas),
          "JPEG",
          PDF_MARGIN_SIDE_PT,
          PDF_MARGIN_TOP_PT,
          contentW,
          drawH,
          undefined,
          "SLOW",
        )

        const footerCanvas = renderPdfFooterCanvas(
          `导出时间：${exportedAt}`,
          `第 ${index + 1} / ${totalPages} 页`,
          canvas.width,
        )
        const footerH_pt = footerCanvas.height * pxToPt
        pdf.addImage(
          canvasToJpegDataUrl(footerCanvas),
          "JPEG",
          PDF_MARGIN_SIDE_PT,
          pdfH - PDF_MARGIN_BOTTOM_PT - footerH_pt,
          contentW,
          footerH_pt,
          undefined,
          "SLOW",
        )
      } finally {
        iframe.remove()
      }
    }

    triggerDownload(pdf.output("blob"), filename.endsWith(".pdf") ? filename : `${filename}.pdf`)
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误"
    console.error("[export-pdf]", err)
    return { ok: false, error: message }
  }
}

/** 在独立 iframe 中渲染，避免继承页面 Tailwind 的 oklch 变量 */
async function renderTemplateInIframe(record: RequestRecord, cssText: string) {
  const iframe = document.createElement("iframe")
  iframe.setAttribute("aria-hidden", "true")
  iframe.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    `width:${CAPTURE_WIDTH_PX}px`,
    "height:0",
    "border:0",
    "opacity:0",
    "pointer-events:none",
    "z-index:-1",
  ].join(";")
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument
  if (!doc) {
    iframe.remove()
    throw new Error("无法创建导出画布")
  }

  doc.open()
  doc.write('<!DOCTYPE html><html><head></head><body style="margin:0;background:#fff;color:#0f172a"></body></html>')
  doc.close()

  const styleEl = doc.createElement("style")
  styleEl.textContent = cssText
  doc.head.appendChild(styleEl)

  const host = doc.createElement("div")
  doc.body.appendChild(host)

  const { createRoot } = await import("react-dom/client")
  const { createElement } = await import("react")
  const root = createRoot(host)
  root.render(createElement(RequestExportView, { record }))

  return { iframe, root, doc }
}

/** 离屏渲染模板后导出 — 列表/详情页调用 */
export async function exportSinglePdfFromTemplate(record: RequestRecord): Promise<PdfExportResult> {
  if (typeof document === "undefined") {
    return { ok: false, error: "仅支持在浏览器中导出" }
  }

  let iframe: HTMLIFrameElement | null = null
  let reactRoot: Root | null = null

  try {
    await preloadLogo()
    const cssText = await loadExportCss()
    const mounted = await renderTemplateInIframe(record, cssText)
    iframe = mounted.iframe
    reactRoot = mounted.root

    if (mounted.doc.fonts?.ready) await mounted.doc.fonts.ready
    await new Promise((r) => setTimeout(r, 200))

    const el = mounted.doc.getElementById("request-export-root")
    if (!el) {
      return { ok: false, error: "模板渲染失败" }
    }
    return await exportPdfFromElement(el, `${record.code}.pdf`)
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误"
    return { ok: false, error: message }
  } finally {
    reactRoot?.unmount()
    iframe?.remove()
  }
}

/** 批量导出：多个需求按原品牌模板逐条分页，合并为同一个 PDF 文件。 */
export async function exportMergedPdfFromTemplates(
  records: RequestRecord[],
  filename: string,
): Promise<PdfExportResult> {
  if (typeof document === "undefined") {
    return { ok: false, error: "仅支持在浏览器中导出" }
  }
  if (records.length === 0) {
    return { ok: false, error: "请先勾选需要导出的需求" }
  }

  try {
    await preloadLogo()
    const cssText = await loadExportCss()
    const { jsPDF } = await import("jspdf")

    const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true })
    const pdfW = pdf.internal.pageSize.getWidth()
    const pdfH = pdf.internal.pageSize.getHeight()
    const contentW = pdfW - PDF_MARGIN_SIDE_PT * 2
    const contentH = pdfH - PDF_MARGIN_TOP_PT - PDF_MARGIN_BOTTOM_PT - PDF_FOOTER_PT
    const pageBodyH = logicalPageBodyHeight(contentW, contentH)
    const pxToPt = contentW / (CAPTURE_WIDTH_PX * CAPTURE_SCALE)

    // 第一遍：逐条渲染模板并完成分块排版，只保留页面块数据（不截图）
    const allPages: PdfBlock[][] = []
    for (const record of records) {
      const mounted = await renderTemplateInIframe(record, cssText)
      try {
        if (mounted.doc.fonts?.ready) await mounted.doc.fonts.ready
        await new Promise((r) => setTimeout(r, 200))
        const root = mounted.doc.getElementById("request-export-root")
        if (!root) {
          return { ok: false, error: "模板渲染失败" }
        }
        let blocks = collectBlocks(root)
        blocks = expandOversizedFields(blocks, pageBodyH, mounted.doc, cssText)
        allPages.push(...layoutBlocksToPages(blocks, pageBodyH, mounted.doc))
      } finally {
        mounted.root.unmount()
        mounted.iframe.remove()
      }
    }
    const totalPages = allPages.length
    const exportedAt = new Date().toLocaleString("zh-CN", { hour12: false })

    // 第二遍：逐页重建渲染并截图，统一写入同一个 PDF（全局页码）
    for (let index = 0; index < allPages.length; index++) {
      const { iframe, root: pageRoot } = await buildPageInIframe(allPages[index], cssText)
      try {
        const canvas = await captureElement(pageRoot, cssText)
        if (canvas.width === 0 || canvas.height === 0) {
          return { ok: false, error: "导出内容渲染为空" }
        }

        if (index > 0) pdf.addPage()
        const drawH = canvas.height * pxToPt
        pdf.addImage(
          canvasToJpegDataUrl(canvas),
          "JPEG",
          PDF_MARGIN_SIDE_PT,
          PDF_MARGIN_TOP_PT,
          contentW,
          drawH,
          undefined,
          "SLOW",
        )

        const footerCanvas = renderPdfFooterCanvas(
          `导出时间：${exportedAt}`,
          `第 ${index + 1} / ${totalPages} 页`,
          canvas.width,
        )
        const footerH_pt = footerCanvas.height * pxToPt
        pdf.addImage(
          canvasToJpegDataUrl(footerCanvas),
          "JPEG",
          PDF_MARGIN_SIDE_PT,
          pdfH - PDF_MARGIN_BOTTOM_PT - footerH_pt,
          contentW,
          footerH_pt,
          undefined,
          "SLOW",
        )
      } finally {
        iframe.remove()
      }
    }

    triggerDownload(pdf.output("blob"), filename.endsWith(".pdf") ? filename : `${filename}.pdf`)
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误"
    console.error("[export-pdf-merged]", err)
    return { ok: false, error: message }
  }
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
