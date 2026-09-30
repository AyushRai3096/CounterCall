'use strict';

// Thin entry point that requires src/main.js rather than containing the
// real logic itself — same defensive pattern as counter-service/index.js.
// better-sqlite3 on Node 24 + Windows has crashed with a native assertion
// failure (RemoveEnvironmentCleanupHook) when the code touching it ran AS
// the process entry module, but was stable once required as a module
// instead (see CLAUDE.md). Electron bundles its own Node/V8, so it's not
// confirmed this applies here too — but the fix is free, so keep it.
require('./src/main.js');
