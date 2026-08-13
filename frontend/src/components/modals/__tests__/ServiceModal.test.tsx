import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ServiceModal } from '../ServiceModal'
import { serviceToForm } from '@/utils/serviceForm'

function setup(props: Partial<React.ComponentProps<typeof ServiceModal>> = {}) {
  const onSubmit = vi.fn()
  const onClose = vi.fn()
  render(<ServiceModal open onClose={onClose} onSubmit={onSubmit} {...props} />)
  return { onSubmit, onClose }
}

const submit = (label = 'Add') =>
  fireEvent.click(screen.getByRole('button', { name: label }))

describe('ServiceModal', () => {
  describe('form submission', () => {
    it('submits name, port, protocol and path', () => {
      const { onSubmit, onClose } = setup()
      fireEvent.change(screen.getByPlaceholderText('Service name'), { target: { value: 'nginx' } })
      fireEvent.change(screen.getByPlaceholderText('Port'), { target: { value: '80' } })
      fireEvent.change(screen.getByLabelText('Protocol'), { target: { value: 'udp' } })
      fireEvent.change(screen.getByPlaceholderText('Path (/admin)'), { target: { value: '/admin' } })
      submit()

      expect(onSubmit).toHaveBeenCalledWith({
        service_name: 'nginx',
        protocol: 'udp',
        port: 80,
        path: '/admin',
        host: undefined,
        icon: undefined,
      })
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('submits without a port', () => {
      const { onSubmit } = setup()
      fireEvent.change(screen.getByPlaceholderText('Service name'), { target: { value: 'health' } })
      submit()
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ service_name: 'health', port: undefined, path: undefined }))
    })

    it('trims whitespace off the name and path', () => {
      const { onSubmit } = setup()
      fireEvent.change(screen.getByPlaceholderText('Service name'), { target: { value: '  nginx  ' } })
      fireEvent.change(screen.getByPlaceholderText('Path (/admin)'), { target: { value: '  /admin  ' } })
      submit()
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ service_name: 'nginx', path: '/admin' }))
    })

    it('blocks submission and flags the field when the name is blank', () => {
      const { onSubmit, onClose } = setup()
      fireEvent.change(screen.getByPlaceholderText('Service name'), { target: { value: '   ' } })
      submit()
      expect(onSubmit).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByText('Name is required')).toBeDefined()
    })

    it('clears the name error once the user types', () => {
      setup()
      submit()
      expect(screen.getByText('Name is required')).toBeDefined()
      fireEvent.change(screen.getByPlaceholderText('Service name'), { target: { value: 'n' } })
      expect(screen.queryByText('Name is required')).toBeNull()
    })

    it('strips non-digits from the port field', () => {
      setup()
      fireEvent.change(screen.getByPlaceholderText('Port'), { target: { value: '8a0b80' } })
      expect((screen.getByPlaceholderText('Port') as HTMLInputElement).value).toBe('8080')
    })

    it('clamps an out-of-range port on blur', () => {
      setup()
      const port = screen.getByPlaceholderText('Port')
      fireEvent.change(port, { target: { value: '99999' } })
      fireEvent.blur(port)
      expect((port as HTMLInputElement).value).toBe('65535')
    })

    it('calls onClose without submitting on Cancel', () => {
      const { onSubmit, onClose } = setup()
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(onSubmit).not.toHaveBeenCalled()
      expect(onClose).toHaveBeenCalledOnce()
    })
  })

  describe('edit mode', () => {
    const initial = serviceToForm({ port: 80, protocol: 'tcp', service_name: 'nginx', path: '/admin', icon: 'brand:nginx' })

    it('prefills the form from an existing service', () => {
      setup({ initial, title: 'Edit Service', confirmLabel: 'Save' })
      expect((screen.getByPlaceholderText('Service name') as HTMLInputElement).value).toBe('nginx')
      expect((screen.getByPlaceholderText('Port') as HTMLInputElement).value).toBe('80')
      expect((screen.getByPlaceholderText('Path (/admin)') as HTMLInputElement).value).toBe('/admin')
      expect(screen.getByText('Edit Service')).toBeDefined()
    })

    it('keeps the existing icon when nothing else changes', () => {
      const { onSubmit } = setup({ initial, confirmLabel: 'Save' })
      submit('Save')
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ icon: 'brand:nginx' }))
    })

    it('clears a port that the user emptied', () => {
      const { onSubmit } = setup({ initial, confirmLabel: 'Save' })
      fireEvent.change(screen.getByPlaceholderText('Port'), { target: { value: '' } })
      submit('Save')
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ port: undefined }))
    })

    it('clears a path that the user emptied', () => {
      const { onSubmit } = setup({ initial, confirmLabel: 'Save' })
      fireEvent.change(screen.getByPlaceholderText('Path (/admin)'), { target: { value: '' } })
      submit('Save')
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ path: undefined }))
    })

    it('prefills and clears the host override', () => {
      const withHost = serviceToForm({ port: 443, protocol: 'tcp', service_name: 'blog', host: 'blog.example.com' })
      const { onSubmit } = setup({ initial: withHost, confirmLabel: 'Save' })
      const input = screen.getByPlaceholderText('Node host (app.example.com)') as HTMLInputElement
      expect(input.value).toBe('blog.example.com')
      fireEvent.change(input, { target: { value: '' } })
      submit('Save')
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ host: undefined }))
    })
  })

  describe('host override', () => {
    it('submits a trimmed host override', () => {
      const { onSubmit } = setup()
      fireEvent.change(screen.getByPlaceholderText('Service name'), { target: { value: 'blog' } })
      fireEvent.change(screen.getByPlaceholderText('Node host (app.example.com)'), { target: { value: '  blog.example.com  ' } })
      submit()
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ host: 'blog.example.com' }))
    })

    it('submits undefined when the host is left blank', () => {
      const { onSubmit } = setup()
      fireEvent.change(screen.getByPlaceholderText('Service name'), { target: { value: 'blog' } })
      fireEvent.change(screen.getByPlaceholderText('Node host (app.example.com)'), { target: { value: '   ' } })
      submit()
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ host: undefined }))
    })
  })

  describe('icon picker', () => {
    it('shows "None" until an icon is picked', () => {
      setup()
      expect(screen.getByLabelText('Icon picker trigger').textContent).toContain('None')
    })

    it('shows an unresolvable legacy key verbatim rather than "None"', () => {
      setup({ initial: serviceToForm({ protocol: 'tcp', service_name: 'grafana', icon: 'bar-chart-2' }) })
      expect(screen.getByLabelText('Icon picker trigger').textContent).toContain('bar-chart-2')
    })

    it('keeps an unresolvable legacy key on save instead of dropping it', () => {
      const { onSubmit } = setup({ initial: serviceToForm({ protocol: 'tcp', service_name: 'grafana', icon: 'bar-chart-2' }), confirmLabel: 'Save' })
      submit('Save')
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ icon: 'bar-chart-2' }))
    })

    it('selects a generic lucide icon', () => {
      const { onSubmit } = setup()
      fireEvent.change(screen.getByPlaceholderText('Service name'), { target: { value: 'db' } })
      fireEvent.click(screen.getByLabelText('Icon picker trigger'))
      fireEvent.click(screen.getByLabelText('Select icon Database (SQL/NoSQL)'))
      submit()
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ icon: 'database' }))
    })

    it('selects a brand icon from the Brand tab', () => {
      const { onSubmit } = setup()
      fireEvent.change(screen.getByPlaceholderText('Service name'), { target: { value: 'plex' } })
      fireEvent.click(screen.getByLabelText('Icon picker trigger'))
      fireEvent.click(screen.getByRole('tab', { name: 'Brand' }))
      fireEvent.change(screen.getByLabelText('Brand icon search'), { target: { value: 'plex' } })
      fireEvent.click(screen.getByRole('button', { name: 'plex' }))
      submit()
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ icon: 'brand:plex' }))
    })

    it('opens on the Brand tab when the service already carries a brand icon', () => {
      setup({ initial: serviceToForm({ protocol: 'tcp', service_name: 'plex', icon: 'brand:plex' }) })
      fireEvent.click(screen.getByLabelText('Icon picker trigger'))
      expect(screen.getByRole('tab', { name: 'Brand' }).getAttribute('aria-selected')).toBe('true')
    })

    it('previews the selected brand icon on the trigger', () => {
      setup({ initial: serviceToForm({ protocol: 'tcp', service_name: 'plex', icon: 'brand:plex' }) })
      expect(screen.getByLabelText('Icon picker trigger').textContent).toContain('plex')
    })

    it('resets the icon back to none', () => {
      const { onSubmit } = setup({ initial: serviceToForm({ protocol: 'tcp', service_name: 'plex', icon: 'brand:plex' }) })
      fireEvent.click(screen.getByRole('button', { name: /Reset/ }))
      submit()
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ icon: undefined }))
    })

    it('hides the Reset button when no icon is set', () => {
      setup()
      expect(screen.queryByRole('button', { name: /Reset/ })).toBeNull()
    })
  })
})
