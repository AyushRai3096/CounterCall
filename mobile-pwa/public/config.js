// Deployment-specific settings. Edit this file (not app.js) when pointing
// the PWA at a different relay server.
//
// The relay serves this PWA itself (see the root README), so the relay is
// simply wherever the page was loaded from — no IP to configure. Only set
// an explicit URL here if the PWA is ever hosted somewhere other than the
// relay.
window.COUNTERCALL_CONFIG = {
  relayUrl: window.location.origin,
};
