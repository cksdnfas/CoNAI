# Future Work

## Backup source import

- [ ] Add **hash-based pre-import skip** for backup source ingestion.
  - Current status:
    - Initial scan on backup source add/start is implemented.
    - Real-time watcher import is implemented.
    - Existing target file path skip is implemented for initial scan.
  - Follow-up goal:
    - Before importing/copying/converting a source image, compute or compare by content/hash so files that already exist in the library can be skipped earlier.
    - Make this stronger than path-based skip, so renamed files or duplicated files in different source subfolders do not get imported again unnecessarily.
  - Why:
    - Prevent duplicate backup imports when the same image remains in the source folder or appears again under a different name/path.
    - Reduce unnecessary conversion/copy work and keep `uploads` cleaner.
