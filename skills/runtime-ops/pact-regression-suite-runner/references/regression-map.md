# Regression Suite Map

Use targeted checks based on the touched area:

- Server runtime or API: `npm run server:verify`
- Headless API behavior: `npm run server:verify:headless`
- Checkpoints and uploads: `npm run server:verify:checkpoint`
- Storage operations: `npm run server:verify:ops`
- Metadata rebuild: `npm run server:verify:rebuild`
- Flutter static checks: `npm run client:analyze`
- Flutter tests: `npm run client:test`

For mount changes, also run:

- `$pact-mount-routing-lab` for route resolution
- `$pact-module-contract-test` for module shape and sample execution
