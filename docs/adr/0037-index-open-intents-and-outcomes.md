# Index Open Intents and Outcomes

Pactium uses Open Intent Index and Outcome Index structures to make append-only operation lifecycles recoverable and queryable. Intent commits append an Operation Intent and update the Open Intent Index; Outcome commits append an Operation Outcome, update the Outcome Index, and remove the intent from the Open Intent Index.
