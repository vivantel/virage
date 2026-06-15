---
description: Index (or re-index) the project knowledge base with Virage
---

Run the Virage RAG pipeline to index the project's knowledge base.

Use the Bash tool to execute:
```
virage index $ARGUMENTS
```

Show the command output. When it completes, summarise: how many files were processed, how many chunks were created, and how many embeddings were uploaded.

Common flags (pass as $ARGUMENTS):
- `--force` — full rebuild, re-embeds all content
- `--dry-run` — show what would change without writing anything
- `--no-upload` — chunk and embed locally, skip vector store upload
- `--watch` — stay running and re-index on file changes
