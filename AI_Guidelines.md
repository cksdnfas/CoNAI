## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure.
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files.
- When OpenClaw modifies code files in this project, automatically run `python -m graphify update .` before the final reply. Treat this as part of the normal coding workflow, not an optional suggestion.
- On this machine, prefer `python -m graphify update .` over `graphify update .` because the Python module entrypoint is the reliable path.
- If docs, images, PDFs, or other non-code Graphify corpus inputs changed, note that `update` is code-only and request or perform a fuller Graphify rebuild when appropriate.
- Graphify generated outputs and local helper files are git-ignored in this project, so do not try to commit them.
