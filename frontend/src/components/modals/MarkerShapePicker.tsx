import type { ReactElement } from 'react'
import type { MarkerShape } from '@/types'
import { MARKER_SHAPES } from '@/utils/edgeMarkers'

/** 16x16 preview glyph for a marker shape (used in the picker buttons). */
function markerGlyph(shape: MarkerShape, color: string): ReactElement {
  switch (shape) {
    case 'none':
      return <line x1={3} y1={8} x2={13} y2={8} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    case 'arrow':
      return <path d="M4 4 L12 8 L4 12 z" fill={color} />
    case 'arrow-open':
      return <path d="M5 4 L11 8 L5 12" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    case 'circle':
      return <circle cx={8} cy={8} r={4} fill={color} />
    case 'diamond':
      return <path d="M8 3 L13 8 L8 13 L3 8 z" fill={color} />
    case 'square':
      return <rect x={4} y={4} width={8} height={8} fill={color} />
  }
}

interface MarkerShapePickerProps {
  label: string
  value: MarkerShape
  onChange: (shape: MarkerShape) => void
}

/** A labeled row of buttons to pick the marker shape for one edge end. */
export function MarkerShapePicker({ label, value, onChange }: MarkerShapePickerProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[#8b949e] w-10 shrink-0">{label}</span>
      <div className="flex gap-1 flex-wrap">
        {MARKER_SHAPES.map((shape) => {
          const active = value === shape
          return (
            <button
              key={shape}
              type="button"
              onClick={() => onChange(shape)}
              aria-label={`${label} marker ${shape}`}
              aria-pressed={active}
              title={shape}
              className="w-7 h-7 rounded border flex items-center justify-center transition-colors shrink-0"
              style={{
                borderColor: active ? '#00d4ff' : '#30363d',
                background: active ? '#00d4ff22' : 'transparent',
              }}
            >
              <svg width={16} height={16} viewBox="0 0 16 16">
                {markerGlyph(shape, active ? '#00d4ff' : '#8b949e')}
              </svg>
            </button>
          )
        })}
      </div>
    </div>
  )
}
