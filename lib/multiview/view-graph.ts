/**
 * Phase 49: View Graph Construction
 * 
 * Builds a multi-view graph from image sets.
 * Identifies strong connected subsets and weak/outlier views.
 */

import type {
  ViewGraph,
  ViewGraphNode,
  ViewGraphEdge,
  AngleClass,
  MeasurementFamily,
  PairMatchResult,
} from './types'
import type { Measurements, LandmarksDetected } from '@/lib/types'
import { scoreAllPairs, getFamilyAnglePreference } from './pair-matcher'

// ============================================================================
// CONSTANTS
// ============================================================================

const MIN_EDGE_WEIGHT_FOR_CONNECTIVITY = 0.35
const OUTLIER_SCORE_THRESHOLD = 0.3
const MIN_ACCEPTED_EDGES_PER_VIEW = 1
const MIN_SUBGRAPH_SIZE = 2

// ============================================================================
// VIEW SCORING
// ============================================================================

interface ViewInput {
  imageIndex: number
  angleClass: AngleClass
  landmarks: LandmarksDetected
  measurements: Partial<Measurements>
  referenceQuality: number
  landmarkConfidence: number
}

/**
 * Compute overall score for a view based on its quality metrics
 */
function computeViewScore(view: ViewInput): number {
  const refQuality = view.referenceQuality
  const landmarkConf = view.landmarkConfidence
  
  // Base score from reference quality and landmark confidence
  let score = refQuality * 0.4 + landmarkConf * 0.3

  // Bonus for useful angles
  if (view.angleClass === 'front' || view.angleClass === 'left' || view.angleClass === 'right') {
    score += 0.2
  } else if (view.angleClass === 'front_left' || view.angleClass === 'front_right') {
    score += 0.1
  }

  // Penalty for unknown angle
  if (view.angleClass === 'unknown') {
    score -= 0.2
  }

  return Math.max(0, Math.min(1, score))
}

/**
 * Compute per-family contribution scores for a view
 */
function computeFamilyContributions(view: ViewInput): Record<MeasurementFamily, number> {
  const contributions: Record<MeasurementFamily, number> = { spread: 0, beam: 0, tine: 0, mass: 0, deduction: 0 }
  const families: MeasurementFamily[] = ['spread', 'beam', 'tine', 'mass']

  for (const family of families) {
    // Base contribution from angle preference
    const anglePreference = getFamilyAnglePreference(family, view.angleClass)
    
    // Weighted by reference quality
    const contribution = anglePreference * 0.5 + view.referenceQuality * 0.3 + view.landmarkConfidence * 0.2
    
    contributions[family] = Math.max(0, Math.min(1, contribution))
  }

  return contributions
}

// ============================================================================
// GRAPH CONSTRUCTION
// ============================================================================

/**
 * Build a view graph from a set of views
 */
export function buildViewGraph(views: ViewInput[]): ViewGraph {
  if (views.length === 0) {
    return {
      nodes: [],
      edges: [],
      connectivity: 0,
      strongestSubgraph: [],
      isolatedNodes: [],
      acceptedEdgeCount: 0,
      totalEdgeCount: 0,
    }
  }

  // Build nodes
  const nodes: ViewGraphNode[] = views.map((view, index) => ({
    viewId: `view_${index}`,
    imageIndex: view.imageIndex,
    angleClass: view.angleClass,
    overallScore: computeViewScore(view),
    isAccepted: true, // Will be updated based on graph analysis
    isOutlier: false,
    familyContributions: computeFamilyContributions(view),
  }))

  // Score all pairs
  const pairResults = scoreAllPairs(views)

  // Build edges
  const edges: ViewGraphEdge[] = pairResults.map((pair, index) => ({
    edgeId: `edge_${index}`,
    viewAId: `view_${pair.viewAIndex}`,
    viewBId: `view_${pair.viewBIndex}`,
    weight: pair.result.matchQuality,
    isAccepted: pair.result.isUsableForFusion,
    matchQuality: pair.result.matchQuality,
    familyAgreement: pair.result.familyAgreement,
  }))

  // Compute connectivity
  const acceptedEdges = edges.filter(e => e.isAccepted)
  const connectivity = computeGraphConnectivity(nodes, acceptedEdges)

  // Find strongest subgraph
  const strongestSubgraph = findStrongestSubgraph(nodes, acceptedEdges)

  // Identify isolated nodes
  const connectedNodes = new Set<string>()
  for (const edge of acceptedEdges) {
    connectedNodes.add(edge.viewAId)
    connectedNodes.add(edge.viewBId)
  }
  const isolatedNodes = nodes
    .filter(n => !connectedNodes.has(n.viewId))
    .map(n => n.viewId)

  // Detect outliers
  detectOutliers(nodes, edges)

  // Update acceptance based on outlier status
  for (const node of nodes) {
    if (node.isOutlier) {
      node.isAccepted = false
    }
  }

  return {
    nodes,
    edges,
    connectivity,
    strongestSubgraph,
    isolatedNodes,
    acceptedEdgeCount: acceptedEdges.length,
    totalEdgeCount: edges.length,
  }
}

