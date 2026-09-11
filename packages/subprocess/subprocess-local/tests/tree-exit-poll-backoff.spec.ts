import { describe, expect, it } from 'vitest'
import { treeExitPollDelayMs } from '../src/spawn.ts'

const FAST_PROBES = 20

describe('tree-exit wait cadence', () => {
  it('probes at the fast cadence while a direct child is expected to exit', () => {
    for (let probe = 0; probe < FAST_PROBES; probe++) expect(treeExitPollDelayMs(probe)).toBe(15)
  })

  it('doubles the interval once the wait outlives the fast window', () => {
    expect([
      treeExitPollDelayMs(20),
      treeExitPollDelayMs(21),
      treeExitPollDelayMs(22),
      treeExitPollDelayMs(23),
      treeExitPollDelayMs(24),
      treeExitPollDelayMs(25),
    ]).toEqual([30, 60, 120, 240, 480, 960])
  })

  it('holds an orphan tail at one probe per second', () => {
    for (const probe of [26, 30, 100, 10_000]) expect(treeExitPollDelayMs(probe)).toBe(1000)
  })

  it('never schedules a non-positive interval', () => {
    for (const probe of [-1, 0, 1, 19, 20, 26, 1_000_000]) {
      expect(treeExitPollDelayMs(probe)).toBeGreaterThan(0)
    }
  })
})
