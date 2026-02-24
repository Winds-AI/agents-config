---
description: Run frontend workflow with explicit step selection before execution
---

Before doing anything else, call tool `workflow_set_mode` with:
- `target`: `frontend`
- `steps`: `$1`

Then execute the request under that workflow:
${@:2}

If step 4 is selected and no plan exists, stop and ask for/prepare the required plan first.
