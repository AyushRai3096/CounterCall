'use strict';

// Deliberately a thin entry point that requires src/index.js rather than
// running it directly as the node entry file. On this stack (Node 24 +
// better-sqlite3 on Windows), running src/index.js AS the process entry
// module crashes almost immediately with a native assertion failure
// (RemoveEnvironmentCleanupHook) during startup — but the exact same code
// is completely stable once it's a required module instead. Keep this
// wrapper even if it looks redundant.
require('./src/index.js');
