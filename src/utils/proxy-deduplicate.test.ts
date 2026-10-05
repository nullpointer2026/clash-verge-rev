import { describe, expect, it } from "vitest"
import {
  areProxiesEqualConfig,
  deduplicateAndMergeProxies,
  getUniqueProxyName,
} from "./proxy-deduplicate"

describe("proxy-deduplicate", () => {
  it("compares proxy configurations correctly", () => {
    const p1 = {
      name: "Node 1",
      type: "vless",
      server: "14.17.78.146",
      port: 14343,
      uuid: "uuid-1",
      tls: true,
    } as any

    const p2 = {
      name: "Node 1 - Alias",
      type: "vless",
      server: "14.17.78.146",
      port: 14343,
      uuid: "uuid-1",
      tls: true,
    } as any

    const p3 = {
      name: "Node 1",
      type: "vless",
      server: "27.155.117.209",
      port: 14343,
      uuid: "uuid-1",
      tls: true,
    } as any

    expect(areProxiesEqualConfig(p1, p2)).toBe(true)
    expect(areProxiesEqualConfig(p1, p3)).toBe(false)
  })

  it("generates unique names properly", () => {
    const existing = new Set(["Node A", "Node A (1)"])
    expect(getUniqueProxyName("Node B", existing)).toBe("Node B")
    expect(getUniqueProxyName("Node A", existing)).toBe("Node A (2)")
    expect(getUniqueProxyName("Node A (1)", existing)).toBe("Node A (2)")
  })

  it("handles user case 1: same name, different server -> auto rename and preserve", () => {
    const local = [
      { name: "Node A", type: "vless", server: "1.1.1.1", port: 443 } as any,
    ]
    const incoming = [
      { name: "Node A", type: "vless", server: "2.2.2.2", port: 443 } as any,
    ]

    const result = deduplicateAndMergeProxies(incoming, local)
    expect(result.addedProxies).toHaveLength(1)
    expect(result.addedProxies[0].name).toBe("Node A (1)")
    expect(result.addedProxies[0].server).toBe("2.2.2.2")
    expect(result.renamedCount).toBe(1)
    expect(result.skippedCount).toBe(0)
  })

  it("handles user case 2: local ABC, add ABCDEFG -> only add DEFG", () => {
    const local = [
      { name: "A", type: "vless", server: "1.1.1.1", port: 443 } as any,
      { name: "B", type: "vless", server: "1.1.1.2", port: 443 } as any,
      { name: "C", type: "vless", server: "1.1.1.3", port: 443 } as any,
    ]

    const incoming = [
      { name: "A", type: "vless", server: "1.1.1.1", port: 443 } as any,
      { name: "B", type: "vless", server: "1.1.1.2", port: 443 } as any,
      { name: "C", type: "vless", server: "1.1.1.3", port: 443 } as any,
      { name: "D", type: "vless", server: "1.1.1.4", port: 443 } as any,
      { name: "E", type: "vless", server: "1.1.1.5", port: 443 } as any,
      { name: "F", type: "vless", server: "1.1.1.6", port: 443 } as any,
      { name: "G", type: "vless", server: "1.1.1.7", port: 443 } as any,
    ]

    const result = deduplicateAndMergeProxies(incoming, local)
    expect(result.addedProxies).toHaveLength(4)
    expect(result.addedProxies.map((p) => p.name)).toEqual(["D", "E", "F", "G"])
    expect(result.skippedCount).toBe(3)
    expect(result.renamedCount).toBe(0)
  })

  it("handles internal duplicates within the batch", () => {
    const local = [] as any[]
    const incoming = [
      { name: "A", type: "vless", server: "1.1.1.1", port: 443 } as any,
      { name: "A", type: "vless", server: "1.1.1.1", port: 443 } as any,
      { name: "A", type: "vless", server: "2.2.2.2", port: 443 } as any,
    ]

    const result = deduplicateAndMergeProxies(incoming, local)
    expect(result.addedProxies).toHaveLength(2)
    expect(result.addedProxies[0].name).toBe("A")
    expect(result.addedProxies[1].name).toBe("A (1)")
    expect(result.skippedCount).toBe(1)
    expect(result.renamedCount).toBe(1)
  })
})
