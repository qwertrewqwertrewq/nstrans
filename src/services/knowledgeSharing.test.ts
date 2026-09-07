import { describe, expect, it, vi } from 'vitest'
import { CommunityContributionQueue, isShareableContribution } from './knowledgeSharing'

describe('CommunityContributionQueue', () => {
  it('is opt-in and never queues local knowledge before consent', () => {
    const queue = new CommunityContributionQueue()
    queue.enqueue({ gameId: 'general', kind: 'translation', source: '設定', target: '设置', provenance: 'translategemma' })
    expect(queue.pendingCount()).toBe(0)
    queue.setEnabled(true)
    queue.enqueue({ gameId: 'general', kind: 'translation', source: '設定', target: '设置', provenance: 'translategemma' })
    expect(queue.pendingCount()).toBe(1)
  })

  it('uploads only through an explicitly supplied future server adapter', async () => {
    const queue = new CommunityContributionQueue(), upload = vi.fn(async (items) => ({ acceptedIds: items.map(({ id }: { id: string }) => id) }))
    queue.setEnabled(true); queue.enqueue({ gameId: 'zelda-totk', kind: 'term', source: 'ハイラル', target: '海拉鲁', provenance: 'wikimedia', sourceUrl: 'https://www.wikidata.org/entity/Q1' })
    expect(await queue.flush({ upload })).toBe(1)
    expect(upload).toHaveBeenCalledOnce(); expect(queue.pendingCount()).toBe(0)
  })

  it('allows reusable labels but rejects dialogue and unverified Wikimedia claims', () => {
    expect(isShareableContribution({ kind: 'translation', source: '設定', target: '设置', provenance: 'translategemma' })).toBe(true)
    expect(isShareableContribution({ kind: 'translation', source: 'はい', target: '是', provenance: 'translategemma' })).toBe(true)
    expect(isShareableContribution({ kind: 'translation', source: '今日は楽しい', target: '今天很开心', provenance: 'translategemma' })).toBe(false)
    expect(isShareableContribution({ kind: 'translation', source: 'どこへ行くの？', target: '要去哪里？', provenance: 'translategemma' })).toBe(false)
    expect(isShareableContribution({ kind: 'term', source: 'ハイラル', target: '海拉鲁', provenance: 'wikimedia' })).toBe(false)
    expect(isShareableContribution({ kind: 'translation', source: '・スタンプノマップピン', target: '地图图钉', provenance: 'translategemma' })).toBe(false)
    expect(isShareableContribution({ kind: 'translation', source: 'ズーム(', target: '缩放', provenance: 'translategemma' })).toBe(false)
    expect(isShareableContribution({ kind: 'translation', source: '移動(', target: '移动', provenance: 'translategemma' })).toBe(false)
  })
})
