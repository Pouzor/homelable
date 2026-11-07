import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Upload } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { mediaApi } from '@/api/client'
import { IconImage } from '@/components/ui/IconImage'
import { URL_ICON_PREFIX, isUrlIconKey, urlIconKey, urlIconSrc } from '@/utils/nodeIcons'

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true'
const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml'

interface CustomIconPickerProps {
  value?: string
  onSelect: (key: string) => void
  /** Offer uploading a file. Full mode only (ADR-001): standalone has no backend. */
  allowUpload?: boolean
}

/**
 * Custom icon tab: paste any image link (selfh.st, Simple Icons, a LAN server…)
 * or, in full mode, upload a file to the media store. Stored as `url:<link>`.
 */
export function CustomIconPicker({ value, onSelect, allowUpload = !STANDALONE }: CustomIconPickerProps) {
  const current = isUrlIconKey(value) ? value!.slice(URL_ICON_PREFIX.length) : ''
  const [draft, setDraft] = useState(current)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const apply = () => {
    const key = urlIconKey(draft)
    if (!key) {
      setError('Enter an http(s) link to an image.')
      return
    }
    setError(null)
    onSelect(key)
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const { url } = await mediaApi.upload(file)
      const key = urlIconKey(url)
      if (!key) throw new Error('unexpected upload URL')
      setDraft(url)
      setError(null)
      onSelect(key)
    } catch {
      toast.error('Icon upload failed')
    } finally {
      setUploading(false)
    }
  }

  const previewSrc = value && isUrlIconKey(value) ? urlIconSrc(value) : null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        <Input
          type="url"
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setError(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply() } }}
          placeholder="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/…"
          className="bg-[#0d1117] border-[#30363d] text-xs h-7 flex-1 min-w-0"
          aria-label="Custom icon URL"
          aria-invalid={error ? true : undefined}
        />
        <Button type="button" size="sm" variant="secondary" className="h-7 text-xs cursor-pointer" onClick={apply}>
          Use
        </Button>
      </div>
      {error && <div className="text-[10px] text-[#f85149]" role="alert">{error}</div>}

      {allowUpload && (
        <>
          <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={handleFile} aria-label="Custom icon file" />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 text-xs cursor-pointer gap-1.5"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={12} />
            {uploading ? 'Uploading…' : 'Upload image'}
          </Button>
        </>
      )}

      <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
        {previewSrc && (
          <span className="flex items-center justify-center w-7 h-7 rounded-md border border-[#00d4ff] bg-[#00d4ff]/10 shrink-0">
            <IconImage src={previewSrc} alt="Custom icon preview" size={20} fallback={<span className="text-[#f85149]">!</span>} />
          </span>
        )}
        <span>
          PNG, JPEG, WebP or SVG.{allowUpload ? '' : ' Uploads need the backend; paste a link instead.'}
        </span>
      </div>
    </div>
  )
}
