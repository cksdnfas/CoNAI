import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { PostCategory } from '@conai/shared'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { POSTS_QUERY_KEY, createPostCategory, deletePostCategory, updatePostCategory } from '@/lib/api-posts'
import { getErrorMessage } from '@/lib/error-message'
import { flattenCategories } from './post-editor'

/** Create (`category` null, under `parentId`) or rename / move / delete a category. Administrators only. */
export function PostCategoryDialog({ category, parentId, categories, onClose, onDeleted }: {
  category: PostCategory | null
  parentId: number | null
  categories: PostCategory[]
  onClose: () => void
  onDeleted?: (category: PostCategory) => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [name, setName] = useState(category?.name ?? '')
  const [parent, setParent] = useState<number | null>(category ? category.parentId : parentId)
  // A category cannot move under itself or its own children.
  const blocked = useMemo(() => {
    if (!category) return new Set<number>()
    const out = new Set([category.id])
    let grew = true
    while (grew) {
      grew = false
      for (const item of categories) {
        if (item.parentId !== null && out.has(item.parentId) && !out.has(item.id)) { out.add(item.id); grew = true }
      }
    }
    return out
  }, [category, categories])
  const onError = (error: unknown) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '카테고리를 저장하지 못했어.', en: 'Could not save the category.' })) })
  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] })
    onClose()
  }
  const save = useMutation({
    mutationFn: () => category ? updatePostCategory(category.id, { name, parentId: parent }) : createPostCategory({ name, parentId: parent }),
    onSuccess: done,
    onError,
  })
  const remove = useMutation({
    mutationFn: () => deletePostCategory((category as PostCategory).id),
    onSuccess: async () => {
      onDeleted?.(category as PostCategory)
      await done()
    },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '카테고리를 지우지 못했어.', en: 'Could not delete the category.' })) }),
  })
  const busy = save.isPending || remove.isPending

  return (
    <Modal open title={category ? t({ ko: '카테고리 고치기', en: 'Edit category' }) : t({ ko: '새 카테고리', en: 'New category' })} onClose={() => { if (!busy) onClose() }} widthClassName="max-w-md">
      <form onSubmit={(event) => { event.preventDefault(); if (name.trim() && !busy) save.mutate() }}>
        <ModalBody className="space-y-3">
          <Input variant="settings" autoFocus value={name} onChange={(event) => setName(event.target.value)} aria-label={t({ ko: '이름', en: 'Name' })} placeholder={t({ ko: '이름', en: 'Name' })} />
          <Select variant="settings" aria-label={t({ ko: '상위 카테고리', en: 'Parent category' })} value={parent ?? ''} onChange={(event) => setParent(event.target.value ? Number(event.target.value) : null)}>
            <option value="">{t({ ko: '최상위', en: 'Top level' })}</option>
            {flattenCategories(categories).map(({ category: item, depth }) => (
              <option key={item.id} value={item.id} disabled={blocked.has(item.id)}>{`${'　'.repeat(depth)}${item.name}`}</option>
            ))}
          </Select>
        </ModalBody>
        <ModalFooter>
          {category ? (
            <Button type="button" variant="destructive-ghost" disabled={busy} onClick={async () => {
              if (await confirm({ title: t({ ko: '"{name}" 카테고리를 지울까?', en: 'Delete "{name}"?' }, { name: category.name }), description: t({ ko: '글과 하위 카테고리가 없을 때만 지울 수 있어.', en: 'Only empty categories can be deleted.' }), tone: 'destructive' })) remove.mutate()
            }}>
              <Trash2 />{t({ ko: '지우기', en: 'Delete' })}
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button type="submit" disabled={!name.trim() || busy}>{t({ ko: '저장', en: 'Save' })}</Button>
        </ModalFooter>
      </form>
    </Modal>
  )
}
