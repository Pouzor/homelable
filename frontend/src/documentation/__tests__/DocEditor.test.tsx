import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { documentsApi } from '@/api/client'
import { DocEditor } from '../components/DocEditor'

vi.mock('@/api/client', () => ({
  documentsApi: { block: vi.fn() },
}))

const api = vi.mocked(documentsApi)

function setup(overrides: Partial<React.ComponentProps<typeof DocEditor>> = {}) {
  const props = {
    body: '',
    onChange: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    dirty: false,
    saving: false,
    deviceId: 'dev-1',
    ...overrides,
  }
  render(<DocEditor {...props} />)
  return props
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DocEditor', () => {
  it('shows the source in an editable field', () => {
    setup({ body: '# NAS' })
    expect(screen.getByLabelText('Document source')).toHaveValue('# NAS')
  })

  it('renders the preview beside it', () => {
    setup({ body: '# NAS' })
    expect(screen.getByRole('heading', { name: 'NAS' })).toBeInTheDocument()
  })

  it('saves on Ctrl+S even when the button is out of reach', async () => {
    const user = userEvent.setup()
    const props = setup({ body: 'text', dirty: true })
    await user.click(screen.getByLabelText('Document source'))
    await user.keyboard('{Control>}s{/Control}')
    expect(props.onSave).toHaveBeenCalled()
  })

  it('disables Save until something has changed', () => {
    setup({ dirty: false })
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  it('says so while a save is in flight', () => {
    setup({ dirty: true, saving: true })
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()
  })

  it('leaves edit mode on Escape', async () => {
    const user = userEvent.setup()
    const props = setup()
    await user.click(screen.getByLabelText('Document source'))
    await user.keyboard('{Escape}')
    expect(props.onCancel).toHaveBeenCalled()
  })

  it('opens the insert menu on a slash at the start of a line', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByLabelText('Document source'))
    await user.keyboard('/')
    expect(await screen.findByLabelText('Insert a block')).toBeInTheDocument()
  })

  it('leaves a slash mid-sentence alone', async () => {
    const user = userEvent.setup()
    setup({ body: 'and/or' })
    const field = screen.getByLabelText('Document source')
    await user.click(field)
    // Caret at the end, so the slash is not at the start of a line.
    await user.keyboard('{End}/')
    expect(screen.queryByLabelText('Insert a block')).not.toBeInTheDocument()
  })

  it('offers the generated blocks when the document describes a device', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByLabelText('Document source'))
    await user.keyboard('/')
    expect(await screen.findByText('/device')).toBeInTheDocument()
    expect(screen.getByText('/services')).toBeInTheDocument()
  })

  it('offers only the plain snippets for a page that describes nothing', async () => {
    const user = userEvent.setup()
    setup({ deviceId: null })
    await user.click(screen.getByLabelText('Document source'))
    await user.keyboard('/')
    await screen.findByLabelText('Insert a block')
    expect(screen.queryByText('/device')).not.toBeInTheDocument()
    expect(screen.getByText('/table')).toBeInTheDocument()
  })

  it('fetches a generated block and inserts it in place of the slash', async () => {
    const user = userEvent.setup()
    api.block.mockResolvedValue({ data: { block: 'device-info', markdown: '| IP | 10.0.0.1 |' } } as never)
    const props = setup()

    await user.click(screen.getByLabelText('Document source'))
    await user.keyboard('/')
    await user.click(await screen.findByText('/device'))

    await waitFor(() => expect(api.block).toHaveBeenCalledWith('device-info', 'dev-1'))
    expect(props.onChange).toHaveBeenLastCalledWith('| IP | 10.0.0.1 |\n')
  })

  it('inserts a plain snippet without calling the server', async () => {
    const user = userEvent.setup()
    const props = setup()
    await user.click(screen.getByLabelText('Document source'))
    await user.keyboard('/')
    await user.click(await screen.findByText('/task'))

    await waitFor(() => expect(props.onChange).toHaveBeenCalledWith('- [ ] \n- [ ] \n'))
    expect(api.block).not.toHaveBeenCalled()
  })

  it('narrows the menu as you type', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByLabelText('Document source'))
    await user.keyboard('/')
    await user.type(await screen.findByLabelText('Insert a block'), 'serv')
    expect(screen.getByText('/services')).toBeInTheDocument()
    expect(screen.queryByText('/table')).not.toBeInTheDocument()
  })

  it('closes the menu on Escape without leaving edit mode', async () => {
    const user = userEvent.setup()
    const props = setup()
    await user.click(screen.getByLabelText('Document source'))
    await user.keyboard('/')
    await screen.findByLabelText('Insert a block')
    await user.keyboard('{Escape}')
    expect(screen.queryByLabelText('Insert a block')).not.toBeInTheDocument()
    expect(props.onCancel).not.toHaveBeenCalled()
  })
})
