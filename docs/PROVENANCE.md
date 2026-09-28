# Baseline Provenance

This project (SQL Assistant / AP-SQL Assistant) has been built and rebuilt across several turns
of this conversation. The development sandbox used to construct it does **not** persist files
between separated turns — each time a significant amount of time passes between messages, the
working project directory is lost and must be reconstructed from the record of source code
written in this chat history.

## History of this package

- **V15.7** — a SharePoint-hosted TypeScript project used as the original baseline for the M365
  Copilot Enterprise integration work. The exact SharePoint link could not be opened directly by
  the tools available in this environment; a matching source archive found in the user's
  OneDrive/SharePoint search index was used and transcribed file-by-file instead.
- **V16.0** — added the M365 Copilot Enterprise integration (Microsoft identity platform sign-in
  via Authorization Code + PKCE, a minimal-context adapter, and priority-ordered orchestration
  ahead of the existing offline/online NLP engines) as the only functional change versus V15.7.
- **V16.1** — a targeted bug-fix/regression-fix release addressing three specific reported issues
  in V16.0: uneven card sizing on the Query Builder pages, a GitHub-sync validation bug that could
  reject validly imported schemas with real-world (non-enum) data types, and a UI bug where the
  sync error indicator could show with no active error or fail to clear after a later success.
- **V16.1.1** — this package. A clean rebuild of the exact same V16.1 codebase (no functional
  changes), re-delivered after the working files were lost between sessions, per the user's
  request. Every fix from V16.1 is preserved and was re-verified (type-check, 9/9 unit tests, and
  a full browser smoke test) as part of producing this rebuild.

## What to double-check on your side

Because this codebase has been reconstructed from a chat-history record rather than a persistent
file store, if you maintain an authoritative copy of this project outside of this conversation
(e.g. in your own Git repository or SharePoint), it is worth diffing this package against that
copy to confirm there is no drift — particularly for any changes you may have made independently
between conversation sessions that would not be reflected in this rebuild.
