# Use a Single Ledger Append Lane

Pactium uses a single Ledger Append Lane to assign global leaf order for the Operation Ledger. Ordered batching may be used, but concurrent appends are not sorted after the fact because Ledger Authority depends on a clear append order.
