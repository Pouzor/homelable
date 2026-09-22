import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ImportSourceModal, type ImportSourceKey } from '../ImportSourceModal'

afterEach(() => cleanup())

function setup(overrides: Partial<{ open: boolean; onClose: () => void; onPick: (s: ImportSourceKey) => void }> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    onPick: vi.fn(),
    ...overrides,
  }
  render(<ImportSourceModal {...props} />)
  return props
}

describe('ImportSourceModal', () => {
  it('renders nothing when closed', () => {
    setup({ open: false })
    expect(screen.queryByText('Import from…')).not.toBeInTheDocument()
  })

  it('lists every import source', () => {
    setup()
    for (const label of ['Zigbee2MQTT', 'Z-Wave JS', 'Proxmox VE', 'UniFi']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('shows the expected duration and the data each source brings in', () => {
    setup()
    // The tile promises a rough wall-clock and the record kinds — that is what
    // makes the picker a choice rather than four unlabelled doors.
    expect(screen.getByText('~10 s')).toBeInTheDocument()
    // A mesh walk is not a fixed cost, so the tile says what the range tracks.
    expect(screen.getAllByText('30 s – a few min')).toHaveLength(2)
    expect(screen.getAllByText('· with the mesh size')).toHaveLength(2)
    expect(screen.getByText('Mesh links')).toBeInTheDocument()
    expect(screen.getByText('LXC')).toBeInTheDocument()
    expect(screen.getByText('APs')).toBeInTheDocument()
  })

  it.each([
    ['Zigbee2MQTT', 'zigbee'],
    ['Z-Wave JS', 'zwave'],
    ['Proxmox VE', 'proxmox'],
    ['UniFi', 'unifi'],
  ])('reports %s as the picked source', (label, key) => {
    const { onPick } = setup()
    fireEvent.click(screen.getByLabelText(`Import from ${label}`))
    expect(onPick).toHaveBeenCalledExactlyOnceWith(key)
  })

  it('carries the walkthrough anchor on the Zigbee tile', () => {
    setup()
    // The tour steps into the picker and then spotlights Zigbee inside it.
    expect(document.querySelector('[data-tour="import-zigbee"]')).toBeInTheDocument()
  })

  it('falls back to a lucide glyph when the brand logo fails to load', () => {
    setup()
    const tile = screen.getByLabelText('Import from UniFi')
    const img = tile.querySelector('img')!
    expect(img.nextElementSibling).toHaveAttribute('hidden')
    fireEvent.error(img)
    expect(img.style.display).toBe('none')
    expect(img.nextElementSibling).not.toHaveAttribute('hidden')
  })
})
