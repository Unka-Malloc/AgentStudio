# Require Durable Host Evidence for Recovered Outcomes

When a host side effect succeeds before an Operation Outcome is appended, recovery depends on Durable Host Evidence owned by the host. Pactium binds the evidence reference and hash in the recovered outcome, but it does not execute side effects or own the host evidence store.
