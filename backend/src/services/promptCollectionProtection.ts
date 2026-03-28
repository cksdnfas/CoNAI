export function isProtectedLoRAGroup(group: { group_name?: string | null } | null | undefined): boolean {
  return group?.group_name?.trim().toLowerCase() === 'lora';
}
