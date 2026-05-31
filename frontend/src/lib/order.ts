import { pb } from './pb'

// Next order value = (max order among matching siblings) + 1, so new items append to the end.
export async function nextOrder(collection: string, filter = ''): Promise<number> {
  try {
    const res = await pb.collection(collection).getList(1, 1, {
      sort: '-order',
      filter,
      requestKey: null,
    })
    const top = res.items[0] as { order?: number } | undefined
    return (top?.order ?? 0) + 1
  } catch {
    return 1
  }
}
