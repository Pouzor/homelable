import { describe, it, expect } from 'vitest'
import { resolveVirtualEdgeParent, getValidParentTypes } from '../virtualEdgeParent'

describe('getValidParentTypes', () => {
  it('returns container-mode types for lxc', () => {
    expect(getValidParentTypes('lxc')).toEqual(['proxmox', 'vm', 'lxc', 'docker_host'])
  })

  it('returns container-mode types for vm', () => {
    expect(getValidParentTypes('vm')).toEqual(['proxmox', 'vm', 'lxc', 'docker_host'])
  })

  it('returns docker_host/lxc/vm/proxmox for docker_container', () => {
    expect(getValidParentTypes('docker_container')).toEqual(['docker_host', 'lxc', 'vm', 'proxmox'])
  })

  it('returns empty list for types that cannot have a parent', () => {
    expect(getValidParentTypes('server')).toEqual([])
    expect(getValidParentTypes('router')).toEqual([])
    expect(getValidParentTypes('proxmox')).toEqual([])
    expect(getValidParentTypes('docker_host')).toEqual([])
  })
})

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
