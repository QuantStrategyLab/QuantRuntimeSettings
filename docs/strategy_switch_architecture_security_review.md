# Strategy switch console architecture and security review

[简体中文](strategy_switch_architecture_security_review.zh-CN.md)

Date: 2026-06-09

## Summary

The current design fits a personal quant system: the public page stays read-only;
GitHub OAuth gates the Worker trigger; the `Manual Strategy Switch` workflow still
performs the actual GitHub Variables write. This boundary is safer than a browser
password plus front-end token, and simpler than a full approval backend.

No Critical/High issues blocked release. Basic security response headers, same-origin
`Origin` checks for state-changing requests, and DOM API rendering for the main
switch page were added.

See the Chinese review for architecture diagrams, threat notes, and follow-up items.
