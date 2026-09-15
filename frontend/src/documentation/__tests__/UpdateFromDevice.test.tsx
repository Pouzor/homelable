import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { UpdateFromDeviceModal } from '../components/UpdateFromDeviceModal'
import type { ReconcileChange, ResolutionItem, UpdatePreview } from '../types'

function preview(overrides: Partial<UpdatePreview> = {}): UpdatePreview {
  return {
    preview_id: 'abc123',
    changes: [],
    proposed_body: 'body',
    summary: [],
    unresolved: [],
    ...overrides,
  }
}

function change(overrides: Partial<ReconcileChange> = {}): ReconcileChange {
  return {
    id: 'conflict-1',
    name: 'IP',
    kind: 'field',
    status: 'conflict',
    documented: 'old',
    device: 'new',
    previous: '',
    ...overrides,
  }
}

const PROPS = {
  open: true,
  docTitle: 'nas-01',
  preview: null,
  loading: false,
  resolutions: {},
  onPreview: vi.fn(),
  onResolve: vi.fn(),
  onCancel: vi.fn(),
  onApply: vi.fn(),
  docs: [],
  devices: [],
}

describe('UpdateFromDeviceModal', () => {
  it('shows a spinner while the preview is loading', () => {
    render(<UpdateFromDeviceModal {...PROPS} preview={null} loading />)
    expect(screen.getByText('Comparing with the device…')).toBeTruthy()
  })

  it('offers a retry when the preview could not be fetched', () => {
    render(<UpdateFromDeviceModal {...PROPS} preview={null} loading={false} />)
    expect(screen.getByText(/Could not compare this document with the device/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('declares that nothing to change when summary and unresolved are empty', () => {
    render(<UpdateFromDeviceModal {...PROPS} preview={preview()} />)
    expect(screen.getByText('Nothing to change')).toBeTruthy()
    expect(screen.getByText(/already matches the device/)).toBeTruthy()
  })

  it('hides the Update button when conflicts remain unresolved', () => {
    render(
      <UpdateFromDeviceModal
        {...PROPS}
        preview={preview({ changes: [change()], unresolved: ['conflict-1'] })}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Update the document' })).toBeNull()
    expect(screen.getByRole('button', { name: /Resolve 1 more/ })).toBeTruthy()
  })

  it('shows Update when every conflict is settled', () => {
    render(
      <UpdateFromDeviceModal
        {...PROPS}
        preview={preview({ changes: [change()], unresolved: ['conflict-1'] })}
        resolutions={{ 'conflict-1': { id: 'conflict-1', choice: 'device' } }}
      />,
    )
    expect(screen.getByRole('button', { name: 'Update the document' })).toBeTruthy()
  })

  it('locks both buttons while the server is working', () => {
    render(
      <UpdateFromDeviceModal
        {...PROPS}
        preview={preview()}
        loading
      />,
    )
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true)
  })
})
