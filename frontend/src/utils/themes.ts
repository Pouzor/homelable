import type { NodeType, EdgeType, NodeStatus } from '@/types'

export type ThemeId = 'default' | 'dark' | 'light' | 'neon' | 'matrix'

export interface ThemeColors {
  // Per node-type accent (border + icon)
  nodeAccents: Record<NodeType, { border: string; icon: string }>
  // Node surfaces
  nodeCardBackground: string
  nodeIconBackground: string
  nodeLabelColor: string
  nodeSubtextColor: string
  // Status indicator dots
  statusColors: Record<NodeStatus, string>
  // Edges
  edgeColors: Record<EdgeType, string>
  edgeSelectedColor: string
  edgeLabelBackground: string
  edgeLabelColor: string
  edgeLabelBorder: string
  // Canvas
  canvasBackground: string
  canvasDotColor: string
  // React Flow handles
  handleBackground: string
  handleBorder: string
  // React Flow colorMode for built-in controls
  reactFlowColorMode: 'dark' | 'light'
}

export interface ThemePreset {
  id: ThemeId
  label: string
  description: string
  colors: ThemeColors
}

export const THEMES: Record<ThemeId, ThemePreset> = {
  default: {
    id: 'default',
    label: 'Default',
    description: 'Dark futuristic — the original Homelable look',
    colors: {
      nodeAccents: {
        isp:      { border: '#00d4ff', icon: '#00d4ff' },
        router:   { border: '#00d4ff', icon: '#00d4ff' },
        switch:   { border: '#39d353', icon: '#39d353' },
        server:   { border: '#a855f7', icon: '#a855f7' },
        proxmox:  { border: '#ff6e00', icon: '#ff6e00' },
        vm:       { border: '#a855f7', icon: '#a855f7' },
        lxc:      { border: '#00d4ff', icon: '#00d4ff' },
        nas:      { border: '#39d353', icon: '#39d353' },
        iot:      { border: '#e3b341', icon: '#e3b341' },
        ap:       { border: '#00d4ff', icon: '#00d4ff' },
        camera:   { border: '#8b949e', icon: '#8b949e' },
        printer:  { border: '#8b949e', icon: '#8b949e' },
        computer: { border: '#a855f7', icon: '#a855f7' },
        cpl:      { border: '#e3b341', icon: '#e3b341' },
        docker_host:   { border: '#2496ED', icon: '#2496ED' },
        generic:  { border: '#8b949e', icon: '#8b949e' },
        groupRect:{ border: '#00d4ff', icon: '#00d4ff' },
        group:    { border: '#00d4ff', icon: '#00d4ff' },
      },
      nodeCardBackground: '#21262d',
      nodeIconBackground: '#161b22',
      nodeLabelColor: '#e6edf3',
      nodeSubtextColor: '#8b949e',
      statusColors: {
        online:  '#39d353',
        offline: '#f85149',
        pending: '#e3b341',
        unknown: '#8b949e',
      },
      edgeColors: {
        ethernet: '#30363d',
        wifi:     '#00d4ff',
        iot:      '#e3b341',
        vlan:     '#00d4ff',
        virtual:  '#8b949e',
        cluster:  '#ff6e00',
      },
      edgeSelectedColor:  '#00d4ff',
      edgeLabelBackground:'#161b22',
      edgeLabelColor:     '#8b949e',
      edgeLabelBorder:    '#30363d',
      canvasBackground:   '#0d1117',
      canvasDotColor:     '#30363d',
      handleBackground:   '#30363d',
      handleBorder:       '#8b949e',
      reactFlowColorMode: 'dark',
    },
  },

  dark: {
    id: 'dark',
    label: 'Dark',
    description: 'Pure black with maximum contrast',
    colors: {
      nodeAccents: {
        isp:      { border: '#22d3ee', icon: '#22d3ee' },
        router:   { border: '#22d3ee', icon: '#22d3ee' },
        switch:   { border: '#4ade80', icon: '#4ade80' },
        server:   { border: '#c084fc', icon: '#c084fc' },
        proxmox:  { border: '#fb923c', icon: '#fb923c' },
        vm:       { border: '#c084fc', icon: '#c084fc' },
        lxc:      { border: '#22d3ee', icon: '#22d3ee' },
        nas:      { border: '#4ade80', icon: '#4ade80' },
        iot:      { border: '#fbbf24', icon: '#fbbf24' },
        ap:       { border: '#22d3ee', icon: '#22d3ee' },
        camera:   { border: '#94a3b8', icon: '#94a3b8' },
        printer:  { border: '#94a3b8', icon: '#94a3b8' },
        computer: { border: '#c084fc', icon: '#c084fc' },
        cpl:      { border: '#fbbf24', icon: '#fbbf24' },
        docker_host:   { border: '#2496ED', icon: '#2496ED' },
        generic:  { border: '#94a3b8', icon: '#94a3b8' },
        groupRect:{ border: '#22d3ee', icon: '#22d3ee' },
        group:    { border: '#22d3ee', icon: '#22d3ee' },
      },
      nodeCardBackground: '#0a0a0a',
      nodeIconBackground: '#111111',
      nodeLabelColor:     '#ffffff',
      nodeSubtextColor:   '#666666',
      statusColors: {
        online:  '#4ade80',
        offline: '#ef4444',
        pending: '#fbbf24',
        unknown: '#6b7280',
      },
      edgeColors: {
        ethernet: '#1c1c1e',
        wifi:     '#22d3ee',
        iot:      '#fbbf24',
        vlan:     '#22d3ee',
        virtual:  '#6b7280',
        cluster:  '#fb923c',
      },
      edgeSelectedColor:  '#22d3ee',
      edgeLabelBackground:'#111111',
      edgeLabelColor:     '#666666',
      edgeLabelBorder:    '#1c1c1e',
      canvasBackground:   '#000000',
      canvasDotColor:     '#1a1a1a',
      handleBackground:   '#1c1c1e',
      handleBorder:       '#444444',
      reactFlowColorMode: 'dark',
    },
  },

  light: {
    id: 'light',
    label: 'Light',
    description: 'Clean light theme with dark text',
    colors: {
      nodeAccents: {
        isp:      { border: '#0284c7', icon: '#0284c7' },
        router:   { border: '#0284c7', icon: '#0284c7' },
        switch:   { border: '#16a34a', icon: '#16a34a' },
        server:   { border: '#7c3aed', icon: '#7c3aed' },
        proxmox:  { border: '#ea580c', icon: '#ea580c' },
        vm:       { border: '#7c3aed', icon: '#7c3aed' },
        lxc:      { border: '#0284c7', icon: '#0284c7' },
        nas:      { border: '#16a34a', icon: '#16a34a' },
        iot:      { border: '#b45309', icon: '#b45309' },
        ap:       { border: '#0284c7', icon: '#0284c7' },
        camera:   { border: '#6b7280', icon: '#6b7280' },
        printer:  { border: '#6b7280', icon: '#6b7280' },
        computer: { border: '#7c3aed', icon: '#7c3aed' },
        cpl:      { border: '#b45309', icon: '#b45309' },
        docker_host:   { border: '#2496ED', icon: '#2496ED' },
        generic:  { border: '#6b7280', icon: '#6b7280' },
        groupRect:{ border: '#0284c7', icon: '#0284c7' },
        group:    { border: '#0284c7', icon: '#0284c7' },
      },
      nodeCardBackground: '#ffffff',
      nodeIconBackground: '#f0f6ff',
      nodeLabelColor:     '#1f2328',
      nodeSubtextColor:   '#57606a',
      statusColors: {
        online:  '#16a34a',
        offline: '#dc2626',
        pending: '#d97706',
        unknown: '#6b7280',
      },
      edgeColors: {
        ethernet: '#d0d7de',
        wifi:     '#0284c7',
        iot:      '#d97706',
        vlan:     '#0284c7',
        virtual:  '#9ca3af',
        cluster:  '#ea580c',
      },
      edgeSelectedColor:  '#0284c7',
      edgeLabelBackground:'#ffffff',
      edgeLabelColor:     '#57606a',
      edgeLabelBorder:    '#d0d7de',
      canvasBackground:   '#f6f8fa',
      canvasDotColor:     '#d0d7de',
      handleBackground:   '#d0d7de',
      handleBorder:       '#9ca3af',
      reactFlowColorMode: 'light',
    },
  },

  neon: {
    id: 'neon',
    label: 'Neon',
    description: 'Cyberpunk vibes with vivid glowing accents',
    colors: {
      nodeAccents: {
        isp:      { border: '#00ffff', icon: '#00ffff' },
        router:   { border: '#00ffff', icon: '#00ffff' },
        switch:   { border: '#00ff80', icon: '#00ff80' },
        server:   { border: '#ff00ff', icon: '#ff00ff' },
        proxmox:  { border: '#ff8800', icon: '#ff8800' },
        vm:       { border: '#ff00ff', icon: '#ff00ff' },
        lxc:      { border: '#00ffff', icon: '#00ffff' },
        nas:      { border: '#00ff80', icon: '#00ff80' },
        iot:      { border: '#ffff00', icon: '#ffff00' },
        ap:       { border: '#00ffff', icon: '#00ffff' },
        camera:   { border: '#8888ff', icon: '#8888ff' },
        printer:  { border: '#8888ff', icon: '#8888ff' },
        computer: { border: '#ff00ff', icon: '#ff00ff' },
        cpl:      { border: '#ffff00', icon: '#ffff00' },
        docker_host:   { border: '#00aaff', icon: '#00aaff' },
        generic:  { border: '#8888ff', icon: '#8888ff' },
        groupRect:{ border: '#00ffff', icon: '#00ffff' },
        group:    { border: '#00ffff', icon: '#00ffff' },
      },
      nodeCardBackground: '#0f0f2a',
      nodeIconBackground: '#0a0a1a',
      nodeLabelColor:     '#ffffff',
      nodeSubtextColor:   '#8888cc',
      statusColors: {
        online:  '#00ff80',
        offline: '#ff0040',
        pending: '#ffff00',
        unknown: '#8888cc',
      },
      edgeColors: {
        ethernet: '#1a1a3a',
        wifi:     '#00ffff',
        iot:      '#ffff00',
        vlan:     '#00ffff',
        virtual:  '#8888cc',
        cluster:  '#ff8800',
      },
      edgeSelectedColor:  '#00ffff',
      edgeLabelBackground:'#0a0a1a',
      edgeLabelColor:     '#8888cc',
      edgeLabelBorder:    '#1a1a3a',
      canvasBackground:   '#05050f',
      canvasDotColor:     '#1a1a3a',
      handleBackground:   '#1a1a3a',
      handleBorder:       '#8888cc',
      reactFlowColorMode: 'dark',
    },
  },

  matrix: {
    id: 'matrix',
    label: 'Matrix',
    description: 'Everything in terminal green',
    colors: {
      nodeAccents: {
        isp:      { border: '#00ff41', icon: '#00ff41' },
        router:   { border: '#00ff41', icon: '#00ff41' },
        switch:   { border: '#00cc33', icon: '#00cc33' },
        server:   { border: '#008822', icon: '#008822' },
        proxmox:  { border: '#33ff66', icon: '#33ff66' },
        vm:       { border: '#008822', icon: '#008822' },
        lxc:      { border: '#00ff41', icon: '#00ff41' },
        nas:      { border: '#00cc33', icon: '#00cc33' },
        iot:      { border: '#66ff33', icon: '#66ff33' },
        ap:       { border: '#00ff41', icon: '#00ff41' },
        camera:   { border: '#005500', icon: '#005500' },
        printer:  { border: '#005500', icon: '#005500' },
        computer: { border: '#008822', icon: '#008822' },
        cpl:      { border: '#66ff33', icon: '#66ff33' },
        docker_host:   { border: '#00cc88', icon: '#00cc88' },
        generic:  { border: '#006600', icon: '#006600' },
        groupRect:{ border: '#00ff41', icon: '#00ff41' },
        group:    { border: '#00ff41', icon: '#00ff41' },
      },
      nodeCardBackground: '#001100',
      nodeIconBackground: '#002200',
      nodeLabelColor:     '#00ff41',
      nodeSubtextColor:   '#006600',
      statusColors: {
        online:  '#00ff41',
        offline: '#ff0000',
        pending: '#88ff00',
        unknown: '#004400',
      },
      edgeColors: {
        ethernet: '#003300',
        wifi:     '#00ff41',
        iot:      '#66ff33',
        vlan:     '#00cc33',
        virtual:  '#004400',
        cluster:  '#33ff66',
      },
      edgeSelectedColor:  '#00ff41',
      edgeLabelBackground:'#001100',
      edgeLabelColor:     '#006600',
      edgeLabelBorder:    '#003300',
      canvasBackground:   '#000000',
      canvasDotColor:     '#002200',
      handleBackground:   '#003300',
      handleBorder:       '#006600',
      reactFlowColorMode: 'dark',
    },
  },
}

// Ordered list for display in the modal
export const THEME_ORDER: ThemeId[] = ['default', 'dark', 'light', 'neon', 'matrix']
