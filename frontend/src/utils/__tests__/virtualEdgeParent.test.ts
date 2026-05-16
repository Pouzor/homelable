import { describe, it, expect } from 'vitest'
import { resolveVirtualEdgeParent } from '../virtualEdgeParent'

describe('resolveVirtualEdgeParent', () => {
  it('nests lxc under proxmox (container-mode parent)', () => {
    const res = resolveVirtualEdgeParent(
      { id: 'lxc1', type: 'lxc' },
      { id: 'px1', type: 'proxmox' },
    )
    expect(res).toEqual({ childId: 'lxc1', parentId: 'px1' })
  })

  it('nests vm under proxmox regardless of edge direction', () => {
    const res = resolveVirtualEdgeParent(
      { id: 'px1', type: 'proxmox' },
      { id: 'vm1', type: 'vm' },
    )
    expect(res).toEqual({ childId: 'vm1', parentId: 'px1' })
  })

  it('nests docker_container under docker_host', () => {
    const res = resolveVirtualEdgeParent(
      { id: 'dc1', type: 'docker_container' },
      { id: 'dh1', type: 'docker_host' },
    )
    expect(res).toEqual({ childId: 'dc1', parentId: 'dh1' })
  })

  it('nests docker_container under lxc (reverse direction)', () => {
    const res = resolveVirtualEdgeParent(
      { id: 'lxc1', type: 'lxc' },
      { id: 'dc1', type: 'docker_container' },
    )
    expect(res).toEqual({ childId: 'dc1', parentId: 'lxc1' })
  })

  it('nests docker_container under lxc (forward direction)', () => {
    const res = resolveVirtualEdgeParent(
      { id: 'dc1', type: 'docker_container' },
      { id: 'lxc1', type: 'lxc' },
    )
    expect(res).toEqual({ childId: 'dc1', parentId: 'lxc1' })
  })

  it('nests docker_container under vm', () => {
    const res = resolveVirtualEdgeParent(
      { id: 'dc1', type: 'docker_container' },
      { id: 'vm1', type: 'vm' },
    )
    expect(res).toEqual({ childId: 'dc1', parentId: 'vm1' })
  })

  it('nests docker_container under proxmox (reverse direction)', () => {
    const res = resolveVirtualEdgeParent(
      { id: 'px1', type: 'proxmox' },
      { id: 'dc1', type: 'docker_container' },
    )
    expect(res).toEqual({ childId: 'dc1', parentId: 'px1' })
  })

  it('returns null when docker_container links to unsupported parent type', () => {
    const res = resolveVirtualEdgeParent(
      { id: 'dc1', type: 'docker_container' },
      { id: 'srv1', type: 'server' },
    )
    expect(res).toBeNull()
  })

  it('returns null for unrelated type pairs', () => {
    const res = resolveVirtualEdgeParent(
      { id: 'srv1', type: 'server' },
      { id: 'rt1', type: 'router' },
    )
    expect(res).toBeNull()
  })
})
