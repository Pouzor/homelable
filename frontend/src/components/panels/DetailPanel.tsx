// ONLY showing the part that actually needed merging/fixing

function ServiceBadge({
  svc,
  host,
  onEdit,
  onRemove,
}: {
  svc: ServiceInfo
  host?: string
  onEdit: () => void
  onRemove: () => void
}) {
  const url = getServiceUrl(svc, host)
  const color = CATEGORY_COLORS[svc.category ?? ''] ?? '#8b949e'

  const hasPort = svc.port != null
  const portLabel = hasPort ? `${svc.port}/${svc.protocol}` : null
  const pathLabel = svc.path?.trim() ? svc.path.trim() : null

  return (
    <div
      className="group flex items-center gap-1 border rounded-md text-xs transition-colors px-2 py-1.5 min-w-0"
      style={{ background: '#21262d', borderColor: '#30363d' }}
    >
      {/* LEFT SIDE */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <span
          className="shrink-0 w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />

        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium truncate min-w-0"
            style={{ color }}
            title={svc.service_name}
            onClick={(e) => e.stopPropagation()}
          >
            {svc.service_name}
          </a>
        ) : (
          <span
            className="font-medium truncate min-w-0"
            style={{ color }}
            title={svc.service_name}
          >
            {svc.service_name}
          </span>
        )}

        {pathLabel && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="truncate text-[#8b949e] max-w-[80px]"
                  tabIndex={0}
                >
                  {pathLabel}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">{pathLabel}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* RIGHT SIDE */}
      <div className="flex items-center gap-1 shrink-0">
        {portLabel &&
          (url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[#8b949e]"
              title={portLabel}
              onClick={(e) => e.stopPropagation()}
            >
              {portLabel}
            </a>
          ) : (
            <span className="font-mono text-[#8b949e]">
              {portLabel}
            </span>
          ))}

        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-2.5 h-2.5 items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink size={10} className="text-muted-foreground" />
          </a>
        ) : (
          <span className="w-2.5" />
        )}

        <button
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onEdit()
          }}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-[#8b949e] hover:text-[#00d4ff]"
          title="Edit service"
        >
          <Pencil size={10} />
        </button>

        <button
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onRemove()
          }}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-[#8b949e] hover:text-[#f85149]"
          title="Remove service"
        >
          <X size={10} />
        </button>
      </div>
    </div>
  )
}
