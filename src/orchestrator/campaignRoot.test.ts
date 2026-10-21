import { describe, expect, it } from "bun:test"
import { campaignRoot } from "./runLoop"

describe("campaignRoot", () => {
  it("derives the matmul campaign from an attempts path", () => {
    const root = campaignRoot("src/matmul/attempts/T11_solution.ts")

    expect(root).toBe("src/matmul")
  })

  it("derives a new campaign from an attempts path", () => {
    const root = campaignRoot("src/sortnet/attempts/x.ts")

    expect(root).toBe("src/sortnet")
  })

  it("treats the first directory under src as the campaign", () => {
    const root = campaignRoot("src/problems/problem01.ts")

    expect(root).toBe("src/problems")
  })

  it("uses the legacy matmul campaign outside src", () => {
    const root = campaignRoot("attempts/x.ts")

    expect(root).toBe("src/matmul")
  })

  it("keeps all M5 campaign paths byte-identical", () => {
    const root = campaignRoot("src/matmul/attempts/T11_solution.ts")
    const paths = {
      scoreboard: `${root}/scoreboard.ts`,
      campaign: `${root}/CAMPAIGN.md`,
      prompt: `${root}/prompts/T11.md`,
    }

    expect(paths).toEqual({
      scoreboard: "src/matmul/scoreboard.ts",
      campaign: "src/matmul/CAMPAIGN.md",
      prompt: "src/matmul/prompts/T11.md",
    })
  })
})
