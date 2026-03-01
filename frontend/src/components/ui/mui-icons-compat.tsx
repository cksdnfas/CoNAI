const REMOVED_MESSAGE =
  'Legacy icon compatibility bridge is blocked. Migrate to native icon components.';

function failCompatAccess(): never {
  throw new Error(REMOVED_MESSAGE);
}

const blockedCompat = new Proxy(() => failCompatAccess(), {
  apply: () => failCompatAccess(),
  get: () => failCompatAccess(),
}) as never;

export default blockedCompat;