// ============================================================================
// CONNECTIVITY ANALYSIS
// ============================================================================

/**
 * Compute graph connectivity score (0-1)
 */
function computeGraphConnectivity(nodes: ViewGraphNode[], acceptedEdges: ViewGraphEdge[]): number {
  if (nodes.length <= 1) {
    return nodes.length === 1 ? 1.0 : 0
  }

  // Count edges per node
  const edgeCountPerNode = new Map<string, number>()
  for (const node of nodes) {
    edgeCountPerNode.set(node.viewId, 0)
  }

  for (const edge of acceptedEdges) {
    edgeCountPerNode.set(edge.viewAId, (edgeCountPerNode.get(edge.viewAId) || 0) + 1)
    edgeCountPerNode.set(edge.viewBId, (edgeCountPerNode.get(edge.viewBId) || 0) + 1)
  }

  // Compute average connectivity
  const edgeCounts = [...edgeCountPerNode.values()]
  const avgEdges = edgeCounts.reduce((a, b) => a + b, 0) / edgeCounts.length
  const maxPossibleEdges = nodes.length - 1

  // Also check if graph is fully connected using union-find
  const isFullyConnected = checkFullyConnected(nodes, acceptedEdges)
  const connectivityBonus = isFullyConnected ? 0.2 : 0

  return Math.min(1, avgEdges / maxPossibleEdges + connectivityBonus)
}

/**
 * Check if all nodes are connected using union-find
 */
function checkFullyConnected(nodes: ViewGraphNode[], edges: ViewGraphEdge[]): boolean {
  if (nodes.length <= 1) return true

  // Union-find
  const parent = new Map<string, string>()
  
  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x)
    if (parent.get(x) !== x) {
      parent.set(x, find(parent.get(x)!))
    }
    return parent.get(x)!
  }

  function union(x: string, y: string): void {
    const px = find(x)
    const py = find(y)
    if (px !== py) {
      parent.set(px, py)
    }
  }

  // Initialize
  for (const node of nodes) {
    parent.set(node.viewId, node.viewId)
  }

  // Union connected nodes
  for (const edge of edges) {
    union(edge.viewAId, edge.viewBId)
  }

  // Check if all nodes have the same root
  const roots = new Set(nodes.map(n => find(n.viewId)))
  return roots.size === 1
}

// ============================================================================
// SUBGRAPH ANALYSIS
// ============================================================================

/**
 * Find the strongest connected subgraph
 * Uses weighted connectivity to prefer high-quality edges
 */
function findStrongestSubgraph(nodes: ViewGraphNode[], acceptedEdges: ViewGraphEdge[]): string[] {
  if (nodes.length <= 1) {
    return nodes.map(n => n.viewId)
  }

  if (acceptedEdges.length === 0) {
    // No edges - return best single node
    const bestNode = nodes.reduce((best, node) => 
      node.overallScore > best.overallScore ? node : best
    )
    return [bestNode.viewId]
  }

  // Find connected components
  const components = findConnectedComponents(nodes, acceptedEdges)

  // Score each component by average edge weight and node quality
  let bestComponent: string[] = []
  let bestScore = -1

  for (const component of components) {
    if (component.length < MIN_SUBGRAPH_SIZE) continue

    // Compute component score
    const componentNodes = nodes.filter(n => component.includes(n.viewId))
    const avgNodeScore = componentNodes.reduce((sum, n) => sum + n.overallScore, 0) / componentNodes.length

    const componentEdges = acceptedEdges.filter(
      e => component.includes(e.viewAId) && component.includes(e.viewBId)
    )
    const avgEdgeWeight = componentEdges.length > 0
      ? componentEdges.reduce((sum, e) => sum + e.weight, 0) / componentEdges.length
      : 0

    const score = avgNodeScore * 0.4 + avgEdgeWeight * 0.4 + (component.length / nodes.length) * 0.2

    if (score > bestScore) {
      bestScore = score
      bestComponent = component
    }
  }

  // If no valid component found, return all connected nodes
  if (bestComponent.length === 0) {
    const connectedNodes = new Set<string>()
    for (const edge of acceptedEdges) {
      connectedNodes.add(edge.viewAId)
      connectedNodes.add(edge.viewBId)
    }
    return [...connectedNodes]
  }

  return bestComponent
}

/**
 * Find connected components using BFS
 */
function findConnectedComponents(nodes: ViewGraphNode[], edges: ViewGraphEdge[]): string[][] {
  const adjacency = new Map<string, Set<string>>()
  
  for (const node of nodes) {
    adjacency.set(node.viewId, new Set())
  }

  for (const edge of edges) {
    adjacency.get(edge.viewAId)?.add(edge.viewBId)
    adjacency.get(edge.viewBId)?.add(edge.viewAId)
  }

  const visited = new Set<string>()
  const components: string[][] = []

  for (const node of nodes) {
    if (visited.has(node.viewId)) continue

    const component: string[] = []
    const queue = [node.viewId]

    while (queue.length > 0) {
      const current = queue.shift()!
      if (visited.has(current)) continue
      
      visited.add(current)
      component.push(current)

      const neighbors = adjacency.get(current) || new Set()
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor)
        }
      }
    }

    if (component.length > 0) {
      components.push(component)
    }
  }

  return components
}

