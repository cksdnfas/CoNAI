export type ExactTextEdit = {
  find: string
  replace: string
  all?: boolean
}

/** Apply ordered literal edits; a missing or ambiguous match rejects the whole draft. */
export function replaceExactText(text: string, edits: ExactTextEdit[], subject: string) {
  let next = text
  for (const edit of edits) {
    const count = edit.find ? next.split(edit.find).length - 1 : 0
    if (count === 0) throw new Error(`${subject}에 없는 글이야: ${edit.find.slice(0, 40)}`)
    if (count > 1 && !edit.all) throw new Error(`${subject}에 ${count}번 나와. 앞뒤 글을 더 넣거나 all을 켜줘: ${edit.find.slice(0, 40)}`)
    next = edit.all ? next.split(edit.find).join(edit.replace) : next.replace(edit.find, () => edit.replace)
  }
  return next
}
