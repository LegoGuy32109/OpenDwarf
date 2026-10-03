# Browser-hosted world for live sessions

The laptop browser remains the world authority for the live group demo. It
accepts move intents and simulates the shared world while its tab is open. Deno
Deploy serves the site and connects peers; Xirsys can relay WebRTC traffic when
a direct route fails. This keeps local movement immediate and avoids an
always-running world service for the smoke test. The trade-off is that host
upload grows with joining players, and the session may end when the host tab
closes. A future persistent world service can supersede this decision if the
game needs sessions that outlive their hosts.