// ============================================================================
// OUTLIER DETECTION
// ============================================================================

/**
 * Detect outlier views that strongly disagree with the coherent graph
 */
function detectOutliers(nodes: ViewGraphNode[], edges: ViewGraphEdge[]): void {
  // Compute edge quality distribution for each node
  const nodeEdgeQualities = new Map<string, number[]>()
  
  for (const node of nodes) {
    nodeEdgeQualities.set(node.viewId, [])
  }

  for (const edge of edges) {
    nodeEdgeQualities.get(edge.viewAId)?.push(edge.matchQuality)
    nodeEdgeQualities.get(edge.viewBId)?.push(edge.matchQuality)
  }

  // Compute average edge quality for each node
  const nodeAvgQuality = new Map<string, number>()
  for (const [viewId, qualities] of nodeEdgeQualities) {
    const avg = qualities.length > 0 
      ? qualities.reduce((a, b) => a + b, 0) / qualities.length 
      : 0
    nodeAvgQuality.set(viewId, avg)
  }

  // Compute global statistics
  const allQualities = [...nodeAvgQuality.values()].filter(q => q > 0)
  if (allQualities.length < 2) return

  const mean = allQualities.reduce((a, b) => a + b, 0) / allQualities.length
  const variance = allQualities.reduce((sum, q) => sum + Math.pow(q - mean, 2), 0) / allQualities.length
  const stdDev = Math.sqrt(variance)

  // Mark outliers
  for (const node of nodes) {
    const quality = nodeAvgQuality.get(node.viewId) || 0
    
    // Check if this node has very low edge quality compared to others
    if (quality < mean - 2 * stdDev || quality < OUTLIER_SCORE_THRESHOLD) {
      node.isOutlier = true
      node.isAccepted = false
    }

    // Also check edge count
    const edgeCount = nodeEdgeQualities.get(node.viewId)?.length || 0
    if (edgeCount === 0 && nodes.length > 1) {
      node.isOutlier = true
      node.isAccepted = false
    }
  }
}

// ============================================================================
// GRAPH ANALYSIS UTILITIES
// ============================================================================

/**
 * Get summary statistics for a view graph
 */
export function getGraphSummary(graph: ViewGraph): {
  nodeCount: number
  acceptedNodeCount: number
  edgeCount: number
  acceptedEdgeCount: number
  connectivity: number
  strongestSubgraphSize: number
  outlierCount: number
  isolatedCount: number
  avgEdgeWeight: number
  avgNodeScore: number
} {
  const acceptedNodes = graph.nodes.filter(n => n.isAccepted)
  const acceptedEdges = graph.edges.filter(e => e.isAccepted)
  
  return {
    nodeCount: graph.nodes.length,
    acceptedNodeCount: acceptedNodes.length,
    edgeCount: graph.edges.length,
    acceptedEdgeCount: acceptedEdges.length,
    connectivity: graph.connectivity,
    strongestSubgraphSize: graph.strongestSubgraph.length,
    outlierCount: graph.nodes.filter(n => n.isOutlier).length,
    isolatedCount: graph.isolatedNodes.length,
    avgEdgeWeight: acceptedEdges.length > 0
      ? acceptedEdges.reduce((sum, e) => sum + e.weight, 0) / acceptedEdges.length
      : 0,
    avgNodeScore: acceptedNodes.length > 0
      ? acceptedNodes.reduce((sum, n) => sum + n.overallScore, 0) / acceptedNodes.length
      : 0,
  }
}

/**
 * Get per-family support from the graph
 */
export function getFamilySupport(graph: ViewGraph): Record<MeasurementFamily, {
  primaryViewId: string | null
  secondaryViewIds: string[]
  totalSupport: number
}> {
  const families: MeasurementFamily[] = ['spread', 'beam', 'tine', 'mass']
  const support: Record<MeasurementFamily, { primaryViewId: string | null; secondaryViewIds: string[]; totalSupport: number }> = {
    spread: { primaryViewId: null, secondaryViewIds: [], totalSupport: 0 },
    beam: { primaryViewId: null, secondaryViewIds: [], totalSupport: 0 },
    tine: { primaryViewId: null, secondaryViewIds: [], totalSupport: 0 },
    mass: { primaryViewId: null, secondaryViewIds: [], totalSupport: 0 },
    deduction: { primaryViewId: null, secondaryViewIds: [], totalSupport: 0 },
  }

  const acceptedNodes = graph.nodes.filter(n => n.isAccepted && !n.isOutlier)

  for (const family of families) {
    // Sort nodes by family contribution
    const sortedNodes = [...acceptedNodes].sort(
      (a, b) => b.familyContributions[family] - a.familyContributions[family]
    )

    if (sortedNodes.length > 0) {
      support[family].primaryViewId = sortedNodes[0].viewId
      support[family].secondaryViewIds = sortedNodes.slice(1).map(n => n.viewId)
      support[family].totalSupport = sortedNodes.reduce(
        (sum, n) => sum + n.familyContributions[family], 0
      )
    }
  }

  return support
}
