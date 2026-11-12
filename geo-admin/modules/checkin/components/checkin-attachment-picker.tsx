"use client"

import { useEffect, useRef, useState } from "react"
import { ImagePlus, Trash2, X, ZoomIn } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog"
import { CHECKIN_ATTACHMENT_ACCEPT, CHECKIN_ATTACHMENT_MAX_COUNT, formatBytes, CHECKIN_ATTACHMENT_MAX_BYTES } from "../lib/attachment-limits"
import { cn } from "@/shared/lib/utils"

interface CheckinAttachmentPickerProps {
  selectedFiles: File[]
  isLoading: boolean
  required?: boolean
  error?: string
  onPickFiles: (files: File[]) => void
  onRemoveFile: (index: number) => void
  onClearFiles: () => void
}

export function CheckinAttachmentPicker({
  selectedFiles,
  isLoading,
  required = false,
  error,
  onPickFiles,
  onRemoveFile,
  onClearFiles,
}: CheckinAttachmentPickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [previewUrls, setPreviewUrls] = useState<string[]>([])
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)

  useEffect(() => {
    const urls = selectedFiles.map((file) => URL.createObjectURL(file))
    setPreviewUrls(urls)
    return () => {
      for (const url of urls) URL.revokeObjectURL(url)
    }
  }, [selectedFiles])

  const previewFile = previewIndex !== null ? selectedFiles[previewIndex] : null
  const previewUrl = previewIndex !== null ? previewUrls[previewIndex] : null

  return (
    <section className="rounded-2xl border border-dashed border-border bg-muted/20 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <ImagePlus className="size-3.5" />
          现场照片{required ? "（必填）" : "（可选）"}
        </div>
        {selectedFiles.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={onClearFiles}
            disabled={isLoading}
          >
            全部清空
          </Button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={CHECKIN_ATTACHMENT_ACCEPT}
        multiple
        className="hidden"
        disabled={isLoading || selectedFiles.length >= CHECKIN_ATTACHMENT_MAX_COUNT}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length > 0) onPickFiles(files)
          if (inputRef.current) inputRef.current.value = ""
        }}
      />

      {selectedFiles.length > 0 ? (
        <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {selectedFiles.map((file, index) => (
            <li key={`${file.name}-${file.lastModified}-${index}`} className="group relative">
              <button
                type="button"
                className="relative block w-full overflow-hidden rounded-lg border border-border bg-background"
                onClick={() => setPreviewIndex(index)}
                disabled={isLoading}
                aria-label={`预览 ${file.name}`}
              >
                {previewUrls[index] ? (
                  <img
                    src={previewUrls[index]}
                    alt={file.name}
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <div className="flex aspect-square items-center justify-center bg-muted text-xs text-muted-foreground">
                    加载中
                  </div>
                )}
                <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/45 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                  <ZoomIn className="size-3" />
                  预览
                </span>
              </button>
              <button
                type="button"
                className={cn(
                  "absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-destructive hover:text-destructive-foreground",
                  isLoading && "pointer-events-none opacity-50",
                )}
                onClick={() => onRemoveFile(index)}
                disabled={isLoading}
                aria-label={`删除 ${file.name}`}
              >
                <X className="size-3.5" />
              </button>
              <p className="mt-1 truncate text-[10px] text-muted-foreground" title={file.name}>
                {file.name}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          {required
            ? `到达打卡前请上传至少一张现场照片（最多 ${CHECKIN_ATTACHMENT_MAX_COUNT} 张，单张 ≤ ${formatBytes(CHECKIN_ATTACHMENT_MAX_BYTES)}）`
            : "可上传现场照片，打卡时上传到服务器本地目录"}
        </p>
      )}

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => inputRef.current?.click()}
          disabled={isLoading || selectedFiles.length >= CHECKIN_ATTACHMENT_MAX_COUNT}
        >
          <ImagePlus className="size-3.5" />
          {selectedFiles.length > 0 ? "继续添加" : "选择照片"}
        </Button>
        {selectedFiles.length > 0 && (
          <span className="text-xs text-muted-foreground">
            已选 {selectedFiles.length}/{CHECKIN_ATTACHMENT_MAX_COUNT} 张，将在打卡时上传保存
          </span>
        )}
      </div>

      <Dialog open={previewIndex !== null} onOpenChange={(open) => !open && setPreviewIndex(null)}>
        <DialogContent className="max-w-lg gap-0 overflow-hidden p-0 sm:max-w-xl">
          <DialogTitle className="sr-only">照片预览</DialogTitle>
          {previewFile && previewUrl ? (
            <div className="flex flex-col">
              <div className="relative max-h-[70vh] bg-black/5">
                <img src={previewUrl} alt={previewFile.name} className="mx-auto max-h-[70vh] w-full object-contain" />
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{previewFile.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(previewFile.size)}</p>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="shrink-0 gap-1.5"
                  onClick={() => {
                    if (previewIndex === null) return
                    onRemoveFile(previewIndex)
                    setPreviewIndex(null)
                  }}
                  disabled={isLoading}
                >
                  <Trash2 className="size-3.5" />
                  删除
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  )
}
