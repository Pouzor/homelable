import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DesignTrail } from '../DesignTrail'
import { useDesignStore } from '@/stores/designStore'
import type { Design } from '@/types'

const design = (id: string, name: string): Design => ({ id, name, design_type: 'network', created_at: '', updated_at: '' })

describe('DesignTrail', () => {
  beforeEach(() => {
    useDesignStore.setState({
      designs: [design('net', 'Network'), design('host', 'Inside kero'), design('vm', 'VM 104')],
      activeDesignId: 'net',
      activeDesignType: 'network',
      trail: [],
    })
  })

  it('draws nothing before any drill-down', () => {
    const { container } = render(<DesignTrail />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows each design clicked through, then the current one', () => {
    useDesignStore.getState().openLinkedDesign('host')
    useDesignStore.getState().openLinkedDesign('vm')
    render(<DesignTrail />)
    expect(screen.getByRole('button', { name: 'Network' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inside kero' })).toBeInTheDocument()
    expect(screen.getByText('VM 104')).toHaveAttribute('aria-current', 'page')
  })

  it('a crumb leads back up to its design', () => {
    useDesignStore.getState().openLinkedDesign('host')
    useDesignStore.getState().openLinkedDesign('vm')
    render(<DesignTrail />)
    fireEvent.click(screen.getByRole('button', { name: 'Network' }))
    const s = useDesignStore.getState()
    expect(s.activeDesignId).toBe('net')
    expect(s.trail).toEqual([])
  })
})
