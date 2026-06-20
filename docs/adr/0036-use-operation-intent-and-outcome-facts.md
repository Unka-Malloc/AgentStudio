# Use Operation Intent and Outcome Facts

Pactium models operation lifecycle as append-only Operation Intent and Operation Outcome facts instead of mutating a started ledger row into completed or failed status. A transparency ledger cannot safely patch prior leaves, so success and failure both become new Ledger-bound facts.
