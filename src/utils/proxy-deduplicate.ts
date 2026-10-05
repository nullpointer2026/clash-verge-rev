/**
 * 节点批量导入防重与同名不同服务器自动保留工具模块
 */

/**
 * 规范化对象序列化（排除 name 以及空值，用于严格比对节点连接配置）
 */
function canonicalStringify(obj: any): string {
  if (!obj || typeof obj !== "object") {
    return String(obj)
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalStringify).join(",")}]`
  }
  const sortedKeys = Object.keys(obj)
    .filter((k) => k !== "name" && k !== "id" && obj[k] !== undefined && obj[k] !== null && obj[k] !== "")
    .sort()

  const parts = sortedKeys.map((k) => {
    const val = obj[k]
    const valStr = typeof val === "object" ? canonicalStringify(val) : JSON.stringify(val)
    return `${JSON.stringify(k)}:${valStr}`
  })
  return `{${parts.join(",")}}`
}

/**
 * 比较两个节点的核心服务器连接配置是否完全相同
 * 忽略节点名称（name），比对协议类型、服务器地址、端口及凭证/传输配置
 */
export function areProxiesEqualConfig(a: IProxyConfig, b: IProxyConfig): boolean {
  if (!a || !b) return false
  if (a.type !== b.type) return false

  const serverA = String(a.server || "").trim().toLowerCase()
  const serverB = String(b.server || "").trim().toLowerCase()
  if (serverA !== serverB) return false

  if (Number(a.port) !== Number(b.port)) return false

  return canonicalStringify(a) === canonicalStringify(b)
}

/**
 * 为重名但不同配置的节点生成唯一名称
 * 例如：如果 "节点A" 已存在，返回 "节点A (1)"；如果 "节点A (1)" 也存在，返回 "节点A (2)"
 */
export function getUniqueProxyName(baseName: string, existingNames: Set<string>): string {
  if (!existingNames.has(baseName)) {
    return baseName
  }

  // 若原有名称本身已带 (N) 编号，则解析出基础名称并在其编号上递增
  const match = baseName.match(/^(.*) \((\d+)\)$/)
  const cleanBase = match ? match[1] : baseName
  let index = match ? parseInt(match[2], 10) + 1 : 1

  let candidate = `${cleanBase} (${index})`
  while (existingNames.has(candidate)) {
    index++
    candidate = `${cleanBase} (${index})`
  }
  return candidate
}

export interface DeduplicateResult {
  addedProxies: IProxyConfig[]
  skippedCount: number
  renamedCount: number
  totalParsed: number
}

/**
 * 批量处理待添加节点：
 * 1. 遇到同名不同服务器：自动重命名编号保留（例如 "节点A (1)"），确保两台服务器都可用且不会触发内核重名冲突
 * 2. 遇到完全相同的重复节点（同名且配置相同）：自动跳过，避免重复添加（满足本地ABC，添加ABCDEFG只添加DEFG）
 */
export function deduplicateAndMergeProxies(
  newProxies: IProxyConfig[],
  existingProxies: IProxyConfig[],
): DeduplicateResult {
  const addedProxies: IProxyConfig[] = []
  let skippedCount = 0
  let renamedCount = 0

  // 记录所有已知节点对象与节点名称集合（包含已有节点及本次批量中已接受的节点）
  const allKnownProxies: IProxyConfig[] = [...existingProxies]
  const allKnownNames = new Set<string>(
    existingProxies
      .map((p) => p.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0),
  )

  for (const proxy of newProxies) {
    if (!proxy || !proxy.name) continue

    // 复制一份副本，避免污染原引用
    const proxyItem: IProxyConfig = { ...proxy }

    // 规则 2：检查是否存在同名且配置完全相同的完全重复节点
    const isExactDuplicate = allKnownProxies.some(
      (existing) => existing.name === proxyItem.name && areProxiesEqualConfig(existing, proxyItem),
    )

    if (isExactDuplicate) {
      skippedCount++
      continue
    }

    // 规则 1：检查是否名称冲突（同名不同服务器，或者同批次内重名）
    if (allKnownNames.has(proxyItem.name)) {
      const uniqueName = getUniqueProxyName(proxyItem.name, allKnownNames)
      proxyItem.name = uniqueName
      renamedCount++
    }

    allKnownNames.add(proxyItem.name)
    allKnownProxies.push(proxyItem)
    addedProxies.push(proxyItem)
  }

  return {
    addedProxies,
    skippedCount,
    renamedCount,
    totalParsed: newProxies.length,
  }
}
