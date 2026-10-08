export type CommunityGrounding = { sources: { title: string; url: string }[]; renderedContent?: string }
let current: CommunityGrounding | undefined
const listeners = new Set<() => void>()
export const getCommunityGrounding = () => current
export function subscribeCommunityGrounding(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function setCommunityGrounding(value?: CommunityGrounding) {
  current = value
  for (const listener of listeners) listener()
}
