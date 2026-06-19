# Provide a First-Class LicoLite Aspect

Pactium is a subordinate npm package whose primary purpose is to support LicoLite, so it will include a first-class LicoLite Aspect instead of treating LicoLite as an external plugin. LicoLite-specific entrypoints should be grouped under a dedicated package surface such as `pactium/licolite`, and LicoLite requirements may directly shape Pactium core capability design.
