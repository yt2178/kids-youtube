# Family isolation acceptance matrix

Before production activation, run authenticated integration tests against two isolated test families A and B.

| Principal | Own approvals | Other family approvals | Write |
| --- | --- | --- | --- |
| Parent A | read | deny | own only with expectedVersion |
| Parent B | read | deny | own only with expectedVersion |
| Device A | read | deny | deny |
| Revoked device A | deny | deny | deny |
| Anonymous | deny | deny | deny |

Also verify changed grants block stale approvals; no supplied family identifier is trusted without verified identity. This document is a test specification, not evidence that the cases passed. The existing singleton service remains unchanged.
