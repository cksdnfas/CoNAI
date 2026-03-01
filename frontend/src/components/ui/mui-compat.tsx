const REMOVED_MESSAGE =
  'Legacy UI compatibility bridge is blocked. Migrate to native frontend UI components.';

function failCompatAccess(): never {
  throw new Error(REMOVED_MESSAGE);
}

const blockedCompat = new Proxy(() => failCompatAccess(), {
  apply: () => failCompatAccess(),
  get: () => failCompatAccess(),
}) as never;

export default blockedCompat;
