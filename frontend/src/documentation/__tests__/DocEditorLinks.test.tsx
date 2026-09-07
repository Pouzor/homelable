/**
 * The `[[` picker.
 *
 * Wiki-links were unusable unless you remembered a title or a slug exactly.
 * What matters here is the arithmetic: the two brackets stay in the body while
 * the menu is open, and choosing a target replaces exactly those two.
 */
import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DocEditor } from '../components/DocEditor'
import type { LinkableDevice, LinkableDoc } from '../wikilinks'

vi.mock('@/api/client', () => ({
  documentsApi: { block: vi.fn() },
}))

const DOCS: LinkableDoc[] = [
  { id: 'd1', slug: 'vlan-plan', title: 'VLAN plan' },
  { id: 'd2', slug: 'nas-01', title: 'nas-01', device_id: 'dev-1' },
  { id: 'd3', slug: 'backup-runbook', title: 'Backup runbook' },
]

const DEVICES: LinkableDevice[] = [{ id: 'dev-1', label: 'nas-01' }]

/** A stateful host, so the brackets really land in the textarea's value. */
function setup(initial = '', docs: LinkableDoc[] = DOCS, devices = DEVICES) {
  const onChange = vi.fn()
  function Host() {
    const [body, setBody] = useState(initial)
    return (
      <DocEditor
        body={body}
        onChange={(next) => {
          onChange(next)
          setBody(next)
        }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        dirty={false}
        saving={false}
        docs={docs}
        devices={devices}
      />
    )
  }
  render(<Host />)
  return { onChange, textarea: screen.getByLabelText('Document source') as HTMLTextAreaElement }
}

// userEvent reads `[…]` as a key code, so a literal bracket is doubled: the
// four characters below type exactly `[[`.
const TWO_BRACKETS = '[[[['

async function openPicker(textarea: HTMLTextAreaElement, user = userEvent.setup()) {
  await user.click(textarea)
  await user.keyboard(TWO_BRACKETS)
  return user
}

describe('DocEditor — the [[ picker', () => {
  it('opens on the second bracket and lists the documents', async () => {
    const { textarea } = setup('Runs on ')

    await openPicker(textarea)

    expect(screen.getByLabelText('Link to a document')).toBeTruthy()
    expect(screen.getByText('VLAN plan')).toBeTruthy()
    expect(screen.getByText('Backup runbook')).toBeTruthy()
  })

  it('holds the second bracket back while it is open', async () => {
    const { textarea } = setup('Runs on ')

    await openPicker(textarea)

    // The picker owns the second bracket until it inserts or is cancelled.
    expect(textarea.value).toBe('Runs on [')
  })

  it('does not open on a single bracket', async () => {
    const { textarea } = setup('')
    const user = userEvent.setup()

    await user.click(textarea)
    await user.keyboard('[[')

    expect(textarea.value).toBe('[')
    expect(screen.queryByLabelText('Link to a document')).toBeNull()
  })

  it('replaces both brackets with the finished link', async () => {
    const { textarea } = setup('Runs on ')
    const user = await openPicker(textarea)

    await user.click(screen.getByText('VLAN plan'))

    await waitFor(() => expect(textarea.value).toBe('Runs on [[VLAN plan]]'))
  })

  it('filters as you type, and Enter takes the first match', async () => {
    const { textarea } = setup('')
    const user = await openPicker(textarea)

    await user.type(screen.getByLabelText('Link to a document'), 'backup')
    expect(screen.queryByText('VLAN plan')).toBeNull()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(textarea.value).toBe('[[Backup runbook]]'))
  })

  it('says which document belongs to a device', async () => {
    const { textarea } = setup('')

    await openPicker(textarea)

    expect(screen.getByText('Device · nas-01')).toBeTruthy()
  })

  it('addresses a document by id when its title is ambiguous', async () => {
    const { textarea } = setup('', [
      { id: 'd1', slug: 'incident-1', title: 'Incident' },
      { id: 'd2', slug: 'incident-2', title: 'Incident' },
    ])
    const user = await openPicker(textarea)

    await user.click(screen.getAllByText('Incident')[0])

    // A bare `[[Incident]]` resolves by title and would pick whichever came
    // first, so an ambiguous title is written as an id instead.
    await waitFor(() => expect(textarea.value).toBe('[[doc:d1]]'))
  })

  it('closes on Escape and leaves what was typed', async () => {
    const { textarea } = setup('Runs on ')
    const user = await openPicker(textarea)

    await user.type(screen.getByLabelText('Link to a document'), '{Escape}')

    expect(screen.queryByLabelText('Link to a document')).toBeNull()
    expect(textarea.value).toBe('Runs on [[')
  })

  it('says so when there is nothing to link to yet', async () => {
    const { textarea } = setup('', [])

    await openPicker(textarea)

    expect(screen.getByText('No document to link to yet.')).toBeTruthy()
  })

  it('still opens the slash menu on a new line', async () => {
    const { textarea } = setup('')
    const user = userEvent.setup()

    await user.click(textarea)
    await user.keyboard('/')

    expect(screen.getByLabelText('Insert a block')).toBeTruthy()
    expect(screen.queryByLabelText('Link to a document')).toBeNull()
  })
})
